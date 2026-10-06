#!/usr/bin/env node
/**
 * Test data for the extension, in a test project in Azure DevOps.
 *
 *   node scripts/fixtures.mjs setup
 *   node scripts/fixtures.mjs seed --envs 3 --runs 5 [--fail 02] [--skip 03]
 *   node scripts/fixtures.mjs verify
 *   node scripts/fixtures.mjs clean
 *
 * Environment:
 *   AZDO_ORG, AZDO_PROJECT   the test organization and project
 *   AZDO_PAT                 PAT for setup, seed and clean (scopes in docs/testing.md)
 *   AZDO_READ_PAT            PAT with only vso.work + vso.build, for verify
 *
 * Work items are linked the real way: each run pushes a commit mentioning the
 * fixture work item to the fixture repo, and Azure Pipelines adds the
 * "Integrated in build" link itself.
 */

const NAME = "dsb-fixture";
const TITLE = "DSB fixture work item";
const EXTENSIONS = ["deployment-status-to-boards-dev", "deployment-status-to-boards-test"];
const PUBLISHER = "excelery";
const TYPES = ["production", "staging", "development"];

const FIXTURE_PIPELINE = `trigger: none
pr: none

parameters:
- name: environments
  type: object
  default: []
- name: fail
  type: object
  default: []
- name: skip
  type: object
  default: []

stages:
- \${{ each env in parameters.environments }}:
  - stage: \${{ replace(env, '-', '_') }}
    dependsOn: []
    \${{ if containsValue(parameters.skip, env) }}:
      condition: false
    jobs:
    - deployment: Deploy
      environment: \${{ env }}
      pool:
        vmImage: ubuntu-latest
      strategy:
        runOnce:
          deploy:
            steps:
            - checkout: none
            - \${{ if containsValue(parameters.fail, env) }}:
              - script: exit 1
                displayName: Fail on purpose
            - \${{ else }}:
              - script: echo deployed
                displayName: Deploy
`;

const org = required("AZDO_ORG");
const project = required("AZDO_PROJECT");
const base = `https://dev.azure.com/${org}/${encodeURIComponent(project)}`;

function required(name) {
    const value = process.env[name];
    if (!value) {
        fail(`Set ${name}.`);
    }
    return value;
}

function fail(message) {
    console.error(message);
    process.exit(1);
}

function args() {
    const out = { envs: 3, runs: 1, fail: [], skip: [] };
    const argv = process.argv.slice(3);
    for (let i = 0; i < argv.length; i += 2) {
        const key = argv[i].replace(/^--/, "");
        const value = argv[i + 1];
        if (key === "fail" || key === "skip") {
            out[key] = value.split(",").map((n) => envName(Number(n)));
        } else {
            out[key] = Number(value);
        }
    }
    return out;
}

function envName(n) {
    return `${NAME}-${String(n).padStart(2, "0")}`;
}

