import { describe, expect, it } from "vitest";

import { DeploymentRecord, PipelineConfig, mappingFor } from "./Contracts";
import {
    byMostRecent,
    configsByPipeline,
    groupDeployments,
    mappedEnvironments,
    olderThanRuns,
    orderGroups,
    relativeTime,
    runIdsFromRelations,
    toDeploymentRecords,
} from "./Deployments";

function config(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
    return {
        id: "proj-1",
        definitionId: 1,
        enabled: true,
        environments: {},
        ...overrides,
    };
}

function record(overrides: Partial<DeploymentRecord> = {}): DeploymentRecord {
    return {
        projectId: "proj",
        environmentId: 10,
        recordId: 1,
        environmentName: "prod",
        stageName: "Deploy",
        definitionId: 1,
        pipelineName: "Pipeline",
        runId: 100,
        runName: "1.0.0",
        result: "succeeded",
        finishTime: "2026-09-01T12:00:00Z",
        ...overrides,
    };
}

describe("runIdsFromRelations", () => {
    const link = (url: string, name = "Integrated in build") => ({
        rel: "ArtifactLink",
        url,
        attributes: { name },
    });

    it("reads build ids from Integrated in build links", () => {
        expect(runIdsFromRelations([link("vstfs:///Build/Build/42")])).toEqual([42]);
    });

    it("ignores other artifact link types", () => {
        const relations = [
            link("vstfs:///Build/Build/1", "Build"),
            link("vstfs:///Build/Build/2", "Found in build"),
            link("vstfs:///Git/Commit/abc", "Fixed in Commit"),
        ];
        expect(runIdsFromRelations(relations)).toEqual([]);
    });

    it("ignores non-artifact relations", () => {
        expect(runIdsFromRelations([{ rel: "System.LinkTypes.Related", url: "x" }])).toEqual([]);
    });

    it("de-duplicates repeated build ids", () => {
        const relations = [link("vstfs:///Build/Build/7"), link("vstfs:///Build/Build/7")];
        expect(runIdsFromRelations(relations)).toEqual([7]);
    });

    it("rejects malformed artifact uris", () => {
        const relations = [
            link("vstfs:///Build/Build/"),
            link("vstfs:///Build/Build/abc"),
            link("vstfs:///Build/Build/12/extra"),
        ];
        expect(runIdsFromRelations(relations)).toEqual([]);
    });

    it("survives missing attributes and empty input", () => {
        expect(runIdsFromRelations([{ rel: "ArtifactLink", url: "vstfs:///Build/Build/1" }])).toEqual([]);
        expect(runIdsFromRelations([])).toEqual([]);
    });
});

describe("toDeploymentRecords", () => {
    const environment = { environmentId: 10, environmentName: "prod" };
    const raw = {
        stageName: "Deploy",
        definition: { id: 1, name: "Pipeline" },
        owner: { id: 100, name: "1.0.0" },
        result: "succeeded",
        finishTime: "2026-09-01T12:00:00Z",
    };

    it("keeps only records for the requested runs", () => {
        const other = { ...raw, owner: { id: 999, name: "9.9.9" } };
        const out = toDeploymentRecords(environment, [raw, other], [100]);
        expect(out.map((r) => r.runId)).toEqual([100]);
    });

    it("stamps the environment onto each record", () => {
        const [out] = toDeploymentRecords(environment, [raw], [100]);
        expect(out.environmentId).toBe(10);
        expect(out.environmentName).toBe("prod");
    });

    // Succeeded is 0 in the TaskResult enum; an earlier version used a
    // truthiness check and reported every success as a failure.
    it("maps every known result string", () => {
        const cases: Array<[string, DeploymentRecord["result"]]> = [
            ["succeeded", "succeeded"],
            ["partiallySucceeded", "partiallySucceeded"],
            ["failed", "failed"],
            ["canceled", "canceled"],
            ["skipped", "skipped"],
            ["abandoned", "canceled"],
        ];

        for (const [input, expected] of cases) {
            const [out] = toDeploymentRecords(environment, [{ ...raw, result: input }], [100]);
            expect(out.result, input).toBe(expected);
        }
    });

    it("falls back to unknown for an unrecognised or missing result", () => {
        expect(toDeploymentRecords(environment, [{ ...raw, result: "weird" }], [100])[0].result).toBe("unknown");
        expect(toDeploymentRecords(environment, [{ ...raw, result: undefined }], [100])[0].result).toBe("unknown");
    });

    it("drops records without an owner or definition", () => {
        const noOwner = { ...raw, owner: undefined };
        const noDefinition = { ...raw, definition: undefined };
        expect(toDeploymentRecords(environment, [noOwner, noDefinition], [100])).toEqual([]);
    });
});

