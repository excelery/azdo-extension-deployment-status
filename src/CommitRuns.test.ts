import { describe, expect, it } from "vitest";

import { PipelineConfig } from "./Contracts";
import {
    RepositoryBuild,
    byPipelineAndBranch,
    byRepository,
    containsBase,
    earliest,
    enabledPipelinesByProject,
    firstContaining,
    gitLinksFromRelations,
    linkedRuns,
    mergeCommitOf,
} from "./CommitRuns";

const PROJECT = "e059db8d-bce7-4cd6-a9fe-f44e0ab31c82";
const REPO = "81c8dbe9-e95a-4b92-bfb4-69f8d2557e1d";
const LINKED = "73fb080120814ecdeabca1fc767a97fda12127a9";
const LATER = "e303e47498bfbc5fe831465e7c2555b1b45869f0";
const EARLIER = "f65cbbf196384f0187d0d78bd01e10b676e9ca13";

function link(kind: string, id: string, project = PROJECT, repository = REPO) {
    return { rel: "ArtifactLink", url: `vstfs:///Git/${kind}/${project}%2F${repository}%2F${id}` };
}

function build(id: number, sourceVersion: string, overrides: Partial<RepositoryBuild> = {}): RepositoryBuild {
    return {
        id,
        sourceVersion,
        sourceBranch: "refs/heads/main",
        queueTime: new Date(Date.UTC(2026, 9, 8, 0, id % 1000)).toISOString(),
        result: "succeeded",
        project: { id: PROJECT },
        definition: { id: 27 },
        ...overrides,
    };
}

/** Containment as a set of run ids, counting each check. */
function containsRuns(ids: number[]) {
    const counter = { checks: 0 };
    const contains = async (run: RepositoryBuild) => {
        counter.checks++;
        return ids.includes(run.id);
    };
    return { contains, counter };
}

describe("gitLinksFromRelations", () => {
    it("reads commit and pull request links", () => {
        const links = gitLinksFromRelations([link("Commit", LINKED), link("PullRequestId", "42")]);

        expect(links.commits).toEqual([{ projectId: PROJECT, repositoryId: REPO, commitId: LINKED }]);
        expect(links.pullRequests).toEqual([{ projectId: PROJECT, repositoryId: REPO, pullRequestId: 42 }]);
    });

    it("ignores build links, other relations and malformed urls", () => {
        const links = gitLinksFromRelations([
            { rel: "ArtifactLink", url: "vstfs:///Build/Build/2205" },
            { rel: "System.LinkTypes.Hierarchy-Reverse", url: link("Commit", LINKED).url },
            { rel: "ArtifactLink", url: `vstfs:///Git/Commit/${PROJECT}%2F${REPO}` },
            { rel: "ArtifactLink", url: `vstfs:///Git/PullRequestId/${PROJECT}%2F${REPO}%2Fabc` },
        ]);

        expect(links).toEqual({ commits: [], pullRequests: [] });
    });

    it("drops duplicate commits, whatever the case", () => {
        const links = gitLinksFromRelations([link("Commit", LINKED), link("Commit", LINKED.toUpperCase())]);

        expect(links.commits).toHaveLength(1);
    });
});

describe("mergeCommitOf", () => {
    const ref = { projectId: PROJECT, repositoryId: REPO, pullRequestId: 42 };

    it("uses a completed pull request's merge commit", () => {
        expect(mergeCommitOf({ status: "completed", lastMergeCommit: { commitId: LINKED } }, ref)).toEqual({
            projectId: PROJECT,
            repositoryId: REPO,
            commitId: LINKED,
        });
    });

    it("ignores an active pull request, which is merged into nothing yet", () => {
        expect(mergeCommitOf({ status: "active", lastMergeCommit: { commitId: LINKED } }, ref)).toBeUndefined();
    });

    it("ignores a missing pull request", () => {
        expect(mergeCommitOf(undefined, ref)).toBeUndefined();
    });
});

describe("byRepository", () => {
    it("groups commits per repository without duplicates", () => {
        const groups = byRepository([
            { projectId: PROJECT, repositoryId: REPO, commitId: LINKED },
            { projectId: PROJECT, repositoryId: REPO.toUpperCase(), commitId: LINKED },
            { projectId: PROJECT, repositoryId: "other", commitId: LATER },
        ]);

        expect(groups.map((group) => group.length)).toEqual([1, 1]);
    });
});