async function call(url, { method = "GET", body, pat = "AZDO_PAT", contentType = "application/json" } = {}) {
    const token = required(pat);
    const response = await fetch(url, {
        method,
        headers: {
            Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
            "Content-Type": contentType,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
        fail(`${method} ${url} -> ${response.status} ${await response.text()}`);
    }
    const text = await response.text();
    return {
        body: text ? JSON.parse(text) : undefined,
        continuationToken: response.headers.get("x-ms-continuationtoken") || undefined,
    };
}

const get = async (url, pat) => (await call(url, { pat })).body;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- lookups ---------------------------------------------------------------

async function findRepo() {
    const { value } = await get(`${base}/_apis/git/repositories?api-version=7.1`);
    return value.find((repo) => repo.name === NAME);
}

async function findPipeline() {
    const { value } = await get(`${base}/_apis/pipelines?api-version=7.1`);
    return value.find((pipeline) => pipeline.name === NAME);
}

async function findWorkItem(pat) {
    const { body } = await call(`${base}/_apis/wit/wiql?api-version=7.1`, {
        method: "POST",
        pat,
        body: {
            query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Title] = '${TITLE}'`,
        },
    });
    return body.workItems.length ? body.workItems[0].id : undefined;
}

async function fixtureEnvironments(pat) {
    const { value } = await get(`${base}/_apis/pipelines/environments?$top=1000&api-version=7.1`, pat);
    return value.filter((env) => env.name.startsWith(`${NAME}-`)).sort((a, b) => a.name.localeCompare(b.name));
}

async function mainCommit(repoId) {
    const { value } = await get(`${base}/_apis/git/repositories/${repoId}/refs?filter=heads/main&api-version=7.1`);
    return value.length ? value[0].objectId : "0000000000000000000000000000000000000000";
}

// --- commands --------------------------------------------------------------

async function setup() {
    let repo = await findRepo();
    if (!repo) {
        repo = (await call(`${base}/_apis/git/repositories?api-version=7.1`, { method: "POST", body: { name: NAME } }))
            .body;
        console.log(`Created repo ${NAME}`);
    }

    if ((await mainCommit(repo.id)).startsWith("0000")) {
        await call(`${base}/_apis/git/repositories/${repo.id}/pushes?api-version=7.1`, {
            method: "POST",
            body: {
                refUpdates: [{ name: "refs/heads/main", oldObjectId: "0".repeat(40) }],
                commits: [
                    {
                        comment: "Fixture pipeline",
                        changes: [
                            {
                                changeType: "add",
                                item: { path: "/azure-pipelines.yml" },
                                newContent: { content: FIXTURE_PIPELINE, contentType: "rawtext" },
                            },
                            {
                                changeType: "add",
                                item: { path: "/fixture.txt" },
                                newContent: { content: "0", contentType: "rawtext" },
                            },
                        ],
                    },
                ],
            },
        });
        console.log("Pushed fixture pipeline");
    }

    let pipeline = await findPipeline();
    if (!pipeline) {
        pipeline = (
            await call(`${base}/_apis/pipelines?api-version=7.1`, {
                method: "POST",
                body: {
                    name: NAME,
                    configuration: {
                        type: "yaml",
                        path: "/azure-pipelines.yml",
                        repository: { id: repo.id, name: NAME, type: "azureReposGit" },
                    },
                },
            })
        ).body;
        console.log(`Created pipeline ${NAME} (${pipeline.id})`);
    }

    let workItem = await findWorkItem();
    if (!workItem) {
        workItem = (
            await call(`${base}/_apis/wit/workitems/$Task?api-version=7.1`, {
                method: "POST",
                contentType: "application/json-patch+json",
                body: [{ op: "add", path: "/fields/System.Title", value: TITLE }],
            })
        ).body.id;
        console.log(`Created work item ${workItem}`);
    }

    console.log(`
One manual step (no API for it):
  Pipelines -> ${NAME} -> Edit -> ... -> Settings ->
  turn on "Automatically link work items included in this run" for main.

Work item: ${base}/_workitems/edit/${workItem}`);
}

async function seed() {
    const { envs, runs, fail: failIn, skip } = args();
    const pipeline = (await findPipeline()) || fail("Run setup first.");
    const repo = await findRepo();
    const workItem = await findWorkItem();

    const names = Array.from({ length: envs }, (_, i) => envName(i + 1));
    const existing = new Map((await fixtureEnvironments()).map((env) => [env.name, env]));
    const environments = [];

    for (const name of names) {
        let env = existing.get(name);
        if (!env) {
            env = (await call(`${base}/_apis/pipelines/environments?api-version=7.1`, { method: "POST", body: { name } }))
                .body;
            console.log(`Created environment ${name}`);
        }
        await call(`${base}/_apis/pipelines/pipelinepermissions/environment/${env.id}?api-version=7.1-preview.1`, {
            method: "PATCH",
            body: { pipelines: [{ id: pipeline.id, authorized: true }] },
        });
        environments.push(env);
    }

    await writeConfig(pipeline.id, environments);

    for (let run = 1; run <= runs; run++) {
        const oldObjectId = await mainCommit(repo.id);
        await call(`${base}/_apis/git/repositories/${repo.id}/pushes?api-version=7.1`, {
            method: "POST",
            body: {
                refUpdates: [{ name: "refs/heads/main", oldObjectId }],
                commits: [
                    {
                        comment: `Fixture change #${workItem}`,
                        changes: [
                            {
                                changeType: "edit",
                                item: { path: "/fixture.txt" },
                                newContent: { content: String(Date.now()), contentType: "rawtext" },
                            },
                        ],
                    },
                ],
            },
        });

        const queued = (
            await call(`${base}/_apis/pipelines/${pipeline.id}/runs?api-version=7.1`, {
                method: "POST",
                body: {
                    resources: { repositories: { self: { refName: "refs/heads/main" } } },
                    templateParameters: {
                        environments: JSON.stringify(names),
                        fail: JSON.stringify(failIn),
                        skip: JSON.stringify(skip),
                    },
                },
            })
        ).body;

        process.stdout.write(`Run ${run}/${runs} (#${queued.id}) `);
        let state = queued.state;
        let result;
        while (state !== "completed") {
            await sleep(10000);
            ({ state, result } = await get(`${base}/_apis/pipelines/${pipeline.id}/runs/${queued.id}?api-version=7.1`));
            process.stdout.write(".");
        }
        console.log(` ${result}`);
    }
}

