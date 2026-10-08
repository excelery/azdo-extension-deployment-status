import * as SDK from "azure-devops-extension-sdk";
import { IWorkItemFormService, WorkItemTrackingServiceIds } from "azure-devops-extension-api/WorkItemTracking";

import { GroupedDeployments, groupDeployments } from "../Deployments";
import { codeLinksFromRelations } from "../EnvironmentLookup";
import EnvironmentLookupService from "./EnvironmentLookupService";
import PipelineConfigService from "./PipelineConfigService";

export { GroupedDeployments, PipelineDeployments } from "../Deployments";

export interface DeploymentsResult {
    groups: GroupedDeployments[];
    /** The work item has no commit, pull request or branch links, so nothing ties it to a run. */
    noBuildLinks: boolean;
}

class DeploymentQueryService {
    public async getDeployments(): Promise<DeploymentsResult> {
        const configsPromise = PipelineConfigService.getAll();

        const formService = await SDK.getService<IWorkItemFormService>(
            WorkItemTrackingServiceIds.WorkItemFormService
        );
        const [relations, workItemId] = await Promise.all([formService.getWorkItemRelations(), formService.getId()]);

        if (!codeLinksFromRelations(relations as any).length) {
            configsPromise.catch(() => undefined);
            return { groups: [], noBuildLinks: true };
        }

        const configs = await configsPromise;
        const records = await EnvironmentLookupService.deployments(workItemId, relations as any, configs);

        return { groups: groupDeployments(records, configs), noBuildLinks: false };
    }
}

export default new DeploymentQueryService();
