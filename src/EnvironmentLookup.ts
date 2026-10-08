import { RawDeploymentRecord, WorkItemRelation } from "./Deployments";

/**
 * Finding a work item's deployments from environments, without Integrated in build links.
 *
 * A commit link gives the repository and the time the commit was linked. Per the work tracking
 * rules (a run picks up every commit since the last successful run of its branch), the first run
 * of a pipeline queued after that time is the one that carries the commit. It is confirmed with
 * the work items between that run and the run before it, and every environment that deployed that
 * run or a later one has the work item. Pure functions here; requests in EnvironmentLookupService.
 */

export interface CommitLink {
    projectId: string;
    repositoryId: string;
    commitId: string;
    /** When the commit was linked to the work item; empty when unknown. */
    linkedAt: string;
}

export interface RepositoryLink {
    projectId: string;
    repositoryId: string;
    /** The earliest time any of the work item's commits in this repository was linked. */
    since: number;
}

export interface RunCandidate {
    runId: number;
    /** The pipeline's previous deployed run, the start of the work item range; absent for the first. */
    previousRunId?: number;
}

/** vstfs:///Git/Commit/{projectId}%2F{repositoryId}%2F{commitId} */
const COMMIT_ARTIFACT = /^vstfs:\/\/\/Git\/Commit\/([^%/]+)%2F([^%/]+)%2F([0-9a-f]{40})$/i;

export function commitLinksFromRelations(relations: WorkItemRelation[]): CommitLink[] {
    const links: CommitLink[] = [];
    const seen = new Set<string>();

    for (const relation of relations || []) {
        if (!relation || relation.rel !== "ArtifactLink") {
            continue;
        }
        const match = COMMIT_ARTIFACT.exec(relation.url || "");
        if (!match) {
            continue;
        }
        const [, projectId, repositoryId, commitId] = match;
        const key = `${repositoryId}/${commitId}`.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        links.push({
            projectId,
            repositoryId,
            commitId: commitId.toLowerCase(),
            linkedAt: (relation.attributes && relation.attributes.authorizedDate) || "",
        });
    }

    return links;
}

/** One entry per repository, with the earliest link time; an unknown time means "from the start". */
export function repositoriesOf(commits: CommitLink[]): RepositoryLink[] {
    const byRepository = new Map<string, RepositoryLink>();

    for (const commit of commits) {
        const key = `${commit.projectId}/${commit.repositoryId}`.toLowerCase();
        const time = Date.parse(commit.linkedAt) || 0;
        const existing = byRepository.get(key);
        if (!existing) {
            byRepository.set(key, { projectId: commit.projectId, repositoryId: commit.repositoryId, since: time });
        } else {
            existing.since = Math.min(existing.since, time);
        }
    }

    return Array.from(byRepository.values());
}

/**
 * The first few runs of a pipeline queued at or after `since`, oldest first, each with the
 * pipeline's previous deployed run. Records may come from several environments; runs are
 * de-duplicated.
 */
export function runsAfter(
    records: RawDeploymentRecord[],
    definitionId: number,
    since: number,
    max = 3
): RunCandidate[] {
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

    for (let index = 0; index < runs.length && candidates.length < max; index++) {
        if (queued.get(runs[index])! >= since) {
            candidates.push({ runId: runs[index], previousRunId: index > 0 ? runs[index - 1] : undefined });
        }
    }

    return candidates;
}

/** A pipeline's deployments of the run that carried the work item, or of any later run. */
export function deploymentsFrom(
    records: RawDeploymentRecord[],
    definitionId: number,
    firstRunId: number
): RawDeploymentRecord[] {
    return (records || []).filter(
        (record) =>
            !!record &&
            !!record.owner &&
            !!record.definition &&
            record.definition.id === definitionId &&
            record.owner.id >= firstRunId
    );
}

/**
 * Records come newest first. Once a page reaches a record queued before `since`, the run before
 * the work item's commit is known and older pages cannot matter.
 */
export function reachedBefore(page: RawDeploymentRecord[], since: number): boolean {
    return (page || []).some((record) => !!record && (Date.parse(record.queueTime || "") || 0) < since);
}
