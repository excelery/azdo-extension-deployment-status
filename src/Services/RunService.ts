import {
    Build,
    Repository,
    Run,
    TimelineRecord,
    WorkItem,
    buildLinkIds,
    enabledDefinitions,
    includesWorkItem,
    mapLimited,
    repositoriesFromRelations,
    runOf,
    stagesWaitingForApproval,
} from "../Runs";
import AzdoClient from "./AzdoClient";

/** Run ids per build lookup request, to keep the URL short. */
const RUN_IDS_PER_REQUEST = 200;
const RUNS_PER_PAGE = 100;
/**
 * The work items listed per run. The API caps an unbounded request, which could leave this work item
 * out of a run that includes many.
 */
const MAX_WORK_ITEMS = 1000;
/** Requests in flight at once, so a busy repository cannot flood the API. */
const CONCURRENT_REQUESTS = 6;

/**
 * Finds a work item's runs. See Runs.ts.
 *
 * A request that fails leaves its runs out: they are not shown, never guessed. The next load asks
 * again.
 */
class RunService {
    /**
     * The runs of the work item's Integrated in build links. Listing builds by id through the work
     * item's project also returns runs from other projects; a run deleted by retention is not
     * returned, so it is kept with no known pipeline.
     */
    public async completedRuns(workItem: WorkItem): Promise<Run[]> {
        const runIds = buildLinkIds(workItem.relations);
        const builds: Build[] = [];

        for (let start = 0; start < runIds.length; start += RUN_IDS_PER_REQUEST) {
            const ids = runIds.slice(start, start + RUN_IDS_PER_REQUEST).join(",");
            try {
                const body = await AzdoClient.get<{ value: Build[] }>(
                    `_apis/build/builds?buildIds=${ids}&deletedFilter=includeDeleted`
                );
                builds.push(...((body && body.value) || []));
            } catch {
                // The runs of this batch stay without a known pipeline.
            }
        }

        const found = new Map(builds.map((build) => [build.id, build]));
        return runIds.map((id) => runOf(found.get(id) || { id }));
    }

    /**
     * The runs in progress that include the work item: the runs an Integrated in build link will name
     * when they complete, with their stages waiting for an approval.
     */
    public async runningRuns(workItem: WorkItem): Promise<Run[]> {
        const perRepository = await Promise.all(
            repositoriesFromRelations(workItem.relations).map((repository) => this.runsInProgress(repository, workItem))
        );
        const candidates = perRepository.reduce((all, some) => all.concat(some), [] as Build[]);

        const linked = new Set(buildLinkIds(workItem.relations));
        const runs = await mapLimited(candidates, CONCURRENT_REQUESTS, async (build) => {
            // A linked run is in progress again when a stage is rerun; it is known to include the work item.
            const included = linked.has(build.id) || (await this.includes(build, workItem.id));
            return included ? runOf(build, await this.stagesWaitingForApproval(build)) : undefined;
        });
        return runs.filter((run): run is Run => !!run);
    }

    /** The repository's runs in progress, of the pipelines in its project with Boards Integration enabled. */
    private async runsInProgress(repository: Repository, workItem: WorkItem): Promise<Build[]> {
        const definitionIds = enabledDefinitions(workItem.configs, repository.projectId);
        const builds: Build[] = [];
        let continuationToken: string | undefined;

        if (!definitionIds.length) {
            return builds;
        }
        try {
            do {
                const token = continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : "";
                const response = await AzdoClient.getPage<{ value: Build[] }>(
                    `_apis/build/builds?repositoryId=${repository.repositoryId}&repositoryType=TfsGit` +
                        `&definitions=${definitionIds.join(",")}&statusFilter=inProgress` +
                        `&queryOrder=queueTimeDescending&$top=${RUNS_PER_PAGE}${token}`,
                    "7.1",
                    repository.projectId
                );
                builds.push(...((response.body && response.body.value) || []));
                continuationToken = response.continuationToken;
            } while (continuationToken);
        } catch {
            // The pages read so far are kept.
        }
        return builds;
    }

    /** Whether the run's work items, as Azure DevOps lists them, include the work item. */
    private async includes(build: Build, workItemId: number): Promise<boolean> {
        try {
            const workItems = await AzdoClient.get<{ value: { id: string }[] }>(
                `_apis/build/builds/${build.id}/workitems?$top=${MAX_WORK_ITEMS}`,
                "7.1",
                build.project && build.project.id
            );
            return includesWorkItem(workItems && workItems.value, workItemId);
        } catch {
            return false;
        }
    }

    /** An unreadable timeline only hides the waiting stages; the run's deployments still show. */
    private async stagesWaitingForApproval(build: Build): Promise<string[]> {
        try {
            const timeline = await AzdoClient.get<{ records: TimelineRecord[] }>(
                `_apis/build/builds/${build.id}/timeline`,
                "7.1",
                build.project && build.project.id
            );
            return stagesWaitingForApproval(timeline && timeline.records);
        } catch {
            return [];
        }
    }
}

export default new RunService();
