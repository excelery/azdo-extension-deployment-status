#!/usr/bin/env node
/**
 * Determine which OAuth scope an Azure DevOps endpoint actually requires, by
 * minting a PAT limited to one scope at a time and calling the endpoint with it.
 *
 * Reading the documentation is not a substitute: it has been wrong or
 * incomplete about scopes repeatedly, and two routes to the same data can
 * enforce different scopes (pipelines/environments vs distributedtask/environments).
 *
 *   AZDO_TOKEN=<token> node probe-scopes.js \
 *     --org <org> \
 *     --scopes vso.build,vso.work,vso.environment_manage \
 *     --url "https://dev.azure.com/<org>/<project>/_apis/pipelines/environments?api-version=7.1-preview.1" \
 *     --url "https://dev.azure.com/<org>/<project>/_apis/distributedtask/environments?api-version=7.1"
 *
 * AZDO_TOKEN needs permission to manage PATs. An Entra access token works:
 *   az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
 *
 * Every PAT minted here is revoked before exit, including on failure.
 */

const token = process.env.AZDO_TOKEN;
if (!token) {
    console.error("AZDO_TOKEN is required");
    process.exit(1);
}

function arg(name, fallback) {
    const i = process.argv.indexOf("--" + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function args(name) {
    const out = [];
    process.argv.forEach((a, i) => {
        if (a === "--" + name && process.argv[i + 1]) out.push(process.argv[i + 1]);
    });
    return out;
}

const ORG = arg("org");
const SCOPES = (arg("scopes") || "").split(",").map((s) => s.trim()).filter(Boolean);
const URLS = args("url");

if (!ORG || !SCOPES.length || !URLS.length) {
    console.error("usage: probe-scopes.js --org <org> --scopes a,b --url <url> [--url <url>]");
    process.exit(1);
}

const PATS = `https://vssps.dev.azure.com/${ORG}/_apis/tokens/pats?api-version=7.1-preview.1`;
const HEADERS = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

async function mint(scope) {
    const response = await fetch(PATS, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
            displayName: `scope-probe-${scope}-${Date.now()}`,
            scope,
            validTo: new Date(Date.now() + 3600e3).toISOString(),
            allOrgs: false,
        }),
    });
    const body = await response.json();
    return body.patToken || { error: body.patTokenError || JSON.stringify(body).slice(0, 120) };
}

async function revoke(pat) {
    await fetch(`${PATS}&authorizationId=${pat.authorizationId}`, {
        method: "DELETE",
        headers: HEADERS,
    }).catch(() => {});
}

(async () => {
    const minted = [];

    try {
        const width = Math.max(...SCOPES.map((s) => s.length)) + 2;

        for (const scope of SCOPES) {
            const pat = await mint(scope);
            if (!pat.token) {
                console.log(`${scope.padEnd(width)} PAT failed: ${pat.error}`);
                continue;
            }
            minted.push(pat);

            const auth = "Basic " + Buffer.from(":" + pat.token).toString("base64");
            const results = [];

            for (const url of URLS) {
                // redirect: manual -- an unauthenticated call 302s to a sign-in
                // page, which otherwise looks like a confusing 200.
                const response = await fetch(url, { headers: { Authorization: auth }, redirect: "manual" });
                const label = url.split("/_apis/")[1] || url;
                results.push(`${label.split("?")[0]}=${response.status}`);
            }

            console.log(`${scope.padEnd(width)} ${results.join("  ")}`);
        }
    } finally {
        for (const pat of minted) await revoke(pat);
        if (minted.length) console.log(`\nrevoked ${minted.length} probe PAT(s)`);
    }
})().catch((error) => {
    console.error("FAILED:", error.message);
    process.exit(1);
});
