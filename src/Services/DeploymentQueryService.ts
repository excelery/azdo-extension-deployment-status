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
import InProgressRunService from "./InProgressRunService";
import PipelineRunService from "./PipelineRunService";
import PipelineConfigService from "./PipelineConfigService";

export { GroupedDeployments, PipelineDeployments } from "../Deployments";

export interface DeploymentsResult {
    groups: GroupedDeployments[];
    /** No run was found: no build links, and no run in progress that includes the work item. */
    noRuns: boolean;
}

class DeploymentQueryService {
    /**
     * Completed runs are the work item's Integrated in build links, as always. A link is added only
     * when a run completes, so runs in progress are found through the repositories of the work item's
     * commit and pull request links (see InProgressRuns.ts). Deployments are then read from the mapped
     * environments.
     */
    public async getDeployments(): Promise<DeploymentsResult> {
        const formService = await SDK.getService<IWorkItemFormService>(
            WorkItemTrackingServiceIds.WorkItemFormService
        );
        const [allConfigs, { projectId }, relations, workItemId] = await Promise.all([
            PipelineConfigService.getAll(),
            AzdoClient.getContext(),
            formService.getWorkItemRelations() as Promise<WorkItemRelation[]>,
            formService.getId(),
        ]);
        const linkedRunIds = runIdsFromRelations(relations);

        const [linkedPipelines, inProgress] = await Promise.all([
            PipelineRunService.pipelinesOfRuns(linkedRunIds),
            InProgressRunService.runsOf(relations, allConfigs, workItemId, linkedRunIds),
        ]);

        const runIds = Array.from(new Set(linkedRunIds.concat(inProgress.runs.map((run) => run.id))));
        if (!runIds.length) {
            return { groups: [], noRuns: true };
        }

        pipelinesOfBuilds(inProgress.runs).forEach((pipeline) => linkedPipelines.add(pipeline));
        const configs = relevantConfigs(allConfigs, projectId, linkedPipelines);
        const records = await PipelineRunService.deploymentsIn(mappedEnvironments(configs), runIds, inProgress.waiting);

        return { groups: groupDeployments(records, configs), noRuns: false };
    }
}

export default new DeploymentQueryService();
