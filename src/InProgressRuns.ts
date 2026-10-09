import { DeploymentRecord, PipelineConfig } from "./Contracts";
import { EnvironmentSummary, RawDeploymentRecord, WorkItemRelation, projectIdOf } from "./Deployments";

/**
 * Finding a work item's runs that are still in progress.
 *
 * Integrated in build links are added only when a run completes. A work item's commit and pull request
 * links name its repositories from the start, so their runs in progress are listed, and Azure DevOps'
 * own list of each run's work items (`builds/{id}/workitems`, the list the build link is made from)
 * decides whether the run includes this work item.
 *
 * Azure Repos only: GitHub links name no repository id.
 *
 * Pure functions here; requests in InProgressRunService.
 */

/** An Azure Repos Git repository. */
export interface Repository {
    projectId: string;
    repositoryId: string;
}

/** A run as listed by the builds API, with the fields used here. */
export interface InProgressBuild {
    id: number;
    buildNumber?: string;
    project?: { id: string };
    definition?: { id: number; name?: string };
}

export interface TimelineRecord {
    id: string;
    parentId?: string | null;
    type?: string;
    name?: string;
    identifier?: string | null;
    state?: string;
}

/** A stage of a run waiting for an approval before it deploys. */
export interface WaitingStage {
    projectId: string;
    definitionId: number;
    pipelineName: string;
    runId: number;
    runName: string;
    stageName: string;
}

/** `vstfs:///Git/Commit/{project}%2F{repository}%2F{sha}`, and the same for PullRequestId. */
const GIT_ARTIFACT = /^vstfs:\/\/\/Git\/(?:Commit|PullRequestId)\/(.+)$/i;

/** The repositories of the work item's commit and pull request links, without duplicates. */
export function repositoriesFromRelations(relations: WorkItemRelation[]): Repository[] {
    const repositories = new Map<string, Repository>();

    for (const relation of relations || []) {
        if (!relation || relation.rel !== "ArtifactLink") {
            continue;
        }
        const match = GIT_ARTIFACT.exec(relation.url || "");
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

/**
 * Maps the items with at most `limit` calls in flight, keeping their order. Bounds the requests a
 * busy repository costs at once.
 */
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

export function waitingStagesOf(run: InProgressBuild, stageNames: string[]): WaitingStage[] {
    if (!run.project || !run.definition) {
        return [];
    }
    const { project, definition } = run;
    return stageNames.map((stageName) => ({
        projectId: project.id,
        definitionId: definition.id,
        pipelineName: definition.name || "",
        runId: run.id,
        runName: run.buildNumber || "",
        stageName,
    }));
}

/** An environment and its deployment records, as read. */
export interface EnvironmentRecords {
    environment: EnvironmentSummary;
    raw: RawDeploymentRecord[];
}

/**
 * A stage that has not run yet has no deployment record, so its environment is not known. A stage can
 * deploy to different environments over time, so it is placed only in the environment of the
 * pipeline's most recent record for the same stage. A stage that never deployed before is not shown.
 */
export function waitingDeployments(stages: WaitingStage[], environments: EnvironmentRecords[]): DeploymentRecord[] {
    const placed: DeploymentRecord[] = [];

    for (const stage of stages) {
        let latest: { environment: EnvironmentSummary; record: RawDeploymentRecord } | undefined;

        for (const { environment, raw } of environments) {
            if ((environment.projectId || "") !== stage.projectId) {
                continue;
            }
            for (const record of raw || []) {
                const sameStage =
                    !!record &&
                    !!record.definition &&
                    record.definition.id === stage.definitionId &&
                    record.stageName === stage.stageName;
                if (sameStage && (!latest || isMoreRecent(record, latest.record))) {
                    latest = { environment, record };
                }
            }
        }

        if (latest) {
            placed.push({
                projectId: stage.projectId,
                environmentId: latest.environment.environmentId,
                recordId: 0,
                environmentName: latest.environment.environmentName,
                stageName: stage.stageName,
                definitionId: stage.definitionId,
                pipelineName: stage.pipelineName,
                runId: stage.runId,
                runName: stage.runName,
                result: "waitingForApproval",
                finishTime: "",
            });
        }
    }

    return placed;
}

/** An unfinished record counts as most recent; ties fall back to the record id. */
function isMoreRecent(a: RawDeploymentRecord, b: RawDeploymentRecord): boolean {
    const aTime = (a.finishTime && Date.parse(a.finishTime)) || Number.POSITIVE_INFINITY;
    const bTime = (b.finishTime && Date.parse(b.finishTime)) || Number.POSITIVE_INFINITY;
    if (aTime !== bTime) {
        return aTime > bTime;
    }
    return (a.id || 0) > (b.id || 0);
}
