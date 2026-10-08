import { describe, expect, it } from "vitest";

import {
    commitLinksFromRelations,
    deploymentsFrom,
    reachedBefore,
    repositoriesOf,
    runsAfter,
} from "./EnvironmentLookup";

const PROJECT = "9b16d435-97c1-4c56-890c-84ccf6def244";
const REPO = "0c1b5c2d-0000-4000-8000-000000000001";
const COMMIT = "51b9604a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

function commitRelation(commit = COMMIT, authorizedDate = "2026-10-08T10:00:00Z") {
    return {
        rel: "ArtifactLink",
        url: `vstfs:///Git/Commit/${PROJECT}%2F${REPO}%2F${commit}`,
        attributes: { name: "Fixed in Commit", authorizedDate },
    };
}

function record(runId: number, queueTime: string, definitionId = 27) {
    return {
        id: runId * 10,
        definition: { id: definitionId, name: "web" },
        owner: { id: runId, name: String(runId) },
        result: "succeeded",
        queueTime,
    };
}

describe("commitLinksFromRelations", () => {
    it("reads project, repository, commit and link time from commit links", () => {
        expect(commitLinksFromRelations([commitRelation()])).toEqual([
            { projectId: PROJECT, repositoryId: REPO, commitId: COMMIT, linkedAt: "2026-10-08T10:00:00Z" },
        ]);
    });

    it("ignores build links, other relations and duplicates", () => {
        const links = commitLinksFromRelations([
            commitRelation(),
            commitRelation(),
            { rel: "ArtifactLink", url: "vstfs:///Build/Build/2201", attributes: { name: "Integrated in build" } },
            { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://x/_apis/wit/workItems/1" },
        ]);

        expect(links).toHaveLength(1);
    });
});

describe("repositoriesOf", () => {
    it("keeps the earliest link time per repository", () => {
        const repositories = repositoriesOf(
            commitLinksFromRelations([
                commitRelation(COMMIT, "2026-10-08T12:00:00Z"),
                commitRelation("a".repeat(40), "2026-10-08T09:00:00Z"),
            ])
        );

        expect(repositories).toEqual([
            { projectId: PROJECT, repositoryId: REPO, since: Date.parse("2026-10-08T09:00:00Z") },
        ]);
    });
});

describe("runsAfter", () => {
    const records = [
        record(2201, "2026-10-08T14:48:45Z"),
        record(2200, "2026-10-08T14:47:45Z"),
        record(2199, "2026-10-08T14:44:24Z"),
        record(2199, "2026-10-08T14:44:24Z"),
        record(2193, "2026-10-08T12:30:09Z"),
        record(9999, "2026-10-08T14:50:00Z", 99),
    ];

    it("returns the first runs queued after the commit, each with the run before it", () => {
        expect(runsAfter(records, 27, Date.parse("2026-10-08T14:00:00Z"))).toEqual([
            { runId: 2199, previousRunId: 2193 },
            { runId: 2200, previousRunId: 2199 },
            { runId: 2201, previousRunId: 2200 },
        ]);
    });

    it("has no previous run when the pipeline never deployed before", () => {
        expect(runsAfter(records, 27, 0, 1)).toEqual([{ runId: 2193, previousRunId: undefined }]);
    });

    it("returns nothing when no run came after the commit", () => {
        expect(runsAfter(records, 27, Date.parse("2026-10-09T00:00:00Z"))).toEqual([]);
    });
});

describe("deploymentsFrom", () => {
    it("keeps this pipeline's deployments of the first run and every later one", () => {
        const kept = deploymentsFrom(
            [record(2201, ""), record(2199, ""), record(2193, ""), record(2300, "", 99)],
            27,
            2199
        );

        expect(kept.map((r) => r.owner!.id)).toEqual([2201, 2199]);
    });
});

describe("reachedBefore", () => {
    it("is true once a page holds a deployment queued before the commit", () => {
        const since = Date.parse("2026-10-08T14:00:00Z");

        expect(reachedBefore([record(2201, "2026-10-08T14:48:45Z")], since)).toBe(false);
        expect(reachedBefore([record(2201, "2026-10-08T14:48:45Z"), record(2193, "2026-10-08T12:30:09Z")], since)).toBe(true);
    });
});
