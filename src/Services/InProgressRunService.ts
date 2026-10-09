import { PipelineConfig } from "../Contracts";
import { WorkItemRelation } from "../Deployments";
import {
    InProgressBuild,
    Repository,
    TimelineRecord,
    WaitingStage,
    enabledDefinitions,
    includesWorkItem,
    mapLimited,
    repositoriesFromRelations,
    stagesWaitingForApproval,
    waitingStagesOf,
} from "../InProgressRuns";
import AzdoClient from "./AzdoClient";

/** Runs in progress per repository; a repository rarely has more at once. */
const MAX_RUNS = 100;
/**
 * The work items listed per run. The API caps an unbounded request, which could leave this work item
 * out of a run that includes many.
 */
const MAX_WORK_ITEMS = 1000;
/** Work item and timeline requests in flight at once, so a busy repository cannot flood the API. */
const CONCURRENT_REQUESTS = 6;

export interface InProgressRuns {
    runs: InProgressBuild[];
    /** Stages of those runs waiting for an approval, which have no deployment record yet. */
    waiting: WaitingStage[];
}

/**
 * Finds the runs in progress that include the work item, the runs an Integrated in build link will
 * name when they complete. See InProgressRuns.ts.
 *
 * A request that fails leaves its repository or run out: it is not shown, never guessed. The next
 * load asks again.
 */
class InProgressRunService {
    /** `linkedRunIds` are the work item's build links: those runs include it without asking. */
    public async runsOf(
        relations: WorkItemRelation[],
        configs: Map<string, PipelineConfig>,
        workItemId: number,
        linkedRunIds: number[]
    ): Promise<InProgressRuns> {
        const perRepository = await Promise.all(
            repositoriesFromRelations(relations).map((repository) => this.runsIn(repository, configs))
        );
        const candidates = perRepository.reduce((all, some) => all.concat(some), [] as InProgressBuild[]);

        const linked = new Set(linkedRunIds);
        const perRun = await mapLimited(candidates, CONCURRENT_REQUESTS, (run) =>
            this.includedRun(run, workItemId, linked.has(run.id))
        );
        const included = perRun.filter((result): result is InProgressRuns => !!result);

        return {
            runs: included.reduce((all, some) => all.concat(some.runs), [] as InProgressBuild[]),
            waiting: included.reduce((all, some) => all.concat(some.waiting), [] as WaitingStage[]),
        };
    }

    /** The repository's runs in progress, of the pipelines in its project with Boards Integration enabled. */
    private async runsIn(repository: Repository, configs: Map<string, PipelineConfig>): Promise<InProgressBuild[]> {
        const definitionIds = enabledDefinitions(configs, repository.projectId);
        if (!definitionIds.length) {
            return [];
        }

        try {
            const body = await AzdoClient.get<{ value: InProgressBuild[] }>(
                `_apis/build/builds?repositoryId=${repository.repositoryId}&repositoryType=TfsGit` +
                    `&definitions=${definitionIds.join(",")}&statusFilter=inProgress` +
                    `&queryOrder=queueTimeDescending&$top=${MAX_RUNS}`,
                "7.1",
                repository.projectId
            );
            return (body && body.value) || [];
        } catch {
            return [];
        }
    }

    /**
     * The run and its stages waiting for an approval, when the run includes the work item. A linked run
     * is in progress again when a stage is rerun; it is known to include the work item.
     */
    private async includedRun(
        run: InProgressBuild,
        workItemId: number,
        linked: boolean
    ): Promise<InProgressRuns | undefined> {
        const projectId = run.project && run.project.id;
        if (!projectId) {
            return undefined;
        }
        if (!linked && !(await this.includes(run, workItemId, projectId))) {
            return undefined;
        }

        return { runs: [run], waiting: waitingStagesOf(run, await this.stagesWaitingForApproval(run, projectId)) };
    }

    /** Whether the run's work items, as Azure DevOps lists them, include the work item. */
    private async includes(run: InProgressBuild, workItemId: number, projectId: string): Promise<boolean> {
        try {
            const workItems = await AzdoClient.get<{ value: { id: string }[] }>(
                `_apis/build/builds/${run.id}/workitems?$top=${MAX_WORK_ITEMS}`,
                "7.1",
                projectId
            );
            return includesWorkItem(workItems && workItems.value, workItemId);
        } catch {
            return false;
        }
    }

    /** An unreadable timeline only hides the waiting stages; the run's deployments still show. */
    private async stagesWaitingForApproval(run: InProgressBuild, projectId: string): Promise<string[]> {
        try {
            const timeline = await AzdoClient.get<{ records: TimelineRecord[] }>(
                `_apis/build/builds/${run.id}/timeline`,
                "7.1",
                projectId
            );
            return stagesWaitingForApproval(timeline && timeline.records);
        } catch {
            return [];
        }
    }
}

export default new InProgressRunService();
