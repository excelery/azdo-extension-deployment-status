import * as SDK from "azure-devops-extension-sdk";
import { IWorkItemFormService, WorkItemTrackingServiceIds } from "azure-devops-extension-api/WorkItemTracking";

import { GroupedDeployments, groupDeployments } from "../Deployments";
import PipelineConfigService from "./PipelineConfigService";
import TraceabilityService from "./TraceabilityService";

export { GroupedDeployments, PipelineDeployments } from "../Deployments";

export interface DeploymentsResult {
    groups: GroupedDeployments[];
    noBuildLinks: boolean;
}

class DeploymentQueryService {
    public async getDeployments(): Promise<DeploymentsResult> {
        const configsPromise = PipelineConfigService.getAll();

        const formService = await SDK.getService<IWorkItemFormService>(
            WorkItemTrackingServiceIds.WorkItemFormService
        );
        const [relations, workItemId, created] = await Promise.all([
            formService.getWorkItemRelations(),
            formService.getId(),
            formService.getFieldValue("System.CreatedDate"),
        ]);
        const createdAt = Date.parse(String(created)) || 0;

        const configs = await configsPromise;
        const records = await TraceabilityService.deployments(workItemId, createdAt, relations as any, configs);

        return { groups: groupDeployments(records, configs), noBuildLinks: false };
    }
}

export default new DeploymentQueryService();
