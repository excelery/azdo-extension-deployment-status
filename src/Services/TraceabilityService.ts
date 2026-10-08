import { DeploymentRecord, PipelineConfig, mappingFor } from "../Contracts";
import { RawDeploymentRecord, mappedEnvironments, pipelineKey, projectIdOf, toDeploymentRecords } from "../Deployments";
import {
    codeProjectsFromRelations,
    deploymentPageUrl,
    deploymentsSince,
    pipelinesIn,
    reachedBefore,
    workItemIdsFromResponse,
    workItemsQuery,
    WORK_ITEMS_PROVIDER,
} from "../Traceability";
import AzdoClient from "./AzdoClient";
import PipelineRunService, { EnvironmentSummary } from "./PipelineRunService";

const LOG = "[Deployment Status]";

/**
 * Finds a work item's deployments in the environments' own work item history.
 *
 * For each mapped environment of the pipelines in the work item's project (and the projects its
 * code links point to): read the deployments since the work item was created, oldest first, and
 * ask each for its work items until one contains the work item. That deployment brought it; later
 * deployments of the same pipeline to the same environment carry it too.
 */
class TraceabilityService {
    public async deployments(
        workItemId: number,
        createdAt: number,
        relations: any[],
        configs: Map<string, PipelineConfig>
    ): Promise<DeploymentRecord[]> {
        const { projectId } = await AzdoClient.getContext();
        const projects = new Set([projectId.toLowerCase(), ...codeProjectsFromRelations(relations)]);

        const relevant = new Map<string, PipelineConfig>();
        configs.forEach((config, key) => {
            if (config.enabled && projects.has(projectIdOf(config).toLowerCase())) {
                relevant.set(key, config);
            }
        });

        // Diagnostic for the dev test.
        console.info(LOG, "work item", workItemId, "created", new Date(createdAt).toISOString(), "projects", Array.from(projects), "configs", Array.from(configs.keys()), "relevant", Array.from(relevant.keys()), "environments", mappedEnvironments(relevant));

        const perEnvironment = await Promise.all(
            mappedEnvironments(relevant).map((environment) =>
                this.deploymentsIn(environment, workItemId, createdAt, relevant).catch((error) => {
                    console.warn(LOG, "environment", environment.environmentId, "skipped:", error && error.message);
                    return [] as DeploymentRecord[];
                })
            )
        );
        return perEnvironment.reduce((all, some) => all.concat(some), [] as DeploymentRecord[]);
    }

    private async deploymentsIn(
        environment: EnvironmentSummary,
        workItemId: number,
        createdAt: number,
        configs: Map<string, PipelineConfig>
    ): Promise<DeploymentRecord[]> {
        const projectId = environment.projectId || "";
        const records = await PipelineRunService.recordsOf(environment, (page) => reachedBefore(page, createdAt));

        // Diagnostic for the dev test.
        console.info(LOG, "environment", environment.environmentId, "records", records.length, "pipelines", pipelinesIn(records), records.slice(0, 3));

        const found: DeploymentRecord[] = [];
        for (const definitionId of pipelinesIn(records)) {
            // Only pipelines whose Boards Integration settings map this environment.
            if (!mappingFor(configs.get(pipelineKey(projectId, definitionId)), environment.environmentId)) {
                continue;
            }

            // Diagnostic for the dev test.
            console.info(LOG, "environment", environment.environmentId, "pipeline", definitionId, "deployments since created", deploymentsSince(records, definitionId, createdAt).map((record) => record.id));

            let brought: RawDeploymentRecord | undefined;
            for (const record of deploymentsSince(records, definitionId, createdAt)) {
                const ids = await this.workItemsOf(projectId, environment.environmentId, record);
                if (ids.includes(workItemId)) {
                    brought = record;
                    break;
                }
            }
            if (!brought) {
                continue;
            }

            const carried = records.filter(
                (record) =>
                    !!record.definition &&
                    !!record.owner &&
                    record.definition.id === definitionId &&
                    (record.id || 0) >= (brought!.id || 0)
            );
            found.push(...toDeploymentRecords(environment, carried, carried.map((record) => record.owner!.id)));
        }
        return found;
    }

    /** One deployment's work items, from the environment's stored history. */
    private async workItemsOf(projectId: string, environmentId: number, record: RawDeploymentRecord): Promise<number[]> {
        const { baseUrl } = await AzdoClient.getContext();
        const pageUrl = deploymentPageUrl(baseUrl, projectId, environmentId, record);
        const response = await AzdoClient.postToOrganization<{ dataProviders?: Record<string, unknown> }>(
            `_apis/Contribution/HierarchyQuery/project/${projectId}`,
            workItemsQuery(pageUrl, projectId, environmentId, record),
            "5.0-preview.1"
        );
        const data = response && response.dataProviders ? response.dataProviders[WORK_ITEMS_PROVIDER] : undefined;
        const ids = workItemIdsFromResponse(data);
        // Diagnostic for the dev test: what each deployment's history returned.
        console.info(LOG, "environment", environmentId, "deployment", record.id, "run", record.owner && record.owner.id, "work items", ids, data);
        return ids;
    }
}

export default new TraceabilityService();
