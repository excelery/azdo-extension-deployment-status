import {
    DEPLOYMENT_TYPE_ORDER,
    DeploymentRecord,
    DeploymentType,
    PipelineConfig,
    mappingFor,
} from "./Contracts";

export interface PipelineDeployments {
    definitionId: number;
    pipelineName: string;
    latest: DeploymentRecord;
    history: DeploymentRecord[];
}

export interface GroupedDeployments {
    deploymentType: DeploymentType;
    pipelines: PipelineDeployments[];
}

export interface WorkItemRelation {
    rel: string;
    url: string;
    attributes?: { name?: string };
}

export interface RawDeploymentRecord {
    id?: number;
    stageName?: string;
    definition?: { id: number; name: string };
    owner?: { id: number; name: string };
    result?: string;
    finishTime?: string;
}

export interface EnvironmentSummary {
    environmentId: number;
    environmentName: string;
}

const BUILD_ARTIFACT = /^vstfs:\/\/\/Build\/Build\/(\d+)$/i;
const BUILD_LINK_NAME = "Integrated in build";

const RESULTS: Record<string, DeploymentRecord["result"]> = {
    succeeded: "succeeded",
    partiallySucceeded: "partiallySucceeded",
    failed: "failed",
    canceled: "canceled",
    skipped: "skipped",
    abandoned: "canceled",
};

function resultOf(record: RawDeploymentRecord): DeploymentRecord["result"] {
    const known = record.result ? RESULTS[record.result] : undefined;
    if (known) {
        return known;
    }
    return record.finishTime ? "unknown" : "inProgress";
}

/**
 * Newest first. An unfinished deployment has no finish time and counts as newest, since it is still
 * running. Ties fall back to run id so the order never depends on the order the API returned.
 */
export function byMostRecent(a: DeploymentRecord, b: DeploymentRecord): number {
    const aTime = Date.parse(a.finishTime) || Number.POSITIVE_INFINITY;
    const bTime = Date.parse(b.finishTime) || Number.POSITIVE_INFINITY;
    if (aTime !== bTime) {
        return aTime < bTime ? 1 : -1;
    }
    return b.runId - a.runId;
}

/**
 * Extension data is shared across the organization, and definition ids are only unique within a
 * project, so configs are filtered by the `<projectId>-` document id prefix before keying them.
 */
export function configsForProject(documents: PipelineConfig[], projectId: string): Map<number, PipelineConfig> {
    const prefix = `${projectId}-`;
    const configs = new Map<number, PipelineConfig>();

    for (const document of documents || []) {
        if (!document || typeof document.id !== "string" || !document.id.startsWith(prefix)) {
            continue;
        }
        if (document.id.slice(prefix.length) !== String(document.definitionId)) {
            continue;
        }
        configs.set(document.definitionId, document);
    }

    return configs;
}

/**
 * Deployment records come newest first. Once a whole page belongs to runs older than every run the
 * work item links to, later pages cannot hold a wanted record, so paging can stop.
 */
export function olderThanRuns(page: RawDeploymentRecord[], runIds: number[]): boolean {
    if (!page.length || !runIds.length) {
        return false;
    }
    const oldestWanted = Math.min(...runIds);
    return page.every((record) => !!record && !!record.owner && record.owner.id < oldestWanted);
}

export function runIdsFromRelations(relations: WorkItemRelation[]): number[] {
    const runIds = new Set<number>();

    for (const relation of relations || []) {
        if (!relation || relation.rel !== "ArtifactLink") {
            continue;
        }
        const attributes = relation.attributes || {};
        if (attributes.name !== BUILD_LINK_NAME) {
            continue;
        }
        const match = BUILD_ARTIFACT.exec(relation.url || "");
        if (match) {
            runIds.add(Number(match[1]));
        }
    }

    return Array.from(runIds);
}

export function toDeploymentRecords(
    environment: EnvironmentSummary,
    raw: RawDeploymentRecord[],
    runIds: number[]
): DeploymentRecord[] {
    const wanted = new Set(runIds);

    return (raw || [])
        .filter((record) => !!record && !!record.owner && !!record.definition && wanted.has(record.owner.id))
        .map((record) => ({
            environmentId: environment.environmentId,
            recordId: record.id || 0,
            environmentName: environment.environmentName,
            stageName: record.stageName || "",
            definitionId: record.definition!.id,
            pipelineName: record.definition!.name,
            runId: record.owner!.id,
            runName: record.owner!.name,
            result: resultOf(record),
            finishTime: record.finishTime || "",
        }));
}

export function mappedEnvironments(configs: Map<number, PipelineConfig>): EnvironmentSummary[] {
    const mapped = new Map<number, EnvironmentSummary>();

    configs.forEach((config) => {
        if (!config || !config.enabled || !config.environments) {
            return;
        }
        for (const id of Object.keys(config.environments)) {
            const mapping = config.environments[id];
            if (!mapping.enabled || mapping.deploymentType === "unmapped") {
                continue;
            }
            mapped.set(Number(id), {
                environmentId: Number(id),
                environmentName: mapping.environmentName || "",
            });
        }
    });

    return Array.from(mapped.values());
}

export function groupDeployments(
    records: DeploymentRecord[],
    configs: Map<number, PipelineConfig>
): GroupedDeployments[] {
    const byType = new Map<DeploymentType, Map<number, DeploymentRecord[]>>();

    for (const record of records) {
        const mapping = mappingFor(configs.get(record.definitionId), record.environmentId);
        if (!mapping) {
            continue;
        }

        if (!byType.has(mapping.deploymentType)) {
            byType.set(mapping.deploymentType, new Map());
        }
        const byPipeline = byType.get(mapping.deploymentType)!;
        if (!byPipeline.has(record.definitionId)) {
            byPipeline.set(record.definitionId, []);
        }
        byPipeline.get(record.definitionId)!.push(record);
    }

    const groups: GroupedDeployments[] = [];

    byType.forEach((byPipeline, deploymentType) => {
        const pipelines: PipelineDeployments[] = [];

        byPipeline.forEach((pipelineRecords, definitionId) => {
            const history = pipelineRecords
                .slice()
                .sort(byMostRecent);
            pipelines.push({
                definitionId,
                pipelineName: history[0].pipelineName,
                latest: history[0],
                history,
            });
        });

        pipelines.sort((a, b) => byMostRecent(a.latest, b.latest));
        groups.push({ deploymentType, pipelines });
    });

    return groups;
}

export function orderGroups(groups: GroupedDeployments[]): GroupedDeployments[] {
    return DEPLOYMENT_TYPE_ORDER.map((type) =>
        groups.find((group) => group.deploymentType === type)
    ).filter((group): group is GroupedDeployments => !!group);
}

/** Matches the built-in Deployment control: "59m ago", "3h ago", then "May 26". */
export function relativeTime(iso: string, now: number = Date.now()): string {
    const timestamp = Date.parse(iso);
    if (!timestamp) {
        return "";
    }

    const minutes = Math.floor((now - timestamp) / 60000);
    if (minutes < 1) {
        return "Just now";
    }
    if (minutes < 60) {
        return `${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}h ago`;
    }

    const date = new Date(timestamp);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
    });
}