describe("mappingFor", () => {
    it("returns the mapping for an enabled, mapped environment", () => {
        const c = config({ environments: { "10": { enabled: true, deploymentType: "production" } } });
        expect(mappingFor(c, 10)?.deploymentType).toBe("production");
    });

    it("returns nothing when reporting is off for the pipeline", () => {
        const c = config({
            enabled: false,
            environments: { "10": { enabled: true, deploymentType: "production" } },
        });
        expect(mappingFor(c, 10)).toBeUndefined();
    });

    it("returns nothing for a disabled or unmapped environment", () => {
        const disabled = config({ environments: { "10": { enabled: false, deploymentType: "production" } } });
        const unmapped = config({ environments: { "10": { enabled: true, deploymentType: "unmapped" } } });
        expect(mappingFor(disabled, 10)).toBeUndefined();
        expect(mappingFor(unmapped, 10)).toBeUndefined();
    });

    it("returns nothing for an unknown environment or missing config", () => {
        expect(mappingFor(config(), 10)).toBeUndefined();
        expect(mappingFor(undefined, 10)).toBeUndefined();
    });
});

describe("mappedEnvironments", () => {
    it("collects enabled, mapped environments across pipelines", () => {
        const configs = new Map<string, PipelineConfig>([
            ["proj-1", config({ definitionId: 1, environments: { "10": { enabled: true, deploymentType: "production", environmentName: "prod" } } })],
            ["proj-2", config({ id: "proj-2", definitionId: 2, environments: { "20": { enabled: true, deploymentType: "development", environmentName: "dev" } } })],
        ]);

        expect(mappedEnvironments(configs).map((e) => e.environmentId).sort()).toEqual([10, 20]);
    });

    it("de-duplicates an environment shared by two pipelines", () => {
        const shared = { enabled: true, deploymentType: "production" as const, environmentName: "prod" };
        const configs = new Map<string, PipelineConfig>([
            ["proj-1", config({ definitionId: 1, environments: { "10": shared } })],
            ["proj-2", config({ id: "proj-2", definitionId: 2, environments: { "10": shared } })],
        ]);

        expect(mappedEnvironments(configs)).toHaveLength(1);
    });

    it("skips disabled pipelines and unmapped environments", () => {
        const configs = new Map<string, PipelineConfig>([
            ["proj-1", config({ enabled: false, environments: { "10": { enabled: true, deploymentType: "production" } } })],
            ["proj-2", config({ id: "proj-2", definitionId: 2, environments: { "20": { enabled: true, deploymentType: "unmapped" } } })],
        ]);

        expect(mappedEnvironments(configs)).toEqual([]);
    });
});

