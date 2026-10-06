---
name: verify-live
description: Verify behaviour against a real Azure DevOps organization instead of reasoning from documentation. Use this whenever a question is about how Azure DevOps actually behaves — what an API returns, which OAuth scope an endpoint needs, whether a contribution renders, why a control looks wrong, how long something takes, or whether a change worked. Use it before concluding that Azure DevOps "cannot" do something, and before quoting timings or API shapes. Bundles working CDP and scope-probing scripts.
---

# Verifying against a real organization

The documentation for Azure DevOps extensibility is incomplete and sometimes wrong. On this project,
reading it produced three confident, incorrect conclusions in a row:

- `vso.environment` was declared as a scope; it does not exist, and install failed.
- Environments were reported as absent from the typed API; they are in `TaskAgent`.
- Environments were reported as unreachable without `vso.environment_manage`; the
  `_apis/pipelines/environments` route serves the same data under `vso.build`. Only one route had
  been tried.

Each was settled in minutes by asking the live system. **When a claim is about how Azure DevOps
behaves, test it rather than reason about it** — and say which you did, because a tested claim and a
plausible one are very different things.

## Rules that earned themselves

**Try the other route before concluding something is impossible.** Azure DevOps often exposes the same
data under several paths that enforce scopes differently. A 401 tells you that route needs a scope, not
that the data is out of reach.

**Read the actual response, not the summary line.** A build "compiled with 1 error" was committed and
pushed because a grep matched the summary and the error itself went unread.

**One measurement beats an estimate.** A quoted ~600 ms load time, extrapolated from curl, was wrong;
measured in the browser the control took ~3.6 s, and almost none of it was HTTP.

## Driving the real UI

`scripts/cdp.js` attaches to a browser over the Chrome DevTools Protocol. Needs Node 22+ only.

```bash
node .claude/skills/verify-live/scripts/cdp.js launch --url "https://dev.azure.com/<org>/<project>/_workitems/edit/<id>"
node .claude/skills/verify-live/scripts/cdp.js targets
node .claude/skills/verify-live/scripts/cdp.js navigate --url "<url>"
node .claude/skills/verify-live/scripts/cdp.js eval --frame DeploymentsGroup --expr "JSON.stringify({...})"
node .claude/skills/verify-live/scripts/cdp.js eval --frame PipelineSettingsPanel --file probe.js
```

It launches a **throwaway profile**, so the developer's own browser is never touched or closed. On a
machine signed into Entra it usually single-sign-ons into Azure DevOps by itself. If it lands on an
account picker it needs a human to sign in once — that cannot be driven headlessly, so ask.

### Things that will waste your time

- **Extension contributions render in out-of-process iframes**, so they are separate CDP targets. You
  cannot reach them from the parent page, and `Page.reload` fails on them with "Command can only be
  executed on top-level targets". Reload the top page instead.
- **Console output from those frames does not reach the parent.** To get values out, either return them
  from `Runtime.evaluate` or stash them on `window` and read them back.
- **If the frame is not found, check the obvious causes first**: the dev server is not running on
  port 3000; the preview feature flag is off, so the contribution is not rendered at all; or the page
  has not finished loading. A missing frame is usually configuration, not a bug.
- **Frames take seconds to appear.** `eval` retries for 20 seconds by default (`--retries`).

### Measuring, honestly

`performance.getEntriesByType('resource')` inside the frame shows the REST calls, but not anything
proxied through the host SDK — extension data storage, work item form services and token acquisition are
invisible there. If the numbers do not add up, that is why. To find where time actually goes, push marks
onto `window.__timing` in the code, reload, and read them back. That is how the ~3.6 s figure was split
into bundle boot, SDK handshake and data.

## Determining which scope an endpoint needs

`scripts/probe-scopes.js` mints a PAT limited to one scope, calls each endpoint with it, and revokes
every token afterwards.

```bash
AZDO_TOKEN=$(az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv) \
node .claude/skills/verify-live/scripts/probe-scopes.js \
  --org <org> \
  --scopes vso.build,vso.work,vso.environment_manage \
  --url "https://dev.azure.com/<org>/<project>/_apis/pipelines/environments?api-version=7.1-preview.1" \
  --url "https://dev.azure.com/<org>/<project>/_apis/distributedtask/environments?api-version=7.1"
```

Output is a matrix of scope against endpoint status. This is the only reliable way to answer "does this
need that scope", and it is what showed the two environment routes differ.

Scope matters beyond correctness: `vso.environment_manage` makes Azure DevOps warn *"This extension
requires high privilege scopes"* at install, which users reject. Prefer a route that avoids it.

## Reading and writing real data

Plain REST with an Entra token is often faster than any UI for checking a hypothesis — what a work item's
relations actually contain, whether deployment records outlive their builds, what a deployment record
carries. Get a token with:

```bash
az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
```

If a check needs test data in a real project — a work item link, a config document — **clean it up
afterwards and say that you did**. Leftover test links have shown up in screenshots as broken artifacts
and cost time to explain.
