import {
    DEPLOYMENT_TYPE_ORDER,
    DeploymentRecord,
    DeploymentType,
    PipelineConfig,
    mappingFor,
} from "./Contracts";

export interface PipelineDeployments {
    projectId: string;
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
    /** The project the environment belongs to; omitted means the current project. */
    projectId?: string;
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

/** Identifies a pipeline across the organization, since definition ids are only unique per project. */
export function pipelineKey(projectId: string, definitionId: number): string {
    return `${projectId}-${definitionId}`;
}

/** The project a config belongs to, from its `<projectId>-<definitionId>` document id. */
export function projectIdOf(config: PipelineConfig): string {
    const suffix = `-${config.definitionId}`;
    return config.id.endsWith(suffix) ? config.id.slice(0, -suffix.length) : "";
}

/**
 * Extension data is shared across the organization. Every project's configs are kept, keyed by
 * their `<projectId>-<definitionId>` document id, so a work item can show deployments from
 * pipelines in other projects.
 */
export function configsByPipeline(documents: PipelineConfig[]): Map<string, PipelineConfig> {
    const configs = new Map<string, PipelineConfig>();

    for (const document of documents || []) {
        const projectId = document && typeof document.id === "string" ? projectIdOf(document) : "";
        // Settings saved outside a project fall back to an "unknown" project id.
        if (!projectId || projectId === "unknown") {
            continue;
        }
        configs.set(document.id, document);
    }

    return configs;
}

export interface LinkedBuild {
    id: number;
    project?: { id: string };
    definition?: { id: number };
}

/** The pipelines, as `<projectId>-<definitionId>` keys, that built the linked runs. */
export function pipelinesOfBuilds(builds: LinkedBuild[]): Set<string> {
    const pipelines = new Set<string>();
    for (const build of builds || []) {
        if (build && build.project && build.project.id && build.definition) {
            pipelines.add(pipelineKey(build.project.id, build.definition.id));
        }
    }
    return pipelines;
}

/**
 * The configs worth querying for a work item. The work item's own project is always kept, so runs
 * the build lookup no longer returns (deleted by retention) still show. Other projects are kept
 * only for the pipelines that built one of the linked runs.
 */
export function relevantConfigs(
    configs: Map<string, PipelineConfig>,
    currentProjectId: string,
    linkedPipelines: Set<string>
): Map<string, PipelineConfig> {
    const relevant = new Map<string, PipelineConfig>();
    configs.forEach((config, key) => {
        if (projectIdOf(config) === currentProjectId || linkedPipelines.has(key)) {
            relevant.set(key, config);
        }
    });
    return relevant;
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
            projectId: environment.projectId || "",
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

export function mappedEnvironments(configs: Map<string, PipelineConfig>): EnvironmentSummary[] {
    const mapped = new Map<string, EnvironmentSummary>();

    configs.forEach((config) => {
        if (!config || !config.enabled || !config.environments) {
            return;
        }
        const projectId = projectIdOf(config);
        for (const id of Object.keys(config.environments)) {
            const mapping = config.environments[id];
            if (!mapping.enabled || mapping.deploymentType === "unmapped") {
                continue;
            }
            // Environment ids are only unique within a project.
            mapped.set(`${projectId}:${id}`, {
                projectId,
                environmentId: Number(id),
                environmentName: mapping.environmentName || "",
            });
        }
    });

    return Array.from(mapped.values());
}

export function groupDeployments(
    records: DeploymentRecord[],
    configs: Map<string, PipelineConfig>
): GroupedDeployments[] {
    const byType = new Map<DeploymentType, Map<string, DeploymentRecord[]>>();

    for (const record of records) {
        const key = pipelineKey(record.projectId, record.definitionId);
        const mapping = mappingFor(configs.get(key), record.environmentId);
        if (!mapping) {
            continue;
        }

        if (!byType.has(mapping.deploymentType)) {
            byType.set(mapping.deploymentType, new Map());
        }
        const byPipeline = byType.get(mapping.deploymentType)!;
        if (!byPipeline.has(key)) {
            byPipeline.set(key, []);
        }
        byPipeline.get(key)!.push(record);
    }

    const groups: GroupedDeployments[] = [];

    byType.forEach((byPipeline, deploymentType) => {
        const pipelines: PipelineDeployments[] = [];

        byPipeline.forEach((pipelineRecords) => {
            const history = pipelineRecords
                .slice()
                .sort(byMostRecent);
            pipelines.push({
                projectId: history[0].projectId,
                definitionId: history[0].definitionId,
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
