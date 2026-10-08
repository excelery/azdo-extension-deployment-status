
export type DeploymentType = "unmapped" | "development" | "staging" | "production";

export const DEPLOYMENT_TYPE_LABELS: Record<DeploymentType, string> = {
    unmapped: "Unmapped",
    development: "Development",
    staging: "Staging",
    production: "Production",
};

export const DEPLOYMENT_TYPES: DeploymentType[] = ["unmapped", "development", "staging", "production"];

export const DEPLOYMENT_TYPE_ORDER: DeploymentType[] = ["production", "staging", "development"];

export interface EnvironmentMapping {
    enabled: boolean;
    deploymentType: DeploymentType;
    environmentName?: string;
}

export interface PipelineConfig {
    id: string;
    definitionId: number;
    enabled: boolean;
    /** Keyed by environment id. */
    environments: Record<string, EnvironmentMapping>;
    __etag?: number;
}

export const PIPELINE_CONFIG_COLLECTION = "PipelineConfigs";

export interface DeploymentRecord {
    /** The project the pipeline and environment belong to. */
    projectId: string;
    environmentId: number;
    /** Environment deployment record id; 0 when unknown. */
    recordId: number;
    environmentName: string;
    stageName: string;
    definitionId: number;
    pipelineName: string;
    runId: number;
    runName: string;
    result:
        | "succeeded"
        | "failed"
        | "canceled"
        | "skipped"
        | "partiallySucceeded"
        | "inProgress"
        | "waitingForApproval"
        | "unknown";
    /** Empty while unfinished. */
    finishTime: string;
}

export function mappingFor(
    config: PipelineConfig | undefined,
    environmentId: number
): EnvironmentMapping | undefined {
    if (!config || !config.enabled) {
        return undefined;
    }

    const mapping = config.environments && config.environments[String(environmentId)];
    if (!mapping || !mapping.enabled || mapping.deploymentType === "unmapped") {
        return undefined;
    }

    return mapping;
}
