#!/usr/bin/env node
/**
 * Explains what Azure DevOps knows about one environment deployment: the run's
 * commits and work items, the environment's deployment history for the same
 * pipeline, and the changes between this run and the previous deployment.
 *
 *   node scripts/diagnose-environment.mjs --env 24 --run 1985
 *
 * Environment: AZDO_ORG, AZDO_PROJECT, AZDO_READ_PAT (Build read, Work items read).
 */

const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, i, all) => (i % 2 ? pairs : [...pairs, [all[i].replace(/^--/, ""), all[i + 1]]]), [])
);
const { AZDO_ORG: org, AZDO_PROJECT: project, AZDO_READ_PAT: pat } = process.env;
if (!org || !project || !pat || !args.env || !args.run) {
    console.error("Set AZDO_ORG, AZDO_PROJECT, AZDO_READ_PAT and pass --env <id> --run <buildId>.");
    process.exit(1);
}

const base = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis`;
const headers = { Authorization: `Basic ${Buffer.from(`:${pat}`).toString("base64")}` };

async function get(path) {
    const response = await fetch(`${base}/${path}`, { headers });
    if (!response.ok) {
        return { error: `${response.status} ${await response.text()}` };
    }
    return response.json();
}

const runId = Number(args.run);
const envId = Number(args.env);

const run = await get(`build/builds/${runId}?api-version=7.1`);
console.log("\n== Run");
console.log({
    id: run.id,
    pipeline: run.definition && `${run.definition.name} (${run.definition.id})`,
    reason: run.reason,
    branch: run.sourceBranch,
    commit: run.sourceVersion,
    repository: run.repository && `${run.repository.type}: ${run.repository.name}`,
});

const changes = await get(`build/builds/${runId}/changes?api-version=7.1`);
console.log("\n== Commits linked to the run");
console.log((changes.value || []).map((c) => `${c.id.slice(0, 8)} ${c.message}`));

const workItems = await get(`build/builds/${runId}/workitems?api-version=7.1`);
console.log("\n== Work items linked to the run");
console.log((workItems.value || []).map((w) => w.id));

const records = await get(`pipelines/environments/${envId}/environmentdeploymentrecords?top=50&api-version=7.2-preview.1`);
const forPipeline = (records.value || []).filter((r) => r.definition && run.definition && r.definition.id === run.definition.id);
console.log(`\n== Deployments of this pipeline to environment ${envId} (newest first)`);
console.log(
    forPipeline.map((r) => ({ record: r.id, run: r.owner && r.owner.id, stage: r.stageName, job: r.jobName, result: r.result, finished: r.finishTime }))
);

const thisIndex = forPipeline.findIndex((r) => r.owner && r.owner.id === runId);
const previous = forPipeline.slice(thisIndex + 1).find((r) => r.result === "succeeded");
console.log("\n== Previous successful deployment of this pipeline to the environment");
if (thisIndex < 0) {
    console.log("This run has no deployment record in that environment.");
} else if (!previous) {
    console.log("None. This is the first successful deployment of the pipeline to the environment.");
} else {
    const previousRun = await get(`build/builds/${previous.owner.id}?api-version=7.1`);
    console.log({ run: previous.owner.id, commit: previousRun.sourceVersion, sameCommit: previousRun.sourceVersion === run.sourceVersion });
    const between = await get(`build/changes?fromBuildId=${previous.owner.id}&toBuildId=${runId}&api-version=7.1-preview.2`);
    console.log("\n== Commits between the two deployments");
    console.log(between.error || (between.value || []).map((c) => `${c.id.slice(0, 8)} ${c.message}`));
    const betweenItems = await get(`build/workitems?fromBuildId=${previous.owner.id}&toBuildId=${runId}&api-version=7.1-preview.2`);
    console.log("\n== Work items between the two deployments");
    console.log(betweenItems.error || (betweenItems.value || []).map((w) => w.id));
}