describe("groupDeployments", () => {
    const configs = new Map<string, PipelineConfig>([
        ["proj-1", config({ definitionId: 1, environments: { "10": { enabled: true, deploymentType: "production" } } })],
        ["proj-2", config({ id: "proj-2", definitionId: 2, environments: { "20": { enabled: true, deploymentType: "development" } } })],
    ]);

    it("groups by deployment type", () => {
        const groups = groupDeployments(
            [record(), record({ definitionId: 2, environmentId: 20, runId: 200 })],
            configs
        );
        expect(groups.map((g) => g.deploymentType).sort()).toEqual(["development", "production"]);
    });

    it("drops records whose environment is not mapped", () => {
        expect(groupDeployments([record({ environmentId: 99 })], configs)).toEqual([]);
    });

    it("drops records from a pipeline with no configuration", () => {
        expect(groupDeployments([record({ definitionId: 77 })], configs)).toEqual([]);
    });

    it("puts the most recent deployment first and exposes it as latest", () => {
        const older = record({ runId: 1, runName: "old", finishTime: "2026-09-01T00:00:00Z" });
        const newer = record({ runId: 2, runName: "new", finishTime: "2026-09-10T00:00:00Z" });

        const [group] = groupDeployments([older, newer], configs);
        const pipeline = group.pipelines[0];

        expect(pipeline.latest.runName).toBe("new");
        expect(pipeline.history.map((r) => r.runName)).toEqual(["new", "old"]);
    });

    it("does not mutate the input order", () => {
        const older = record({ runId: 1, finishTime: "2026-09-01T00:00:00Z" });
        const newer = record({ runId: 2, finishTime: "2026-09-10T00:00:00Z" });
        const input = [older, newer];

        groupDeployments(input, configs);

        expect(input[0].runId).toBe(1);
    });
});

describe("orderGroups", () => {
    it("orders production, staging, development regardless of input order", () => {
        const groups = [
            { deploymentType: "development" as const, pipelines: [] },
            { deploymentType: "production" as const, pipelines: [] },
            { deploymentType: "staging" as const, pipelines: [] },
        ];

        expect(orderGroups(groups).map((g) => g.deploymentType)).toEqual([
            "production",
            "staging",
            "development",
        ]);
    });

    it("omits types with no deployments", () => {
        const groups = [{ deploymentType: "development" as const, pipelines: [] }];
        expect(orderGroups(groups).map((g) => g.deploymentType)).toEqual(["development"]);
    });
});

describe("relativeTime", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");

    it("uses the built-in control's short form within a day", () => {
        expect(relativeTime("2026-09-30T11:59:30Z", now)).toBe("Just now");
        expect(relativeTime("2026-09-30T11:30:00Z", now)).toBe("30m ago");
        expect(relativeTime("2026-09-30T09:00:00Z", now)).toBe("3h ago");
    });

    it("switches to a month and day after a day, adding the year only when it differs", () => {
        const recent = relativeTime("2026-09-28T12:00:00Z", now);
        expect(recent).toContain("28");
        expect(recent).not.toContain("2026");
        expect(relativeTime("2025-12-31T12:00:00Z", now)).toContain("2025");
    });

    it("returns empty for an unparseable timestamp", () => {
        expect(relativeTime("", now)).toBe("");
        expect(relativeTime("not a date", now)).toBe("");
    });
});

describe("configsByPipeline", () => {
    it("keeps every project's configs, keyed by project and definition id", () => {
        const configs = configsByPipeline([
            config({ id: "project-a-5", definitionId: 5 }),
            config({ id: "project-b-5", definitionId: 5, enabled: false }),
            config({ id: "project-a-7", definitionId: 7 }),
        ]);

        expect(Array.from(configs.keys()).sort()).toEqual(["project-a-5", "project-a-7", "project-b-5"]);
        expect(configs.get("project-b-5")!.enabled).toBe(false);
    });

    it("skips documents whose id does not end with their definition id", () => {
        const configs = configsByPipeline([
            config({ id: "project-a-6", definitionId: 5 }),
            config({ id: "-5", definitionId: 5 }),
        ]);

        expect(configs.size).toBe(0);
    });
});

