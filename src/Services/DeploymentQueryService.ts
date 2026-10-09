import * as SDK from "azure-devops-extension-sdk";
import { IWorkItemFormService, WorkItemTrackingServiceIds } from "azure-devops-extension-api/WorkItemTracking";

import { GroupedDeployments, WorkItemRelation, groupDeployments } from "../Deployments";
import { WorkItem, configsOf, mergeRuns } from "../Runs";
import AzdoClient from "./AzdoClient";
import PipelineConfigService from "./PipelineConfigService";
import PipelineRunService from "./PipelineRunService";
import RunService from "./RunService";

export { GroupedDeployments, PipelineDeployments } from "../Deployments";

export interface DeploymentsResult {
    groups: GroupedDeployments[];
    /** No run was found: no build links, and no run in progress that includes the work item. */
    noRuns: boolean;
}

class DeploymentQueryService {
    public async getDeployments(): Promise<DeploymentsResult> {
        const workItem = await this.openWorkItem();

        const [completed, running] = await Promise.all([
            RunService.completedRuns(workItem),
            RunService.runningRuns(workItem),
        ]);
        const runs = mergeRuns(completed, running);
        if (!runs.length) {
            return { groups: [], noRuns: true };
        }

        const configs = configsOf(runs, workItem);
        const deployments = await PipelineRunService.deploymentsOf(runs, configs);

        return { groups: groupDeployments(deployments, configs), noRuns: false };
    }

    private async openWorkItem(): Promise<WorkItem> {
        const formService = await SDK.getService<IWorkItemFormService>(
            WorkItemTrackingServiceIds.WorkItemFormService
        );
        const [id, relations, { projectId }, configs] = await Promise.all([
            formService.getId(),
            formService.getWorkItemRelations() as Promise<WorkItemRelation[]>,
            AzdoClient.getContext(),
            PipelineConfigService.getAll(),
        ]);
        return { id, projectId, relations, configs };
    }
}

export default new DeploymentQueryService();
