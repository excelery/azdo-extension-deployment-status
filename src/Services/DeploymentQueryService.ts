import * as SDK from "azure-devops-extension-sdk";
import { IWorkItemFormService, WorkItemTrackingServiceIds } from "azure-devops-extension-api/WorkItemTracking";

import { GroupedDeployments, groupDeployments } from "../Deployments";
import { commitLinksFromRelations } from "../EnvironmentLookup";
import EnvironmentLookupService from "./EnvironmentLookupService";
import PipelineConfigService from "./PipelineConfigService";

export { GroupedDeployments, PipelineDeployments } from "../Deployments";

export interface DeploymentsResult {
    groups: GroupedDeployments[];
    /** The work item has no commit links, so there is nothing to look deployments up by. */
    noBuildLinks: boolean;
}

class DeploymentQueryService {
    public async getDeployments(): Promise<DeploymentsResult> {
        const configsPromise = PipelineConfigService.getAll();

        const formService = await SDK.getService<IWorkItemFormService>(
            WorkItemTrackingServiceIds.WorkItemFormService
        );
        const [relations, workItemId] = await Promise.all([formService.getWorkItemRelations(), formService.getId()]);

        if (!commitLinksFromRelations(relations as any).length) {
            configsPromise.catch(() => undefined);
            return { groups: [], noBuildLinks: true };
        }

        const configs = await configsPromise;
        const records = await EnvironmentLookupService.deployments(workItemId, relations as any, configs);

        return { groups: groupDeployments(records, configs), noBuildLinks: false };
    }
}

export default new DeploymentQueryService();
