import { describe, expect, it } from "vitest";

import { PipelineConfig } from "./Contracts";
import { configsByPipeline, waitingDeployments } from "./Deployments";
import {
    Run,
    WorkItem,
    buildLinkIds,
    configsOf,
    enabledDefinitions,
    includesWorkItem,
    mapLimited,
    mergeRuns,
    repositoriesFromRelations,
    runOf,
    stagesWaitingForApproval,
} from "./Runs";

const PROJECT = "e059db8d-bce7-4cd6-a9fe-f44e0ab31c82";
const OTHER_PROJECT = "5b1c3e0a-9f3d-4a6e-8a51-6f3b2d7c9e10";
const REPO = "81c8dbe9-e95a-4b92-bfb4-69f8d2557e1d";
const OTHER_REPO = "0c4f8e2a-1d3b-4f5e-9a7c-2b6d8e0f1a3c";

function link(kind: string, id: string, project = PROJECT, repository = REPO) {
    return { rel: "ArtifactLink", url: `vstfs:///Git/${kind}/${project}%2F${repository}%2F${id}` };
}

function config(projectId: string, definitionId: number, enabled = true): PipelineConfig {
    return { id: `${projectId}-${definitionId}`, definitionId, enabled, environments: {} };
}

describe("repositoriesFromRelations", () => {
    it("takes the repositories of commit and pull request links, once each", () => {
        expect(
            repositoriesFromRelations([
                link("Commit", "73fb080120814ecdeabca1fc767a97fda12127a9"),
                link("PullRequestId", "42"),
                link("Commit", "e303e47498bfbc5fe831465e7c2555b1b45869f0", PROJECT, OTHER_REPO),
            ])
        ).toEqual([
            { projectId: PROJECT, repositoryId: REPO },
            { projectId: PROJECT, repositoryId: OTHER_REPO },
        ]);
    });

    it("ignores build links, other relations and malformed links", () => {
        expect(
            repositoriesFromRelations([
                { rel: "ArtifactLink", url: "vstfs:///Build/Build/2205" },
                { rel: "System.LinkTypes.Hierarchy-Forward", url: link("Commit", "abc").url },
                { rel: "ArtifactLink", url: `vstfs:///Git/Commit/${PROJECT}` },
                { rel: "ArtifactLink", url: "vstfs:///Git/Ref/x%2Fy%2FGBmain" },
            ])
        ).toEqual([]);
    });

    it("handles no relations", () => {
        expect(repositoriesFromRelations(undefined as any)).toEqual([]);
    });
});

describe("enabledDefinitions", () => {
    it("keeps the enabled pipelines of the project", () => {
        const configs = new Map(
            [config(PROJECT, 27), config(PROJECT, 28, false), config(OTHER_PROJECT, 29)].map(
                (c) => [c.id, c] as [string, PipelineConfig]
            )
        );
        expect(enabledDefinitions(configs, PROJECT)).toEqual([27]);
    });
});

describe("includesWorkItem", () => {
    it("matches the work item id, listed as a string", () => {
        expect(includesWorkItem([{ id: "601" }, { id: "339" }], 339)).toBe(true);
    });

    it("is false for another work item or no list", () => {
        expect(includesWorkItem([{ id: "601" }], 339)).toBe(false);
        expect(includesWorkItem(undefined, 339)).toBe(false);
    });
});

