import AzdoClient from "./AzdoClient";
import { DeploymentRecord } from "../Contracts";
import {
    EnvironmentSummary,
    LinkedBuild,
    RawDeploymentRecord,
    olderThanRuns,
    pipelinesOfBuilds,
    toDeploymentRecords,
} from "../Deployments";

export { EnvironmentSummary } from "../Deployments";

interface EnvironmentInstance {
    id: number;
    name: string;
}

const PAGE_SIZE = 200;
/** Bounds the requests one environment can cost: 10 pages is 2,000 deployments. */
const MAX_PAGES = 10;
/** A single run's work items; far more than one run brings in practice. */
const WORK_ITEMS_PER_RUN = 5000;
/** Run ids per build lookup request, to keep the URL short. */
const RUN_IDS_PER_REQUEST = 200;

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
    public async recordsOf(
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
     * The pipelines, as `<projectId>-<definitionId>` keys, that built the linked runs. Listing builds
     * by id through the work item's project also returns runs from other projects, each with its
     * own project id; getting a single build by id does not. A run that is not returned is simply
     * not resolved, which never hides deployments found through the work item's own project.
     */
    public async pipelinesOfRuns(runIds: number[]): Promise<Set<string>> {
        const builds: LinkedBuild[] = [];

        for (let start = 0; start < runIds.length; start += RUN_IDS_PER_REQUEST) {
            const ids = runIds.slice(start, start + RUN_IDS_PER_REQUEST).join(",");
            try {
                const body = await AzdoClient.get<{ value: LinkedBuild[] }>(
                    `_apis/build/builds?buildIds=${ids}&deletedFilter=includeDeleted`
                );
                builds.push(...((body && body.value) || []));
            } catch {
            }
        }

        return pipelinesOfBuilds(builds);
    }

    /**
     * The work items a run brought, compared with the pipeline's previous run. The same list the
     * environment's Work items tab shows, and available while the run is still in progress.
     */
    public async workItemsOf(projectId: string, runId: number, previousRunId?: number): Promise<number[]> {
        const path =
            previousRunId !== undefined
                ? `_apis/build/workitems?fromBuildId=${previousRunId}&toBuildId=${runId}&$top=${WORK_ITEMS_PER_RUN}`
                : `_apis/build/builds/${runId}/workitems?$top=${WORK_ITEMS_PER_RUN}`;
        const body = await AzdoClient.get<{ value: { id: string }[] }>(path, "7.1-preview.2", projectId);
        return ((body && body.value) || []).map((item) => Number(item.id));
    }

    private repositories = new Map<string, Promise<string | undefined>>();

    /** The repository a pipeline builds, read from its definition in its own project. */
    public repositoryOf(projectId: string, definitionId: number): Promise<string | undefined> {
        const key = `${projectId}-${definitionId}`;
        if (!this.repositories.has(key)) {
            this.repositories.set(
                key,
                AzdoClient.get<{ repository?: { id?: string } }>(
                    `_apis/build/definitions/${definitionId}`,
                    "7.1",
                    projectId
                ).then((body) => (body && body.repository && body.repository.id ? body.repository.id.toLowerCase() : undefined))
            );
        }
        return this.repositories.get(key)!;
    }

    /**
     * The source branch of each run. Listing builds by id through any project also returns runs
     * from other projects, and deleted runs while they are still recoverable.
     */
    public async branchesOf(runIds: number[]): Promise<Map<number, string>> {
        const branches = new Map<number, string>();
        for (let start = 0; start < runIds.length; start += RUN_IDS_PER_REQUEST) {
            const ids = runIds.slice(start, start + RUN_IDS_PER_REQUEST).join(",");
            try {
                const body = await AzdoClient.get<{ value: LinkedBuild[] }>(
                    `_apis/build/builds?buildIds=${ids}&deletedFilter=includeDeleted`
                );
                for (const build of (body && body.value) || []) {
                    if (build && build.sourceBranch) {
                        branches.set(build.id, build.sourceBranch);
                    }
                }
            } catch {
            }
        }
        return branches;
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