describe("enabledPipelinesByProject", () => {
    function config(id: string, definitionId: number, enabled = true): PipelineConfig {
        return { id, definitionId, enabled, environments: {} };
    }

    it("lists enabled pipelines per project", () => {
        const configs = new Map([
            ["a-25", config("a-25", 25)],
            ["a-26", config("a-26", 26)],
            ["b-27", config("b-27", 27)],
            ["a-28", config("a-28", 28, false)],
        ]);

        expect(enabledPipelinesByProject(configs)).toEqual(
            new Map([
                ["a", [25, 26]],
                ["b", [27]],
            ])
        );
    });

    it("skips a config whose project cannot be read from its id", () => {
        expect(enabledPipelinesByProject(new Map([["25", config("25", 25)]])).size).toBe(0);
    });
});

describe("earliest", () => {
    it("returns the earliest valid time", () => {
        expect(earliest(["2026-10-08T15:12:02Z", "2026-10-08T15:10:02Z", "not a date"])).toBe(
            "2026-10-08T15:10:02.000Z"
        );
    });

    it("returns undefined without a valid time", () => {
        expect(earliest(["", "x"])).toBeUndefined();
    });
});

describe("containsBase", () => {
    // Captured from the commit diffs API: base LINKED against its descendant and its ancestor.
    it("is true when the target is not behind the base", () => {
        expect(containsBase({ behindCount: 0 })).toBe(true);
    });

    it("is false when the target is behind the base", () => {
        expect(containsBase({ behindCount: 1 })).toBe(false);
    });

    it("is false without a response", () => {
        expect(containsBase(undefined)).toBe(false);
        expect(containsBase({})).toBe(false);
    });
});

describe("byPipelineAndBranch", () => {
    it("groups runs per pipeline and branch, oldest first", () => {
        const groups = byPipelineAndBranch([
            build(3, LATER),
            build(1, LINKED),
            build(2, LATER, { sourceBranch: "refs/heads/feature" }),
            build(4, LATER, { definition: { id: 26 } }),
            { id: 5, project: { id: PROJECT }, definition: { id: 27 } },
        ]);

        expect(groups.map((group) => group.map((run) => run.id))).toEqual([[1, 3], [2], [4]]);
    });
});

describe("firstContaining", () => {
    const runs = Array.from({ length: 100 }, (_, index) => build(index + 1, LATER));

    it("finds the first run containing the commit with a binary search", async () => {
        const { contains, counter } = containsRuns(runs.filter((run) => run.id >= 37).map((run) => run.id));

        expect(await firstContaining(runs, contains)).toBe(36);
        expect(counter.checks).toBeLessThanOrEqual(7);
    });

    it("returns -1 when no run contains it", async () => {
        expect(await firstContaining(runs, containsRuns([]).contains)).toBe(-1);
    });

    it("returns -1 for no runs", async () => {
        expect(await firstContaining([], containsRuns([]).contains)).toBe(-1);
    });
});

describe("linkedRuns", () => {
    it("names the first run containing the commit when it succeeded", async () => {
        const runs = [build(1, EARLIER), build(2, LINKED), build(3, LATER), build(4, LATER)];

        const linked = await linkedRuns(runs, containsRuns([2, 3, 4]).contains);

        expect(linked.map((run) => run.id)).toEqual([2]);
    });

    it("passes the work item on from failed, canceled and unfinished runs to the next success", async () => {
        const runs = [
            build(1, EARLIER),
            build(2, LINKED, { result: "failed" }),
            build(3, LATER, { result: "canceled" }),
            build(4, LATER, { result: undefined }),
            build(5, LATER),
            build(6, LATER),
        ];

        const linked = await linkedRuns(runs, containsRuns([2, 3, 4, 5, 6]).contains);

        expect(linked.map((run) => run.id)).toEqual([2, 3, 4, 5]);
    });

    it("names a run still in progress, waiting on an approval for example", async () => {
        const linked = await linkedRuns([build(1, EARLIER), build(2, LATER, { result: undefined })], containsRuns([2]).contains);

        expect(linked.map((run) => run.id)).toEqual([2]);
    });

    it("works per pipeline and branch", async () => {
        const runs = [
            build(1, LINKED),
            build(2, LATER, { definition: { id: 26 } }),
            build(3, LATER, { sourceBranch: "refs/heads/release" }),
            build(4, EARLIER, { sourceBranch: "refs/heads/old" }),
        ];

        const linked = await linkedRuns(runs, containsRuns([1, 2, 3]).contains);

        expect(linked.map((run) => run.id).sort()).toEqual([1, 2, 3]);
    });
});