describe("stagesWaitingForApproval", () => {
    // The shape of run 2205: Test deployed, Prod waits for approval.
    const timeline = [
        { id: "s1", type: "Stage", name: "Deploy to Test", identifier: "Test", state: "completed" },
        { id: "s2", type: "Stage", name: "Deploy to Prod", identifier: "Prod", state: "pending" },
        { id: "c2", parentId: "s2", type: "Checkpoint", state: "inProgress" },
        { id: "a2", parentId: "c2", type: "Checkpoint.Approval", state: "inProgress" },
    ];

    it("names the stage of an approval in progress by its identifier", () => {
        expect(stagesWaitingForApproval(timeline)).toEqual(["Prod"]);
    });

    it("ignores approvals already given", () => {
        expect(
            stagesWaitingForApproval(
                timeline.map((record) => (record.id === "a2" ? { ...record, state: "completed" } : record))
            )
        ).toEqual([]);
    });

    it("falls back to the stage name without an identifier", () => {
        expect(
            stagesWaitingForApproval(
                timeline.map((record) => (record.id === "s2" ? { ...record, identifier: null } : record))
            )
        ).toEqual(["Deploy to Prod"]);
    });

    it("ignores an approval without a stage, and parent cycles", () => {
        expect(
            stagesWaitingForApproval([
                { id: "a", parentId: "b", type: "Checkpoint.Approval", state: "inProgress" },
                { id: "b", parentId: "a", type: "Checkpoint" },
            ])
        ).toEqual([]);
        expect(stagesWaitingForApproval(undefined)).toEqual([]);
    });
});

describe("mapLimited", () => {
    it("keeps the order and never has more than the limit in flight", async () => {
        let inFlight = 0;
        let most = 0;
        const results = await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
            inFlight++;
            most = Math.max(most, inFlight);
            await new Promise((resolve) => setTimeout(resolve, (8 - n) % 3));
            inFlight--;
            return n * 10;
        });

        expect(results).toEqual([10, 20, 30, 40, 50, 60, 70]);
        expect(most).toBe(3);
    });

    it("handles no items", async () => {
        expect(await mapLimited([], 6, async (n: number) => n)).toEqual([]);
    });
});

describe("buildLinkIds", () => {
    const link = (url: string, name = "Integrated in build") => ({
        rel: "ArtifactLink",
        url,
        attributes: { name },
    });

    it("reads build ids from Integrated in build links", () => {
        expect(buildLinkIds([link("vstfs:///Build/Build/42")])).toEqual([42]);
    });

    it("ignores other artifact link types", () => {
        const relations = [
            link("vstfs:///Build/Build/1", "Build"),
            link("vstfs:///Build/Build/2", "Found in build"),
            link("vstfs:///Git/Commit/abc", "Fixed in Commit"),
        ];
        expect(buildLinkIds(relations)).toEqual([]);
    });

    it("ignores non-artifact relations", () => {
        expect(buildLinkIds([{ rel: "System.LinkTypes.Related", url: "x" }])).toEqual([]);
    });

    it("de-duplicates repeated build ids", () => {
        const relations = [link("vstfs:///Build/Build/7"), link("vstfs:///Build/Build/7")];
        expect(buildLinkIds(relations)).toEqual([7]);
    });

    it("rejects malformed artifact uris", () => {
        const relations = [
            link("vstfs:///Build/Build/"),
            link("vstfs:///Build/Build/abc"),
            link("vstfs:///Build/Build/12/extra"),
        ];
        expect(buildLinkIds(relations)).toEqual([]);
    });

    it("survives missing attributes and empty input", () => {
        expect(buildLinkIds([{ rel: "ArtifactLink", url: "vstfs:///Build/Build/1" }])).toEqual([]);
        expect(buildLinkIds([])).toEqual([]);
    });
});