async function writeConfig(definitionId, environments) {
    const { id: projectId } = await get(`https://dev.azure.com/${org}/_apis/projects/${encodeURIComponent(project)}?api-version=7.1`);
    const document = {
        id: `${projectId}-${definitionId}`,
        definitionId,
        enabled: true,
        environments: Object.fromEntries(
            environments.map((env, i) => [
                String(env.id),
                { enabled: true, deploymentType: TYPES[i % TYPES.length], environmentName: env.name },
            ])
        ),
    };

    for (const extension of EXTENSIONS) {
        const url =
            `https://extmgmt.dev.azure.com/${org}/_apis/ExtensionManagement/InstalledExtensions/${PUBLISHER}/${extension}` +
            `/Data/Scopes/Default/Current/Collections/PipelineConfigs/Documents?api-version=7.1-preview.1`;
        const response = await fetch(url, {
            method: "PUT",
            headers: {
                Authorization: `Basic ${Buffer.from(`:${required("AZDO_PAT")}`).toString("base64")}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ ...document, __etag: -1 }),
        });
        console.log(`Config for ${extension}: ${response.ok ? "saved" : `skipped (${response.status}, not installed?)`}`);
    }
}

async function verify() {
    const pat = "AZDO_READ_PAT";
    const workItem = (await findWorkItem(pat)) || fail("No fixture work item. Run setup.");
    const { relations = [] } = await get(`${base}/_apis/wit/workitems/${workItem}?$expand=relations&api-version=7.1`, pat);

    const runIds = new Set(
        relations
            .filter((r) => r.rel === "ArtifactLink" && r.attributes && r.attributes.name === "Integrated in build")
            .map((r) => Number(r.url.split("/").pop()))
    );
    console.log(`Work item ${workItem}: ${runIds.size} linked runs`);

    let ok = runIds.size > 0;
    for (const env of await fixtureEnvironments(pat)) {
        const results = {};
        let continuationToken;
        do {
            const page = await call(
                `${base}/_apis/pipelines/environments/${env.id}/environmentdeploymentrecords?top=200` +
                    (continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : "") +
                    `&api-version=7.2-preview.1`,
                { pat }
            );
            for (const record of page.body.value) {
                if (record.owner && runIds.has(record.owner.id)) {
                    const key = record.result || "inProgress";
                    results[key] = (results[key] || 0) + 1;
                }
            }
            continuationToken = page.continuationToken;
        } while (continuationToken);

        const total = Object.values(results).reduce((a, b) => a + b, 0);
        ok = ok && total > 0;
        console.log(`  ${env.name}: ${total} deployments ${JSON.stringify(results)}`);
    }

    console.log(ok ? "OK" : "FAILED: missing links or deployments");
    process.exit(ok ? 0 : 1);
}

async function clean() {
    for (const env of await fixtureEnvironments()) {
        await call(`${base}/_apis/pipelines/environments/${env.id}?api-version=7.1`, { method: "DELETE" });
        console.log(`Deleted environment ${env.name}`);
    }
    console.log("Repo, pipeline and work item kept. Run seed to add deployments again.");
}

const commands = { setup, seed, verify, clean };
const command = commands[process.argv[2]];
if (!command) {
    fail("Usage: node scripts/fixtures.mjs <setup|seed|verify|clean> [--envs N] [--runs N] [--fail 01,02] [--skip 03]");
}
await command();
