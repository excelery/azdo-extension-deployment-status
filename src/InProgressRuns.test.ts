import { describe, expect, it } from "vitest";

import { PipelineConfig } from "./Contracts";
import {
    enabledDefinitions,
    includesWorkItem,
    repositoriesFromRelations,
    stagesWaitingForApproval,
    waitingDeployments,
    waitingStagesOf,
} from "./InProgressRuns";

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

describe("waitingDeployments", () => {
    const run = { id: 2205, buildNumber: "20261008.1", project: { id: PROJECT }, definition: { id: 27, name: "Web" } };
    const stages = waitingStagesOf(run, ["Prod"]);
    const environment = { projectId: PROJECT, environmentId: 22, environmentName: "prod" };

    it("places a waiting stage where the pipeline last deployed the same stage", () => {
        const raw = [{ id: 1100, stageName: "Prod", definition: { id: 27, name: "Web" }, owner: { id: 2190, name: "x" } }];
        expect(waitingDeployments(stages, environment, raw)).toEqual([
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

    it("skips environments the stage never deployed to", () => {
        const otherStage = [{ stageName: "Test", definition: { id: 27, name: "Web" } }];
        const otherPipeline = [{ stageName: "Prod", definition: { id: 28, name: "Api" } }];
        expect(waitingDeployments(stages, environment, otherStage)).toEqual([]);
        expect(waitingDeployments(stages, environment, otherPipeline)).toEqual([]);
        expect(waitingDeployments(stages, { ...environment, projectId: OTHER_PROJECT }, otherPipeline)).toEqual([]);
    });

    it("needs the run's project and pipeline", () => {
        expect(waitingStagesOf({ id: 1 }, ["Prod"])).toEqual([]);
    });
});
