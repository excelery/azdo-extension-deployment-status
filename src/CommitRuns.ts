import { PipelineConfig } from "./Contracts";
import { WorkItemRelation, projectIdOf } from "./Deployments";

/**
 * Finding the runs that contain a work item's commits.
 *
 * Integrated in build links appear only when a run completes. A work item's commit and pull request
 * links exist from the start, so the runs built from those commits, or from later commits that
 * include them, are found while they are still in progress, waiting on an approval for example.
 * This proves a run's source history contains the commit. It does not prove that a deployment
 * first introduced the work item, or what the deployed artifact contains.
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
    project?: { id: string };
    definition?: { id: number };
}

export interface PullRequest {
    status?: string;
    lastMergeCommit?: { commitId?: string };
}

/** A pair whose ancestry decides a match: does `target` contain `base`? */
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

/**
 * The ancestry checks needed to decide which builds contain a linked commit. A build of the linked
 * commit itself needs none, and each distinct pair is checked once.
 */
export function ancestryChecks(builds: RepositoryBuild[], linkedCommits: string[]): AncestryCheck[] {
    const checks = new Map<string, AncestryCheck>();
    for (const target of sourceVersions(builds)) {
        if (linkedCommits.includes(target)) {
            continue;
        }
        for (const base of linkedCommits) {
            checks.set(checkKey({ base, target }), { base, target });
        }
    }
    return Array.from(checks.values());
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

/** The builds whose source is a linked commit or contains one. */
export function buildsContaining(
    builds: RepositoryBuild[],
    linkedCommits: string[],
    contains: (check: AncestryCheck) => boolean
): RepositoryBuild[] {
    return builds.filter((build) => {
        const target = sourceVersionOf(build);
        return (
            !!target &&
            linkedCommits.some((base) => base === target || contains({ base, target }))
        );
    });
}

function sourceVersionOf(build: RepositoryBuild): string | undefined {
    return build && build.sourceVersion ? build.sourceVersion.toLowerCase() : undefined;
}

function sourceVersions(builds: RepositoryBuild[]): string[] {
    const versions = new Set<string>();
    for (const build of builds || []) {
        const version = sourceVersionOf(build);
        if (version) {
            versions.add(version);
        }
    }
    return Array.from(versions);
}
