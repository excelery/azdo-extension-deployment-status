import { describe, expect, it } from "vitest";

import {
    WORK_ITEMS_PROVIDER,
    codeProjectsFromRelations,
    deploymentPageUrl,
    deploymentsSince,
    pipelinesIn,
    reachedBefore,
    workItemIdsFromResponse,
    workItemsQuery,
} from "./Traceability";

function record(id: number, runId: number, queueTime: string, definitionId = 27) {
    return { id, definition: { id: definitionId, name: "web" }, owner: { id: runId, name: String(runId) }, queueTime };
}

const PROJECT = "e059db8d-bce7-4cd6-a9fe-f44e0ab31c82";

describe("deploymentPageUrl and workItemsQuery", () => {
    const deployment = record(1200, 2201, "2026-10-08T14:48:45Z");

    it("builds the deployment page the Work items tab lives on", () => {
        expect(deploymentPageUrl("https://dev.azure.com/excelery", PROJECT, 24, deployment)).toBe(
            `https://dev.azure.com/excelery/${PROJECT}/_environments/24/runs` +
                "?environmentExecutionRecordId=1200&ownerId=2201&definitionId=27&planType=Build&view=workitems"
        );
    });

    it("asks the work items data provider with the page and its query values", () => {
        const body = workItemsQuery("https://page", PROJECT, 24, deployment);

        expect(body.contributionIds).toEqual([WORK_ITEMS_PROVIDER]);
        expect(body.dataProviderContext.properties).toMatchObject({
            environmentId: "24",
            environmentExecutionRecordId: "1200",
            ownerId: "2201",
            definitionId: "27",
            sourcePage: { url: "https://page", routeValues: { project: PROJECT, environmentId: "24" } },
        });
    });
});

describe("workItemIdsFromResponse", () => {
    it("reads ids from work item urls and System.Id fields, in any shape", () => {
        const response = {
            workItems: [{ id: 605, url: "https://dev.azure.com/excelery/_apis/wit/workItems/605" }],
            other: { fields: { "System.Id": 606 } },
        };

        expect(workItemIdsFromResponse(response).sort()).toEqual([605, 606]);
    });

    it("returns nothing for an empty or missing response", () => {
        expect(workItemIdsFromResponse(undefined)).toEqual([]);
        expect(workItemIdsFromResponse({})).toEqual([]);
    });
});

describe("deploymentsSince", () => {
    const records = [
        record(1201, 2205, "2026-10-08T15:00:00Z"),
        record(1200, 2201, "2026-10-08T14:48:45Z"),
        record(1199, 2200, "2026-10-08T14:47:45Z"),
        record(1195, 2193, "2026-10-08T12:30:09Z"),
        record(1300, 9000, "2026-10-08T15:30:00Z", 99),
    ];

    it("returns one pipeline's deployments since the work item was created, oldest first", () => {
        expect(deploymentsSince(records, 27, Date.parse("2026-10-08T14:00:00Z")).map((r) => r.id)).toEqual([
            1199, 1200, 1201,
        ]);
    });

    it("lists the pipelines that deployed", () => {
        expect(pipelinesIn(records).sort()).toEqual([27, 99]);
    });
});

describe("reachedBefore", () => {
    it("is true once a page holds a deployment from before the work item was created", () => {
        const since = Date.parse("2026-10-08T14:00:00Z");
        expect(reachedBefore([record(1200, 2201, "2026-10-08T14:48:45Z")], since)).toBe(false);
        expect(reachedBefore([record(1195, 2193, "2026-10-08T12:30:09Z")], since)).toBe(true);
    });
});

describe("codeProjectsFromRelations", () => {
    it("reads the projects of commit, pull request and branch links", () => {
        const url = (path: string) => ({ rel: "ArtifactLink", url: `vstfs:///Git/${path}` });

        expect(
            codeProjectsFromRelations([
                url(`Commit/${PROJECT}%2Frepo%2Fabc`),
                url(`PullRequestId/AAAA-1%2Frepo%2F1`),
                { rel: "ArtifactLink", url: "vstfs:///Build/Build/2201" },
            ]).sort()
        ).toEqual(["aaaa-1", PROJECT]);
    });
});
