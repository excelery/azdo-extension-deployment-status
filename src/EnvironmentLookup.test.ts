import { describe, expect, it } from "vitest";

import {
    carriedRuns,
    codeLinksFromRelations,
    deployingBranch,
    deploymentsOfRuns,
    byBranch,
    firstContaining,
    reachedBefore,
    repositoriesOf,
    runsAfter,
} from "./EnvironmentLookup";

const PROJECT = "9b16d435-97c1-4c56-890c-84ccf6def244";
const REPO = "0c1b5c2d-0000-4000-8000-000000000001";
const COMMIT = "51b9604a1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f";

function link(path: string, authorizedDate = "2026-10-08T10:00:00Z") {
    return { rel: "ArtifactLink", url: `vstfs:///Git/${path}`, attributes: { authorizedDate } };
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

describe("codeLinksFromRelations", () => {
    it("reads commit, pull request and branch links alike", () => {
        const links = codeLinksFromRelations([
            link(`Commit/${PROJECT}%2F${REPO}%2F${COMMIT}`),
            link(`PullRequestId/${PROJECT}%2F${REPO}%2F14644`),
            link(`Ref/${PROJECT}%2F${REPO}%2FGBfeature%252Fx`),
        ]);

        expect(links).toHaveLength(3);
        expect(links.every((l) => l.repositoryId === REPO && l.projectId === PROJECT)).toBe(true);
    });

    it("ignores build links and other relations", () => {
        expect(
            codeLinksFromRelations([
                { rel: "ArtifactLink", url: "vstfs:///Build/Build/2201", attributes: { name: "Integrated in build" } },
                { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://x/_apis/wit/workItems/1" },
            ])
        ).toEqual([]);
    });
});

describe("repositoriesOf", () => {
    it("keeps the earliest link time per repository when there are no commit links", () => {
        const repositories = repositoriesOf(
            codeLinksFromRelations([
                link(`PullRequestId/${PROJECT}%2F${REPO}%2F1`, "2026-10-08T12:00:00Z"),
                link(`Ref/${PROJECT}%2F${REPO}%2FGBfeature`, "2026-10-08T09:00:00Z"),
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

    it("returns every run queued after the link, each with the run before it, with no fixed limit", () => {
        expect(runsAfter(records, 27, Date.parse("2026-10-08T14:00:00Z"))).toEqual([
            { runId: 2199, previousRunId: 2193 },
            { runId: 2200, previousRunId: 2199 },
            { runId: 2201, previousRunId: 2200 },
        ]);
    });

    it("has no previous run when the pipeline never deployed before", () => {
        expect(runsAfter(records, 27, 0)[0]).toEqual({ runId: 2193, previousRunId: undefined });
    });

    it("returns nothing when no run came after the link", () => {
        expect(runsAfter(records, 27, Date.parse("2026-10-09T00:00:00Z"))).toEqual([]);
    });
});

describe("branches", () => {
    const candidates = [
        { runId: 10, previousRunId: 9 },
        { runId: 11, previousRunId: 10 },
        { runId: 12, previousRunId: 11 },
        { runId: 13, previousRunId: 12 },
        { runId: 14, previousRunId: 13 },
    ];
    const branchOf = new Map([
        [10, "refs/heads/feature/a"],
        [11, "refs/heads/feature/b"],
        [12, "refs/heads/feature/c"],
        [13, "refs/heads/main"],
        [14, "refs/heads/main"],
    ]);

    it("groups runs by branch, however many other branches ran", () => {
        expect(byBranch(candidates, branchOf).map((runs) => runs.map((c) => c.runId))).toEqual([
            [10],
            [11],
            [12],
            [13, 14],
        ]);
    });

    it("carries the change to later runs on the same branch only", () => {
        expect(Array.from(carriedRuns(candidates, branchOf, 13))).toEqual([13, 14]);
    });

    it("falls back to the branch of the newest deployed run", () => {
        expect(deployingBranch(candidates, branchOf)).toBe("refs/heads/main");
    });

    it("treats runs whose branch is unknown as their own group", () => {
        const unknown = new Map([[13, "refs/heads/main"]]);
        expect(byBranch(candidates, unknown).map((runs) => runs.map((c) => c.runId))).toEqual([
            [10, 11, 12, 14],
            [13],
        ]);
    });
});

describe("deploymentsOfRuns", () => {
    it("keeps this pipeline's deployments of the given runs", () => {
        const kept = deploymentsOfRuns(
            [record(2201, ""), record(2199, ""), record(2193, ""), record(2201, "", 99)],
            27,
            new Set([2199, 2201])
        );

        expect(kept.map((r) => r.owner!.id)).toEqual([2201, 2199]);
    });
});

describe("reachedBefore", () => {
    it("is true once a page holds a deployment queued before the link", () => {
        const since = Date.parse("2026-10-08T14:00:00Z");

        expect(reachedBefore([record(2201, "2026-10-08T14:48:45Z")], since)).toBe(false);
        expect(reachedBefore([record(2201, "2026-10-08T14:48:45Z"), record(2193, "2026-10-08T12:30:09Z")], since)).toBe(true);
    });
});

describe("firstContaining", () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({ runId: 100 + i, previousRunId: 99 + i }));

    it("finds the run that brought the work item with about log2(runs) checks", async () => {
        const calls: number[] = [];
        const contains = async (_from: number | undefined, to: number) => {
            calls.push(to);
            return to >= 113;
        };

        expect(await firstContaining(runs, contains)).toBe(113);
        expect(calls.length).toBeLessThanOrEqual(6);
    });

    it("makes one check when the work item is not in the range at all", async () => {
        let calls = 0;
        expect(await firstContaining(runs, async () => (calls++, false))).toBeUndefined();
        expect(calls).toBe(1);
    });

    it("always compares from the run before the first candidate", async () => {
        const froms = new Set<number | undefined>();
        await firstContaining(runs, async (from, to) => (froms.add(from), to >= 105));
        expect(Array.from(froms)).toEqual([99]);
    });
});

describe("repositoriesOf with commit links", () => {
    it("lets commit links set the time, so an early branch link does not widen the search", () => {
        const [repository] = repositoriesOf(
            codeLinksFromRelations([
                link(`Ref/${PROJECT}%2F${REPO}%2FGBfeature`, "2026-09-01T00:00:00Z"),
                link(`Commit/${PROJECT}%2F${REPO}%2F${COMMIT}`, "2026-10-08T10:00:00Z"),
            ])
        );

        expect(repository.since).toBe(Date.parse("2026-10-08T10:00:00Z"));
    });
});

