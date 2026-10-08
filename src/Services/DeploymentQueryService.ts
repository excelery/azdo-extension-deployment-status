import * as SDK from "azure-devops-extension-sdk";
import { IWorkItemFormService, WorkItemTrackingServiceIds } from "azure-devops-extension-api/WorkItemTracking";

import {
    GroupedDeployments,
    WorkItemRelation,
    groupDeployments,
    mappedEnvironments,
    pipelinesOfBuilds,
    relevantConfigs,
    runIdsFromRelations,
} from "../Deployments";
import AzdoClient from "./AzdoClient";
import CommitRunService from "./CommitRunService";
import PipelineRunService from "./PipelineRunService";
import PipelineConfigService from "./PipelineConfigService";

export { GroupedDeployments, PipelineDeployments } from "../Deployments";

export interface DeploymentsResult {
    groups: GroupedDeployments[];
    /** No run was found through either the work item's build links or its commit links. */
    noRuns: boolean;
}

class DeploymentQueryService {
    /**
     * A work item's runs come from two sources, combined. Integrated in build links cover completed
     * runs, including those from GitHub repositories. Commit and pull request links cover runs still
     * in progress, from Azure Repos. Deployments are then read from the mapped environments.
     */
    public async getDeployments(): Promise<DeploymentsResult> {
        const configsPromise = PipelineConfigService.getAll();

        const formService = await SDK.getService<IWorkItemFormService>(
            WorkItemTrackingServiceIds.WorkItemFormService
        );
        const relations = (await formService.getWorkItemRelations()) as WorkItemRelation[];
        const linkedRunIds = runIdsFromRelations(relations);

        const [allConfigs, { projectId }] = await Promise.all([configsPromise, AzdoClient.getContext()]);
        const [linkedPipelines, commitRuns] = await Promise.all([
            PipelineRunService.pipelinesOfRuns(linkedRunIds),
            CommitRunService.runsOf(relations, allConfigs),
        ]);

        const runIds = Array.from(new Set(linkedRunIds.concat(commitRuns.map((run) => run.id))));
        if (!runIds.length) {
            return { groups: [], noRuns: true };
        }

        pipelinesOfBuilds(commitRuns).forEach((pipeline) => linkedPipelines.add(pipeline));
        const configs = relevantConfigs(allConfigs, projectId, linkedPipelines);
        const records = await PipelineRunService.deploymentsIn(mappedEnvironments(configs), runIds);

        return { groups: groupDeployments(records, configs), noRuns: false };
    }
}

export default new DeploymentQueryService();
