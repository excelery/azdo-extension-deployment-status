import { PipelineConfig } from "./Contracts";
import { WorkItemRelation, projectIdOf } from "./Deployments";

/**
 * Finding the runs that contain a work item's commits.
 *
 * Integrated in build links appear only when a run completes. A work item's commit and pull request
 * links exist from the start, so the same runs are found from them while still in progress, waiting
 * on an approval for example. The runs chosen are the ones a build link would name (see `linkedRuns`).
 * A match proves a run's source history contains the commit, not what the deployed artifact contains.
 *
 * Azure Repos only: the Git APIs used here do not cover GitHub repositories.
 *
 * Pure functions here; requests in CommitRunService.
 */

/** A commit in an Azure Repos Git repository. */
export interface CommitRef {
    projectId: string;
    repositoryId: string;
    commitId: string;
}

export interface PullRequestRef {
    projectId: string;
    repositoryId: string;
    pullRequestId: number;
}

export interface GitLinks {
    commits: CommitRef[];
    pullRequests: PullRequestRef[];
}

/** A run as listed by the builds API, with the fields used here. */
export interface RepositoryBuild {
    id: number;
    sourceVersion?: string;
    sourceBranch?: string;
    queueTime?: string;
    result?: string;
    project?: { id: string };
    definition?: { id: number };
}

export interface PullRequest {
    status?: string;
    lastMergeCommit?: { commitId?: string };
}

/** Does `target` contain `base`? */
export interface AncestryCheck {
    base: string;
    target: string;
}

/** `vstfs:///Git/Commit/{project}%2F{repository}%2F{sha}`, and the same for PullRequestId. */
const GIT_ARTIFACT = /^vstfs:\/\/\/Git\/(Commit|PullRequestId)\/(.+)$/i;

export function gitLinksFromRelations(relations: WorkItemRelation[]): GitLinks {
    const commits = new Map<string, CommitRef>();
    const pullRequests = new Map<string, PullRequestRef>();

    for (const relation of relations || []) {
        if (!relation || relation.rel !== "ArtifactLink") {
            continue;
        }
        const match = GIT_ARTIFACT.exec(relation.url || "");
        if (!match) {
            continue;
        }
        const [projectId, repositoryId, id] = decodeURIComponent(match[2]).split("/");
        if (!projectId || !repositoryId || !id) {
            continue;
        }
        if (match[1].toLowerCase() === "commit") {
            const commit = { projectId, repositoryId, commitId: id.toLowerCase() };
            commits.set(commitKey(commit), commit);
        } else if (/^\d+$/.test(id)) {
            pullRequests.set(`${repositoryId}/${id}`, { projectId, repositoryId, pullRequestId: Number(id) });
        }
    }

    return { commits: Array.from(commits.values()), pullRequests: Array.from(pullRequests.values()) };
}

/** A completed pull request's merge commit. An active one has not been merged into anything yet. */
export function mergeCommitOf(pullRequest: PullRequest | undefined, ref: PullRequestRef): CommitRef | undefined {
    const commitId = pullRequest && pullRequest.lastMergeCommit && pullRequest.lastMergeCommit.commitId;
    if (!pullRequest || pullRequest.status !== "completed" || !commitId) {
        return undefined;
    }
    return { projectId: ref.projectId, repositoryId: ref.repositoryId, commitId: commitId.toLowerCase() };
}

export function commitKey(commit: CommitRef): string {
    return `${commit.repositoryId}/${commit.commitId}`.toLowerCase();
}

/** Commits grouped by repository, without duplicates. */
export function byRepository(commits: CommitRef[]): CommitRef[][] {
    const repositories = new Map<string, Map<string, CommitRef>>();
    for (const commit of commits) {
        const repository = commit.repositoryId.toLowerCase();
        const inRepository = repositories.get(repository) || new Map<string, CommitRef>();
        inRepository.set(commitKey(commit), commit);
        repositories.set(repository, inRepository);
    }
    return Array.from(repositories.values()).map((inRepository) => Array.from(inRepository.values()));
}

