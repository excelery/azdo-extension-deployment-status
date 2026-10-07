import AzdoClient from "./AzdoClient";
import { DeploymentRecord } from "../Contracts";
import { EnvironmentSummary, RawDeploymentRecord, olderThanRuns, pipelineKey, toDeploymentRecords } from "../Deployments";

export { EnvironmentSummary } from "../Deployments";

interface EnvironmentInstance {
    id: number;
    name: string;
}

const PAGE_SIZE = 200;
/** Bounds the requests one environment can cost: 10 pages is 2,000 deployments. */
const MAX_PAGES = 10;
/** Keeps the build lookup to one request per project. */
const MAX_RUN_IDS = 200;

class PipelineRunService {
    private environments: Promise<EnvironmentSummary[]> | undefined;

    public listEnvironments(): Promise<EnvironmentSummary[]> {
        if (!this.environments) {
            this.environments = AzdoClient.get<{ value: EnvironmentInstance[] }>(
                "_apis/pipelines/environments",
                "7.1-preview.1"
            ).then((body) =>
                ((body && body.value) || []).map((environment) => ({
                    environmentId: environment.id,
                    environmentName: environment.name,
                }))
            );
        }
        return this.environments;
    }

    /**
     * Reads an environment's records newest first, a page at a time, until `enough` says the rest
     * cannot matter, the records run out, or MAX_PAGES is reached.
     */
    private async recordsOf(
        environment: EnvironmentSummary,
        enough: (page: RawDeploymentRecord[]) => boolean
    ): Promise<RawDeploymentRecord[]> {
        const records: RawDeploymentRecord[] = [];
        let continuationToken: string | undefined;

        try {
            for (let page = 0; page < MAX_PAGES; page++) {
                const token = continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : "";
                const response = await AzdoClient.getPage<{ value: RawDeploymentRecord[] }>(
                    `_apis/pipelines/environments/${environment.environmentId}/environmentdeploymentrecords?top=${PAGE_SIZE}${token}`,
                    "7.2-preview.1",
                    environment.projectId
                );
                const value = (response.body && response.body.value) || [];
                records.push(...value);

                continuationToken = response.continuationToken;
                if (!continuationToken || !value.length || enough(value)) {
                    break;
                }
            }
        } catch {
        }

        return records;
    }

    public async deploymentsIn(
        environments: EnvironmentSummary[],
        runIds: number[]
    ): Promise<DeploymentRecord[]> {
        if (!environments.length || !runIds.length) {
            return [];
        }

        const perEnvironment = await Promise.all(
            environments.map(async (environment) =>
                toDeploymentRecords(
                    environment,
                    await this.recordsOf(environment, (page) => olderThanRuns(page, runIds)),
                    runIds
                )
            )
        );

        return perEnvironment.reduce((all, some) => all.concat(some), []);
    }

    /**
     * The pipelines, as `<projectId>-<definitionId>` keys, that built any of the runs in the given
     * projects. One request per project; a project the user cannot read is skipped.
     */
    public async pipelinesOfRuns(projectIds: string[], runIds: number[]): Promise<Set<string>> {
        const pipelines = new Set<string>();
        if (!projectIds.length || !runIds.length) {
            return pipelines;
        }

        const ids = runIds.slice(0, MAX_RUN_IDS).join(",");
        await Promise.all(
            projectIds.map(async (projectId) => {
                try {
                    const response = await AzdoClient.getPage<{ value: { definition?: { id: number } }[] }>(
                        `_apis/build/builds?buildIds=${ids}&deletedFilter=includeDeleted`,
                        "7.1",
                        projectId
                    );
                    for (const build of (response.body && response.body.value) || []) {
                        if (build && build.definition) {
                            pipelines.add(pipelineKey(projectId, build.definition.id));
                        }
                    }
                } catch {
                }
            })
        );

        return pipelines;
    }

    public async environmentsForPipeline(definitionId: number): Promise<EnvironmentSummary[]> {
        const environments = await this.listEnvironments();

        const used = await Promise.all(
            environments.map(async (environment) => {
                const isThisPipeline = (record: RawDeploymentRecord) =>
                    !!record.definition && record.definition.id === definitionId;
                const records = await this.recordsOf(environment, (page) =>
                    page.some(isThisPipeline)
                );
                const deploys = records.some(isThisPipeline);
                return deploys ? environment : undefined;
            })
        );

        return used
            .filter((environment): environment is EnvironmentSummary => !!environment)
            .sort((a, b) => a.environmentName.localeCompare(b.environmentName));
    }
}

export default new PipelineRunService();
