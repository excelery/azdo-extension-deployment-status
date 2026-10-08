import { PipelineConfig } from "../Contracts";
import { WorkItemRelation } from "../Deployments";
import {
    InProgressBuild,
    Repository,
    TimelineRecord,
    WaitingStage,
    enabledDefinitions,
    includesWorkItem,
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
    public async runsOf(
        relations: WorkItemRelation[],
        configs: Map<string, PipelineConfig>,
        workItemId: number
    ): Promise<InProgressRuns> {
        const perRepository = await Promise.all(
            repositoriesFromRelations(relations).map((repository) => this.runsIn(repository, configs))
        );
        const candidates = perRepository.reduce((all, some) => all.concat(some), [] as InProgressBuild[]);

        const perRun = await Promise.all(candidates.map((run) => this.includedRun(run, workItemId)));
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

    /** The run and its stages waiting for an approval, when the run includes the work item. */
    private async includedRun(run: InProgressBuild, workItemId: number): Promise<InProgressRuns | undefined> {
        const projectId = run.project && run.project.id;
        if (!projectId) {
            return undefined;
        }

        try {
            const workItems = await AzdoClient.get<{ value: { id: string }[] }>(
                `_apis/build/builds/${run.id}/workitems?$top=${MAX_WORK_ITEMS}`,
                "7.1",
                projectId
            );
            if (!includesWorkItem(workItems && workItems.value, workItemId)) {
                return undefined;
            }
        } catch {
            return undefined;
        }

        return { runs: [run], waiting: waitingStagesOf(run, await this.stagesWaitingForApproval(run, projectId)) };
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