/** Pipelines with Boards Integration enabled, as definition ids per project. */
export function enabledPipelinesByProject(configs: Map<string, PipelineConfig>): Map<string, number[]> {
    const byProject = new Map<string, number[]>();
    configs.forEach((config) => {
        const projectId = config && config.enabled ? projectIdOf(config) : "";
        if (!projectId) {
            return;
        }
        byProject.set(projectId, (byProject.get(projectId) || []).concat(config.definitionId));
    });
    return byProject;
}

/** The earliest of the timestamps, so one build listing covers every commit of a repository. */
export function earliest(times: string[]): string | undefined {
    const parsed = times.map((time) => Date.parse(time)).filter((time) => !isNaN(time));
    return parsed.length ? new Date(Math.min(...parsed)).toISOString() : undefined;
}

export function checkKey(check: AncestryCheck): string {
    return `${check.base}..${check.target}`;
}

/**
 * Whether a commit diff says `target` contains `base`. Comparing base to target, `behindCount` is the
 * number of base commits missing from target; zero means base is an ancestor of target, or the same.
 */
export function containsBase(diff: { behindCount?: number } | undefined): boolean {
    return !!diff && diff.behindCount === 0;
}

export function sourceVersionOf(build: RepositoryBuild): string | undefined {
    return build && build.sourceVersion ? build.sourceVersion.toLowerCase() : undefined;
}

/** Runs per pipeline and branch, oldest first. */
export function byPipelineAndBranch(builds: RepositoryBuild[]): RepositoryBuild[][] {
    const groups = new Map<string, RepositoryBuild[]>();
    for (const build of builds || []) {
        if (!build || !build.definition || !sourceVersionOf(build)) {
            continue;
        }
        const key = `${build.project ? build.project.id : ""}/${build.definition.id}/${build.sourceBranch || ""}`;
        groups.set(key, (groups.get(key) || []).concat(build));
    }
    return Array.from(groups.values()).map((runs) => runs.slice().sort(oldestFirst));
}

function oldestFirst(a: RepositoryBuild, b: RepositoryBuild): number {
    return (Date.parse(a.queueTime || "") || 0) - (Date.parse(b.queueTime || "") || 0) || a.id - b.id;
}

/**
 * The index of the first run that contains the commit, or -1. Along one branch, once a run contains
 * a commit every later run does too, so a binary search needs only a few checks however many runs
 * there are. A run queued later for an older commit, a manual run for example, breaks that order and
 * can move the answer to a neighbouring run.
 */
export async function firstContaining(
    runs: RepositoryBuild[],
    contains: (run: RepositoryBuild) => Promise<boolean>
): Promise<number> {
    let low = 0;
    let high = runs.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (await contains(runs[middle])) {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    return low < runs.length ? low : -1;
}

/**
 * The runs an Integrated in build link would name, per pipeline and branch. A run includes the work
 * items of the commits since the pipeline's last successful run, so the first run containing the
 * commit is linked, and so is each later run until one succeeds: a failed, canceled or unfinished run
 * passes the work item on to the next.
 */
export async function linkedRuns(
    builds: RepositoryBuild[],
    contains: (run: RepositoryBuild) => Promise<boolean>
): Promise<RepositoryBuild[]> {
    const perGroup = await Promise.all(
        byPipelineAndBranch(builds).map(async (runs) => {
            const first = await firstContaining(runs, contains);
            return first < 0 ? [] : throughFirstSuccess(runs.slice(first));
        })
    );
    return perGroup.reduce((all, some) => all.concat(some), [] as RepositoryBuild[]);
}

function throughFirstSuccess(runs: RepositoryBuild[]): RepositoryBuild[] {
    const succeeded = runs.findIndex((run) => run.result === "succeeded");
    return succeeded < 0 ? runs : runs.slice(0, succeeded + 1);
}
