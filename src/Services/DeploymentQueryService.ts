import * as SDK from "azure-devops-extension-sdk";
import { IWorkItemFormService, WorkItemTrackingServiceIds } from "azure-devops-extension-api/WorkItemTracking";

import {
    GroupedDeployments,
    groupDeployments,
    mappedEnvironments,
    runIdsFromRelations,
} from "../Deployments";
import PipelineRunService from "./PipelineRunService";
import PipelineConfigService from "./PipelineConfigService";

export { GroupedDeployments, PipelineDeployments } from "../Deployments";

export interface DeploymentsResult {
    groups: GroupedDeployments[];
    noBuildLinks: boolean;
}

class DeploymentQueryService {
    public async getRunIds(): Promise<number[]> {
        const formService = await SDK.getService<IWorkItemFormService>(
            WorkItemTrackingServiceIds.WorkItemFormService
        );
        const relations = await formService.getWorkItemRelations();
        return runIdsFromRelations(relations as any);
    }

    public async getDeployments(): Promise<DeploymentsResult> {
        const configsPromise = PipelineConfigService.getAll();

        const runIds = await this.getRunIds();
        if (!runIds.length) {
            configsPromise.catch(() => undefined);
            return { groups: [], noBuildLinks: true };
        }

        const configs = await configsPromise;
        const environments = mappedEnvironments(configs);

        if (!environments.length) {
            return { groups: [], noBuildLinks: false };
        }

        const records = await PipelineRunService.deploymentsIn(environments, runIds);

        return { groups: groupDeployments(records, configs), noBuildLinks: false };
    }
}

export default new DeploymentQueryService();
