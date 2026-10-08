import { RawDeploymentRecord, WorkItemRelation } from "./Deployments";

/**
 * Finding a work item's deployments from the environment's own history.
 *
 * Every environment deployment has a Work items tab: the work items that deployment brought,
 * compared with the previous deployment of the same pipeline to that environment. Azure DevOps
 * stores this with the environment, and it is filled in as each stage deploys, so it covers runs
 * still waiting on approvals. The control reads that same data and looks for the work item in it.
 *
 * Pure functions here; requests in TraceabilityService.
 */

export const WORK_ITEMS_PROVIDER = "ms.vss-environments-web.environment-traceability-workitems-data-provider";

/** The page that shows a deployment's work items, as the data provider expects to be called from. */
export function deploymentPageUrl(
    collectionUrl: string,
    projectId: string,
    environmentId: number,
    record: RawDeploymentRecord
): string {
    return (
        `${collectionUrl}/${projectId}/_environments/${environmentId}/runs` +
        `?environmentExecutionRecordId=${record.id}&ownerId=${record.owner ? record.owner.id : ""}` +
        `&definitionId=${record.definition ? record.definition.id : ""}&planType=Build&view=workitems`
    );
}

/** The data provider query body, mirroring what the deployment page sends. */
export function workItemsQuery(pageUrl: string, projectId: string, environmentId: number, record: RawDeploymentRecord) {
    const query = {
        environmentExecutionRecordId: String(record.id || ""),
        ownerId: String(record.owner ? record.owner.id : ""),
        definitionId: String(record.definition ? record.definition.id : ""),
        planType: "Build",
        view: "workitems",
    };
    return {
        contributionIds: [WORK_ITEMS_PROVIDER],
        dataProviderContext: {
            properties: {
                ...query,
                environmentId: String(environmentId),
                sourcePage: {
                    url: pageUrl,
                    routeValues: { project: projectId, environmentId: String(environmentId), ...query },
                },
            },
        },
    };
}

/**
 * The work item ids in a data provider response. The response shape is not documented, so ids are
 * read from anything that identifies a work item: a work item URL or a System.Id field.
 */
export function workItemIdsFromResponse(response: unknown): number[] {
    const text = JSON.stringify(response || {});
    const ids = new Set<number>();
    for (const pattern of [/_apis\/wit\/workItems\/(\d+)/gi, /"System\.Id"\s*:\s*(\d+)/g]) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text))) {
            ids.add(Number(match[1]));
        }
    }
    return Array.from(ids);
}

/**
 * Deployments of one pipeline to one environment, oldest first, from the work item's creation on.
 * A deployment before the work item existed cannot have brought it.
 */
export function deploymentsSince(
    records: RawDeploymentRecord[],
    definitionId: number,
    since: number
): RawDeploymentRecord[] {
    return (records || [])
        .filter(
            (record) =>
                !!record &&
                !!record.owner &&
                !!record.definition &&
                record.definition.id === definitionId &&
                (Date.parse(record.queueTime || "") || 0) >= since
        )
        .sort((a, b) => (a.id || 0) - (b.id || 0));
}

/** Records come newest first; once a page reaches before `since`, older pages cannot matter. */
export function reachedBefore(page: RawDeploymentRecord[], since: number): boolean {
    return (page || []).some((record) => !!record && (Date.parse(record.queueTime || "") || 0) < since);
}

/** Distinct pipeline ids among the records. */
export function pipelinesIn(records: RawDeploymentRecord[]): number[] {
    const ids = new Set<number>();
    for (const record of records || []) {
        if (record && record.definition) {
            ids.add(record.definition.id);
        }
    }
    return Array.from(ids);
}

/** Projects of the work item's code links, so pipelines of a repository in another project are included. */
export function codeProjectsFromRelations(relations: WorkItemRelation[]): string[] {
    const projects = new Set<string>();
    for (const relation of relations || []) {
        const match = /^vstfs:\/\/\/Git\/(?:Commit|PullRequestId|Ref)\/([^%/]+)%2F/i.exec((relation && relation.url) || "");
        if (relation && relation.rel === "ArtifactLink" && match) {
            projects.add(match[1].toLowerCase());
        }
    }
    return Array.from(projects);
}