describe("waitingDeployments", () => {
    const build = { id: 2205, buildNumber: "20261008.1", project: { id: PROJECT }, definition: { id: 27, name: "Web" } };
    const stages = [runOf(build, ["Prod"])];
    const prod = { projectId: PROJECT, environmentId: 22, environmentName: "prod" };
    const oldProd = { projectId: PROJECT, environmentId: 21, environmentName: "old-prod" };

    function record(id: number, finishTime: string, stageName = "Prod", definitionId = 27) {
        return { id, stageName, finishTime, definition: { id: definitionId, name: "Web" }, owner: { id: id, name: "x" } };
    }

    it("places a waiting stage where the pipeline last deployed the same stage", () => {
        expect(waitingDeployments(stages, [{ environment: prod, raw: [record(1100, "2026-10-01T10:00:00Z")] }])).toEqual([
            {
                projectId: PROJECT,
                environmentId: 22,
                recordId: 0,
                environmentName: "prod",
                stageName: "Prod",
                definitionId: 27,
                pipelineName: "Web",
                runId: 2205,
                runName: "20261008.1",
                result: "waitingForApproval",
                finishTime: "",
            },
        ]);
    });

    it("places it only in the environment of the most recent record for the stage", () => {
        const placed = waitingDeployments(stages, [
            { environment: oldProd, raw: [record(900, "2026-07-01T10:00:00Z")] },
            { environment: prod, raw: [record(1100, "2026-10-01T10:00:00Z")] },
        ]);
        expect(placed.map((deployment) => deployment.environmentId)).toEqual([22]);
    });

    it("counts an unfinished record as most recent", () => {
        const placed = waitingDeployments(stages, [
            { environment: oldProd, raw: [record(1200, "")] },
            { environment: prod, raw: [record(1100, "2026-10-01T10:00:00Z")] },
        ]);
        expect(placed.map((deployment) => deployment.environmentId)).toEqual([21]);
    });

    it("skips environments the stage never deployed to", () => {
        const otherStage = [record(1, "2026-10-01T10:00:00Z", "Test")];
        const otherPipeline = [record(2, "2026-10-01T10:00:00Z", "Prod", 28)];
        expect(waitingDeployments(stages, [{ environment: prod, raw: otherStage }])).toEqual([]);
        expect(waitingDeployments(stages, [{ environment: prod, raw: otherPipeline }])).toEqual([]);
        expect(
            waitingDeployments(stages, [{ environment: { ...prod, projectId: OTHER_PROJECT }, raw: [record(3, "")] }])
        ).toEqual([]);
    });

    it("needs the run's pipeline", () => {
        expect(waitingDeployments([runOf({ id: 1 }, ["Prod"])], [{ environment: prod, raw: [record(3, "")] }])).toEqual([]);
    });
});

describe("runOf", () => {
    it("keeps the run's pipeline", () => {
        expect(runOf({ id: 7, buildNumber: "1.0", project: { id: PROJECT }, definition: { id: 27, name: "Web" } })).toEqual({
            id: 7,
            name: "1.0",
            pipeline: { projectId: PROJECT, definitionId: 27, name: "Web" },
            waitingStages: [],
        });
    });

    it("leaves the pipeline unknown for a run the lookup did not return", () => {
        expect(runOf({ id: 7 }).pipeline).toBeUndefined();
    });
});

describe("mergeRuns", () => {
    it("keeps a linked run once, as found in progress with its waiting stages", () => {
        const completed = [runOf({ id: 1 }), runOf({ id: 2 })];
        const running = [runOf({ id: 2 }, ["Prod"]), runOf({ id: 3 })];

        expect(mergeRuns(completed, running).map((run) => [run.id, run.waitingStages])).toEqual([
            [1, []],
            [2, ["Prod"]],
            [3, []],
        ]);
    });
});

describe("configsOf", () => {
    const configs = configsByPipeline([
        config("work", 1),
        config("work", 2),
        config("other", 1),
        config("other", 2),
    ]);
    const workItem: WorkItem = { id: 339, projectId: "work", relations: [], configs };
    const run = (projectId: string, definitionId: number): Run =>
        runOf({ id: definitionId, project: { id: projectId }, definition: { id: definitionId } });

    it("keeps only the pipelines that built the runs, in any project", () => {
        expect(Array.from(configsOf([run("work", 1), run("other", 2)], workItem).keys()).sort()).toEqual([
            "other-2",
            "work-1",
        ]);
    });

    it("adds the work item's whole project when a run was deleted by retention", () => {
        expect(Array.from(configsOf([run("other", 2), runOf({ id: 5 })], workItem).keys()).sort()).toEqual([
            "other-2",
            "work-1",
            "work-2",
        ]);
    });
});
