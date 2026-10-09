import { PipelineConfig } from "./Contracts";
import { WorkItemRelation, pipelineKey, projectIdOf } from "./Deployments";

/**
 * A work item's runs: the pipeline runs that include it.
 *
 * Completed runs are its Integrated in build links. Azure DevOps adds a link only when a run
 * completes, so runs in progress are found through the repositories of the work item's commit and
 * pull request links, and kept when Azure DevOps lists the work item on the run (the list the link is
 * made from).
 *
 * Pure functions here; requests in RunService.
 */

/** The open work item, with what finding its runs needs. */
export interface WorkItem {
    id: number;
    projectId: string;
    relations: WorkItemRelation[];
    /** Every project's Boards Integration settings, keyed `<projectId>-<definitionId>`. */
    configs: Map<string, PipelineConfig>;
}

export interface Pipeline {
    projectId: string;
    definitionId: number;
    name: string;
}

export interface Run {
    id: number;
    name: string;
    /** Unknown when the run was deleted by retention: only its build link is left. */
    pipeline?: Pipeline;
    /** Stages waiting for an approval. They have no deployment record yet. */
    waitingStages: string[];
}

/** A run as the builds API returns it, with the fields used here. */
export interface Build {
    id: number;
    buildNumber?: string;
    project?: { id: string };
    definition?: { id: number; name?: string };
}

/** An Azure Repos Git repository. */
export interface Repository {
    projectId: string;
    repositoryId: string;
}

export interface TimelineRecord {
    id: string;
    parentId?: string | null;
    type?: string;
    name?: string;
    identifier?: string | null;
    state?: string;
}

const BUILD_LINK = /^vstfs:\/\/\/Build\/Build\/(\d+)$/i;
const BUILD_LINK_NAME = "Integrated in build";
/** `vstfs:///Git/Commit/{project}%2F{repository}%2F{sha}`, and the same for PullRequestId. */
const CODE_LINK = /^vstfs:\/\/\/Git\/(?:Commit|PullRequestId)\/(.+)$/i;

/** The run ids of the work item's Integrated in build links. */
export function buildLinkIds(relations: WorkItemRelation[]): number[] {
    const runIds = new Set<number>();
    for (const relation of relations || []) {
        if (!relation || relation.rel !== "ArtifactLink" || !relation.attributes) {
            continue;
        }
        const match = relation.attributes.name === BUILD_LINK_NAME && BUILD_LINK.exec(relation.url || "");
        if (match) {
            runIds.add(Number(match[1]));
        }
    }
    return Array.from(runIds);
}

/** The repositories of the work item's commit and pull request links, once each. */
export function repositoriesFromRelations(relations: WorkItemRelation[]): Repository[] {
    const repositories = new Map<string, Repository>();
    for (const relation of relations || []) {
        const match = relation && relation.rel === "ArtifactLink" && CODE_LINK.exec(relation.url || "");
        if (!match) {
            continue;
        }
        const [projectId, repositoryId] = decodeURIComponent(match[1]).split("/");
        if (projectId && repositoryId) {
            repositories.set(repositoryId.toLowerCase(), { projectId, repositoryId });
        }
    }
    return Array.from(repositories.values());
}

/** The definition ids of a project's pipelines with Boards Integration enabled. */
export function enabledDefinitions(configs: Map<string, PipelineConfig>, projectId: string): number[] {
    const definitionIds: number[] = [];
    configs.forEach((config) => {
        if (config && config.enabled && projectIdOf(config) === projectId) {
            definitionIds.push(config.definitionId);
        }
    });
    return definitionIds;
}

/** Whether a run's work items, as `builds/{id}/workitems` lists them, include the work item. */
export function includesWorkItem(workItems: { id?: string | number }[] | undefined, workItemId: number): boolean {
    return (workItems || []).some((workItem) => !!workItem && Number(workItem.id) === workItemId);
}

export function runOf(build: Build, waitingStages: string[] = []): Run {
    const { project, definition } = build;
    return {
        id: build.id,
        name: build.buildNumber || "",
        pipeline:
            project && project.id && definition
                ? { projectId: project.id, definitionId: definition.id, name: definition.name || "" }
                : undefined,
        waitingStages,
    };
}

/**
 * A linked run is in progress again when a stage is rerun, so it can be found both ways. The run in
 * progress is kept: it carries the stages waiting for an approval.
 */
export function mergeRuns(completed: Run[], running: Run[]): Run[] {
    const runs = new Map<number, Run>();
    completed.concat(running).forEach((run) => runs.set(run.id, run));
    return Array.from(runs.values());
}

/**
 * The settings of the pipelines that built the runs: only their environments are read. A run deleted
 * by retention has no known pipeline, but its deployment records survive, so then every pipeline of
 * the work item's project is read too.
 */
export function configsOf(runs: Run[], workItem: WorkItem): Map<string, PipelineConfig> {
    const pipelines = new Set<string>();
    runs.forEach((run) => run.pipeline && pipelines.add(pipelineKey(run.pipeline.projectId, run.pipeline.definitionId)));
    const wholeProject = runs.some((run) => !run.pipeline) ? workItem.projectId : undefined;

    const configs = new Map<string, PipelineConfig>();
    workItem.configs.forEach((config, key) => {
        if (pipelines.has(key) || projectIdOf(config) === wholeProject) {
            configs.set(key, config);
        }
    });
    return configs;
}

/**
 * The stages of a run waiting for an approval: a stage whose checkpoint holds an approval still in
 * progress. Named by the stage identifier, as deployment records name it.
 */
export function stagesWaitingForApproval(timeline: TimelineRecord[] | undefined): string[] {
    const records = new Map<string, TimelineRecord>();
    for (const record of timeline || []) {
        if (record && record.id) {
            records.set(record.id, record);
        }
    }

    const stages = new Set<string>();
    records.forEach((record) => {
        if (record.type !== "Checkpoint.Approval" || record.state !== "inProgress") {
            return;
        }
        const stage = stageOf(record, records);
        const name = stage && (stage.identifier || stage.name);
        if (name) {
            stages.add(name);
        }
    });
    return Array.from(stages);
}

function stageOf(record: TimelineRecord, records: Map<string, TimelineRecord>): TimelineRecord | undefined {
    const visited = new Set<string>();
    let current: TimelineRecord | undefined = record;
    while (current && !visited.has(current.id)) {
        if (current.type === "Stage") {
            return current;
        }
        visited.add(current.id);
        current = current.parentId ? records.get(current.parentId) : undefined;
    }
    return undefined;
}

/** Maps the items with at most `limit` calls in flight, keeping their order. */
export async function mapLimited<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await map(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