describe("pipelines in other projects", () => {
    const configs = configsByPipeline([
        config({ id: "work-1", definitionId: 1, environments: { "10": { enabled: true, deploymentType: "development" } } }),
        config({ id: "other-1", definitionId: 1, environments: { "10": { enabled: true, deploymentType: "production" } } }),
    ]);

    it("reads each mapped environment from its own project", () => {
        const environments = mappedEnvironments(configs).map((e) => `${e.projectId}:${e.environmentId}`).sort();

        expect(environments).toEqual(["other:10", "work:10"]);
    });

    it("stamps the environment's project onto each record", () => {
        const [out] = toDeploymentRecords(
            { projectId: "other", environmentId: 10, environmentName: "prod" },
            [{ definition: { id: 1, name: "P" }, owner: { id: 100, name: "1" } }],
            [100]
        );

        expect(out.projectId).toBe("other");
    });

    it("keeps pipelines with the same definition id in different projects apart", () => {
        const groups = groupDeployments(
            [record({ projectId: "work", runId: 100 }), record({ projectId: "other", runId: 200 })],
            configs
        );

        expect(groups.map((g) => [g.deploymentType, g.pipelines[0].projectId]).sort()).toEqual([
            ["development", "work"],
            ["production", "other"],
        ]);
    });
});

describe("unfinished deployments", () => {
    it("maps a record with no result and no finish time to inProgress", () => {
        const [mapped] = toDeploymentRecords(
            { environmentId: 10, environmentName: "prod" },
            [{ definition: { id: 1, name: "P" }, owner: { id: 100, name: "1" } }],
            [100]
        );

        expect(mapped.result).toBe("inProgress");
    });

    it("keeps unknown for a finished record with an unrecognised result", () => {
        const [mapped] = toDeploymentRecords(
            { environmentId: 10, environmentName: "prod" },
            [
                {
                    definition: { id: 1, name: "P" },
                    owner: { id: 100, name: "1" },
                    result: "somethingNew",
                    finishTime: "2026-09-01T12:00:00Z",
                },
            ],
            [100]
        );

        expect(mapped.result).toBe("unknown");
    });

    it("treats an unfinished deployment as the latest, whatever the API order", () => {
        const finished = record({ runId: 100, finishTime: "2026-09-01T12:00:00Z" });
        const running = record({ runId: 101, finishTime: "", result: "inProgress" });
        const configs = new Map([
            ["proj-1", config({ environments: { "10": { enabled: true, deploymentType: "production" } } })],
        ]);

        for (const records of [[finished, running], [running, finished]]) {
            const [group] = groupDeployments(records, configs);
            expect(group.pipelines[0].latest.runId).toBe(101);
            expect(group.pipelines[0].history.map((r) => r.runId)).toEqual([101, 100]);
        }
    });

    it("breaks finish time ties by run id, newest first", () => {
        const sorted = [record({ runId: 1 }), record({ runId: 3 }), record({ runId: 2 })].sort(
            byMostRecent
        );

        expect(sorted.map((r) => r.runId)).toEqual([3, 2, 1]);
    });
});

describe("olderThanRuns", () => {
    it("is true once every record on a page belongs to a run older than all wanted runs", () => {
        expect(olderThanRuns([{ owner: { id: 40, name: "" } }, { owner: { id: 45, name: "" } }], [50, 60])).toBe(
            true
        );
    });

    it("is false while a page still holds a record for a wanted or newer run", () => {
        expect(olderThanRuns([{ owner: { id: 40, name: "" } }, { owner: { id: 55, name: "" } }], [50, 60])).toBe(
            false
        );
    });

    it("is false for an empty page, which says nothing about age", () => {
        expect(olderThanRuns([], [50])).toBe(false);
    });
});

describe("record id", () => {
    it("keeps the environment deployment record id, or 0 when missing", () => {
        const environment = { environmentId: 10, environmentName: "prod" };
        const base = { definition: { id: 1, name: "P" }, owner: { id: 100, name: "1" } };
        const [withId, withoutId] = toDeploymentRecords(environment, [{ ...base, id: 1001 }, base], [100]);

        expect(withId.recordId).toBe(1001);
        expect(withoutId.recordId).toBe(0);
    });
});
