import { PipelineConfig } from "../Contracts";
import {
    AncestryCheck,
    CommitRef,
    PullRequest,
    PullRequestRef,
    RepositoryBuild,
    ancestryChecks,
    buildsContaining,
    byRepository,
    checkKey,
    containsBase,
    earliest,
    enabledPipelinesByProject,
    gitLinksFromRelations,
    mergeCommitOf,
} from "../CommitRuns";
import { WorkItemRelation } from "../Deployments";
import AzdoClient from "./AzdoClient";

/**
 * Bounds the build listing per repository and project: 3 pages is 3,000 runs. Runs are listed newest
 * first, so a cut drops the oldest, completed runs, which build links cover, never a run in progress.
 */
const BUILD_PAGE_SIZE = 1000;
const MAX_BUILD_PAGES = 3;
/** Ancestry checks in flight at once. */
const CONCURRENT_CHECKS = 6;

interface GitCommit {
    push?: { date?: string };
}

/**
 * Finds the runs whose source contains a commit linked to the work item, directly or through a
 * completed pull request. See CommitRuns.ts for what a match does and does not prove.
 *
 * Push times and ancestry never change, so they are cached for the life of the frame. A request that
 * fails leaves its commit or run unresolved: it is not shown, never guessed.
 */
class CommitRunService {
    private pushTimes = new Map<string, Promise<string>>();
    private ancestry = new Map<string, Promise<boolean>>();

    public async runsOf(relations: WorkItemRelation[], configs: Map<string, PipelineConfig>): Promise<RepositoryBuild[]> {
        const pipelines = enabledPipelinesByProject(configs);
        const { commits, pullRequests } = gitLinksFromRelations(relations);
        if (!pipelines.size || (!commits.length && !pullRequests.length)) {
            return [];
        }

        const mergeCommits = await Promise.all(pullRequests.map((pullRequest) => this.mergeCommit(pullRequest)));
        const linked = commits.concat(mergeCommits.filter((commit): commit is CommitRef => !!commit));

        const perRepository = await Promise.all(
            byRepository(linked).map((repositoryCommits) => this.runsInRepository(repositoryCommits, pipelines))
        );
        return perRepository.reduce((all, some) => all.concat(some), [] as RepositoryBuild[]);
    }

    /** `commits` all belong to one repository. */
    private async runsInRepository(commits: CommitRef[], pipelines: Map<string, number[]>): Promise<RepositoryBuild[]> {
        const pushTimes = await Promise.all(commits.map((commit) => this.pushTime(commit)));
        const resolved = commits.filter((_, index) => !!pushTimes[index]);
        // A run queued before a commit was pushed cannot contain it.
        const since = earliest(pushTimes.filter((time): time is string => !!time));
        if (!resolved.length || !since) {
            return [];
        }

        const { projectId, repositoryId } = resolved[0];
        const perProject = await Promise.all(
            Array.from(pipelines.entries()).map(([pipelineProject, definitionIds]) =>
                this.buildsOf(pipelineProject, repositoryId, definitionIds, since)
            )
        );
        const builds = perProject.reduce((all, some) => all.concat(some), [] as RepositoryBuild[]);

        const linkedCommits = resolved.map((commit) => commit.commitId);
        const checks = ancestryChecks(builds, linkedCommits);
        const results = await inBatches(checks, CONCURRENT_CHECKS, (check) =>
            this.contains(projectId, repositoryId, check)
        );
        const contained = new Set(checks.filter((_, index) => results[index]).map(checkKey));

        return buildsContaining(builds, linkedCommits, (check) => contained.has(checkKey(check)));
    }

    private async mergeCommit(ref: PullRequestRef): Promise<CommitRef | undefined> {
        try {
            const pullRequest = await AzdoClient.get<PullRequest>(
                `_apis/git/repositories/${ref.repositoryId}/pullrequests/${ref.pullRequestId}`,
                "7.1",
                ref.projectId
            );
            return mergeCommitOf(pullRequest, ref);
        } catch {
            // Unresolved, by design: the pull request finds no runs on this load, and the next load asks again.
            return undefined;
        }
    }

    /** When the commit reached the server; undefined when it cannot be read. */
    private pushTime(commit: CommitRef): Promise<string | undefined> {
        return cached(this.pushTimes, `${commit.repositoryId}/${commit.commitId}`, async () => {
            const body = await AzdoClient.get<GitCommit>(
                `_apis/git/repositories/${commit.repositoryId}/commits/${commit.commitId}`,
                "7.1",
                commit.projectId
            );
            const date = body && body.push && body.push.date;
            if (!date) {
                throw new Error("No push date");
            }
            return date;
        }).catch(() => undefined);
    }

    /** Runs of the given pipelines built from the repository, queued from `since` on, finished or not, newest first. */
    private async buildsOf(
        projectId: string,
        repositoryId: string,
        definitionIds: number[],
        since: string
    ): Promise<RepositoryBuild[]> {
        const builds: RepositoryBuild[] = [];
        let continuationToken: string | undefined;

        try {
            for (let page = 0; page < MAX_BUILD_PAGES; page++) {
                const token = continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : "";
                const response = await AzdoClient.getPage<{ value: RepositoryBuild[] }>(
                    `_apis/build/builds?repositoryId=${repositoryId}&repositoryType=TfsGit` +
                        `&definitions=${definitionIds.join(",")}&minTime=${encodeURIComponent(since)}` +
                        `&queryOrder=queueTimeDescending&$top=${BUILD_PAGE_SIZE}${token}`,
                    "7.1",
                    projectId
                );
                builds.push(...((response.body && response.body.value) || []));

                continuationToken = response.continuationToken;
                if (!continuationToken) {
                    break;
                }
            }
        } catch {
            // Partial by design: runs from the pages read so far are kept, later ones are not shown.
        }

        return builds;
    }

    /** Whether the target commit contains the base commit; false when it cannot be read. */
    private contains(projectId: string, repositoryId: string, check: AncestryCheck): Promise<boolean> {
        return cached(this.ancestry, `${repositoryId}/${checkKey(check)}`, async () =>
            containsBase(
                await AzdoClient.get<{ behindCount?: number }>(
                    `_apis/git/repositories/${repositoryId}/diffs/commits` +
                        `?baseVersion=${check.base}&baseVersionType=commit` +
                        `&targetVersion=${check.target}&targetVersionType=commit&$top=1`,
                    "7.1",
                    projectId
                )
            )
        ).catch(() => false);
    }
}

/** Memoizes a successful result. A failure is forgotten, so the next load asks again. */
function cached<T>(cache: Map<string, Promise<T>>, key: string, fetch: () => Promise<T>): Promise<T> {
    let result = cache.get(key);
    if (!result) {
        result = fetch();
        cache.set(key, result);
        result.catch(() => cache.delete(key));
    }
    return result;
}

/** Runs `task` over `items` with at most `limit` in flight, keeping the order of `items`. */
async function inBatches<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    for (let start = 0; start < items.length; start += limit) {
        results.push(...(await Promise.all(items.slice(start, start + limit).map(task))));
    }
    return results;
}

export default new CommitRunService();
