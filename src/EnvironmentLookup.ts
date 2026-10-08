import { RawDeploymentRecord, WorkItemRelation } from "./Deployments";

/**
 * Finding a work item's deployments from environments, without Integrated in build links.
 *
 * A code link (commit, pull request or branch) gives the repository and the time it was linked.
 * By the work tracking rule (a run picks up every change since the last successful run of its
 * branch), the first run on a branch queued after that time carries the change. It is confirmed
 * with the work items between that run and the pipeline's previous deployed run, and every later
 * deployment of the same branch carries it too. Pure functions here; requests in
 * EnvironmentLookupService.
 */

export interface CodeLink {
    projectId: string;
    repositoryId: string;
    /** A commit link, as opposed to a pull request or branch link. */
    commit: boolean;
    /** When the link was added to the work item; empty when unknown. */
    linkedAt: string;
}

export interface RepositoryLink {
    projectId: string;
    repositoryId: string;
    /** The earliest time any of the work item's links to this repository was added. */
    since: number;
}

export interface RunCandidate {
    runId: number;
    /** The pipeline's previous deployed run, the start of the work item range; absent for the first. */
    previousRunId?: number;
}

/**
 * vstfs:///Git/Commit/{project}%2F{repository}%2F{commit}
 * vstfs:///Git/PullRequestId/{project}%2F{repository}%2F{pullRequest}
 * vstfs:///Git/Ref/{project}%2F{repository}%2FGB{branch}
 */
const CODE_ARTIFACT = /^vstfs:\/\/\/Git\/(Commit|PullRequestId|Ref)\/([^%/]+)%2F([^%/]+)%2F.+$/i;

export function codeLinksFromRelations(relations: WorkItemRelation[]): CodeLink[] {
    const links: CodeLink[] = [];

    for (const relation of relations || []) {
        if (!relation || relation.rel !== "ArtifactLink") {
            continue;
        }
        const match = CODE_ARTIFACT.exec(relation.url || "");
        if (!match) {
            continue;
        }
        links.push({
            projectId: match[2],
            repositoryId: match[3].toLowerCase(),
            commit: match[1].toLowerCase() === "commit",
            linkedAt: (relation.attributes && relation.attributes.authorizedDate) || "",
        });
    }

    return links;
}

/**
 * One entry per repository with the earliest link time; an unknown time means "from the start".
 * Commit links are what a run picks up, so when a repository has any, they set the time, and an
 * early branch or pull request link does not widen the search.
 */
export function repositoriesOf(links: CodeLink[]): RepositoryLink[] {
    const commitsOnly = new Set(links.filter((link) => link.commit).map((link) => link.repositoryId));
    links = links.filter((link) => link.commit || !commitsOnly.has(link.repositoryId));

    const byRepository = new Map<string, RepositoryLink>();

    for (const link of links) {
        const time = Date.parse(link.linkedAt) || 0;
        const existing = byRepository.get(link.repositoryId);
        if (!existing) {
            byRepository.set(link.repositoryId, { projectId: link.projectId, repositoryId: link.repositoryId, since: time });
        } else {
            existing.since = Math.min(existing.since, time);
        }
    }

    return Array.from(byRepository.values());
}

/**
 * A pipeline's deployed runs queued at or after `since`, oldest first, each with the pipeline's
 * previous deployed run. Records may come from several environments; runs are de-duplicated.
 */
export function runsAfter(records: RawDeploymentRecord[], definitionId: number, since: number): RunCandidate[] {
    const queued = new Map<number, number>();
    for (const record of records || []) {
        if (!record || !record.owner || !record.definition || record.definition.id !== definitionId) {
            continue;
        }
        const time = Date.parse(record.queueTime || "") || 0;
        const known = queued.get(record.owner.id);
        queued.set(record.owner.id, known === undefined ? time : Math.min(known, time));
    }

    const runs = Array.from(queued.keys()).sort((a, b) => a - b);
    const candidates: RunCandidate[] = [];
    runs.forEach((runId, index) => {
        if (queued.get(runId)! >= since) {
            candidates.push({ runId, previousRunId: index > 0 ? runs[index - 1] : undefined });
        }
    });
    return candidates;
}

/**
 * Candidates grouped by branch, oldest first within each. Runs whose branch is unknown (deleted
 * beyond recovery) form their own group.
 */
export function byBranch(candidates: RunCandidate[], branchOf: Map<number, string>): RunCandidate[][] {
    const groups = new Map<string, RunCandidate[]>();
    for (const candidate of candidates) {
        const branch = branchOf.get(candidate.runId) || "";
        if (!groups.has(branch)) {
            groups.set(branch, []);
        }
        groups.get(branch)!.push(candidate);
    }
    return Array.from(groups.values());
}

/**
 * The first run in a branch's runs that brought the work item, found by halving. `contains(from,
 * to)` says whether the work item came in after run `from` up to run `to`; `from` is undefined for
 * "from the start". One check for the whole range, then about log2(runs) more. Returns undefined
 * when the work item is not in the range at all.
 */
export async function firstContaining(
    runs: RunCandidate[],
    contains: (fromRunId: number | undefined, toRunId: number) => Promise<boolean>
): Promise<number | undefined> {
    if (!runs.length) {
        return undefined;
    }
    const start = runs[0].previousRunId;
    if (!(await contains(start, runs[runs.length - 1].runId))) {
        return undefined;
    }
    let low = 0;
    let high = runs.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (await contains(start, runs[middle].runId)) {
            high = middle;
        } else {
            low = middle + 1;
        }
    }
    return runs[low].runId;
}

/**
 * The branch the pipeline deploys from: the branch of its newest deployed run. Used when a run can
 * no longer be confirmed because retention deleted it.
 */
export function deployingBranch(candidates: RunCandidate[], branchOf: Map<number, string>): string {
    for (let index = candidates.length - 1; index >= 0; index--) {
        const branch = branchOf.get(candidates[index].runId);
        if (branch) {
            return branch;
        }
    }
    return "";
}

/** The runs that carry the change: the first run and every later run on the same branch. */
export function carriedRuns(
    candidates: RunCandidate[],
    branchOf: Map<number, string>,
    firstRunId: number
): Set<number> {
    const branch = branchOf.get(firstRunId) || "";
    const carried = new Set<number>();
    for (const candidate of candidates) {
        const candidateBranch = branchOf.get(candidate.runId) || "";
        if (candidate.runId >= firstRunId && (!branch || !candidateBranch || candidateBranch === branch)) {
            carried.add(candidate.runId);
        }
    }
    return carried;
}

/** A pipeline's deployments of the given runs. */
export function deploymentsOfRuns(
    records: RawDeploymentRecord[],
    definitionId: number,
    runs: Set<number>
): RawDeploymentRecord[] {
    return (records || []).filter(
        (record) =>
            !!record &&
            !!record.owner &&
            !!record.definition &&
            record.definition.id === definitionId &&
            runs.has(record.owner.id)
    );
}

/**
 * Records come newest first. Once a page reaches a record queued before `since`, the run before
 * the change is known and older pages cannot matter.
 */
export function reachedBefore(page: RawDeploymentRecord[], since: number): boolean {
    return (page || []).some((record) => !!record && (Date.parse(record.queueTime || "") || 0) < since);
}
