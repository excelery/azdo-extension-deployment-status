# CLAUDE.md

Azure DevOps extension bringing *Report deployment status to Boards* to YAML pipelines deploying to
Environments. `README.md` has the why and the user-facing setup.

## Writing style

Applies to PR descriptions, commits, review comments, docs and all text users see.

- Simple and clean, enterprise style: standard sections, complete sentences, tables for reference
  data. Not choppy fragments, not long paragraphs.
- State the fact. Skip the justification unless asked.
- Put only what a reader needs up front; details go in the code or docs.
- Commits keep the `Co-Authored-By: Claude` trailer. No session links in commits or PR descriptions.

For text users see (Marketplace page, manifest, menus, panels, messages):

- **Match Microsoft's wording** for the same feature in Classic ("Report deployment status to Boards",
  "Deployment", "Learn more about deployment status reporting"). The work item section must read and look
  like the built-in Classic one.
- **No marketing voice.** No "Know where…", "Safe to try", "Brings…". Plain, factual, like a Microsoft listing.
- **Keep internals out.** No "read-only", scopes, stopgap or roadmap reasons in titles or taglines.
- **Use the real names.** The pipeline menu item is **Boards Integration**; refer to it by that name.
- **No description on the preview feature flag.**
- **Start from Microsoft's source.** Read the wording and screenshots in `MicrosoftDocs/azure-devops-docs`
  (`docs/boards/backlogs/add-link.md`, `docs/pipelines/integrations/configure-pipelines-work-tracking.md`)
  before writing, instead of inventing phrasing.
- **Match the built-in format** too: times read "59m ago", "3h ago", then "May 26".

## What ships

| Contribution | Type | Target | Entry |
|---|---|---|---|
| `deployments-work-item-control` | `ms.vss-work-web.work-item-form-control` | `ms.vss-work-web.work-item-form` | `src/WorkItemGroup/DeploymentsGroup.tsx` |
| `pipeline-settings-menu-action` | `ms.vss-web.action` | `ms.vss-build-web.build-definition-menu` | `src/PipelineSettings/PipelineSettings.tsx` |
| `pipeline-settings-panel` | `ms.vss-web.external-content` | (opened by the action) | `src/PipelineSettings/PipelineSettingsPanel.tsx` |

Both the work item group and the menu action are constrained on a `ms.vss-web.feature` contribution
(`preview`), off by default and enabled per user in **Preview features**. With the flag off neither appears.

The menu item reads **Boards Integration** with `order: 35`. Scopes are `vso.work` and `vso.build`,
both read-only. `static/logo.png` is the only image asset.

**Read-only is a product decision, not just a technical one.** This is a stopgap until Microsoft ships
the feature natively; writing nothing means it cannot collide with their implementation and leaves
nothing to migrate off. Don't trade that away for convenience.

Bundle sizes after `npm run build`: work item control 237 KB, menu action 24 KB, settings panel 2.4 MB.

## Where things live

Code and pull requests: GitHub (`origin`). Releases: Azure Pipelines, which holds the Marketplace
credentials and reads `azure-pipelines.yml` from this repository. The Azure DevOps repo remains as the
`azuredevops` remote while the pipeline is repointed at GitHub; once it is, that remote can go.

Pull requests are reviewed automatically by `.github/workflows/claude-review.yml`, which follows
`.claude/skills/pr-review/SKILL.md`. The action refuses to run when the workflow file differs from the
one on the default branch, so it cannot review the pull request that introduces or edits it.

## Build conventions

- **One webpack entry per contribution**, emitting `dist/<Entry>/<Entry>.js` alongside a copied
  `dist/<Entry>/<Entry>.html`. Every `src/**/*.manifest.json` `uri` assumes this.
- **Contributions live in `src/**/*.manifest.json`**, not the root manifest. Every `tfx` invocation
  passes `--manifest-globs vss-extension.json "src/**/*.manifest.json"`.
- **`configs/dev.json` vs `configs/release.json`**: the dev override sets `baseUri:
  https://localhost:3000` and a `-dev` extension id, so a dev build installs beside the real one.
- Manifest changes need a repackage and reinstall. Code changes are picked up by the dev server alone.
- The dev server uses port 3000. Another extension's dev server on the same port will win or lose the
  bind, and the loser's assets 404 inside Azure DevOps.

## Dependencies

- `package.json` has an `overrides` block pinning `azure-devops-extension-api`'s copy of
  `azure-devops-extension-sdk` to ours, and `webpack.config.js` has a matching `resolve.alias`. **Both
  are required.** Without them you get two SDK instances and `SDK.init()` never resolves.
- Use the Dart `sass` package with `api: "modern"` in the sass-loader options.
- `azure-devops-ui/buildScripts/css-variables-loader` must stay in the `.scss` loader chain. It resolves
  the Azure DevOps theme variables; drop it and the control stops matching the built-in one in dark mode.
- **`azure-devops-ui` controls belong in the settings panel only.** They cost ~2.3 MB. The work item
  control renders its status icons as inline SVG for that reason — it is the bundle that loads on every
  work item open.

## Traps, all of which cost real debugging time

- **Deployments come from environment deployment records, not build timelines.** Records outlive the
  runs they describe: in a real project, 70 of 110 referenced runs had been deleted by retention while
  every record survived, and `getBuildTimeline` 404s for exactly those. Reading timelines made
  deployments vanish once retention ran. Records also carry `result` as a plain string, avoiding the
  `TaskResult` enum trap below.
- **`TimelineRecord.result` is the numeric `TaskResult` enum, and `Succeeded = 0`.** Not used any more,
  but if you ever go back to timelines: a truthiness check such as `result || "unknown"` silently turns
  every successful stage into a failure.
- **Use `_apis/pipelines/environments`, never `_apis/distributedtask/environments`.** Same data; the
  distributedtask path requires `vso.environment_manage`, the only environment scope Azure DevOps
  defines, which makes the install prompt warn about high privilege scopes. Verified with scoped PATs.
- **`pipelineId` on `environmentdeploymentrecords` is ignored by the server.** Filter on
  `definition.id` in code or you will attribute other pipelines' environments to this one.
- **A stage can have deployed to several environments over time**, so resolve by most recent deployment.
  Racing parallel requests and taking the first answer gives a different result run to run.
- **The work item control reports its own height via `SDK.resize()` and must measure `.dsb-root`.**
  Azure DevOps injects `html, body { height: 100% }` and `body { display: flex }`, so `#root` stretches
  to the frame; measuring it returns the frame height, a loop that can never shrink. Pass the width
  explicitly too — omitting it makes the SDK substitute `body.scrollWidth` and ratchet the frame
  narrower on every report. Do not set `overflow: hidden` as a "fix": it hides content instead of
  resizing.
- **This extension writes nothing to work items, deliberately.** Don't add a decorator or a task to
  "make it reliable". An earlier design did exactly that and was dropped. Verified reasons: link names
  are server-validated (a custom type fails with *500 Unrecognized Resource link*); `Integrated in
  release environment` is writable but renders as a deleted artifact; an artifact URI may appear only
  once per work item, so one run deploying to two environments collides with itself.
- **Each published extension ID has its own preview feature** (`excelery.<id>.preview`). Manifests
  reference only the release feature; `.azure-pipelines/deploy.yml` rewrites constraints to the dev or
  test install's own feature at publish. Listing several features lets one install's switch show
  another install's UI.
- **An environment deployment's Changes and Work items tabs stay empty unless the deployment job runs
  `- checkout: self`** (verified). Deployment jobs check out nothing by default. The extension doesn't
  depend on those tabs, but run links open that page, so users notice.
- **The whole thing hinges on `Automatically link work items included in this run`.** With that pipeline
  setting off there are no build links and nothing to join on. `DeploymentsResult.noBuildLinks` exists so
  the empty state can say that rather than "no deployments".
- **Config keys on the environment id**, with the environment name copied in on save so the work item
  control can label a deployment without listing environments at render time. Only mapped environments
  are queried, which bounds the request count.

## Skills

`.claude/skills/` holds the working procedures for this repo. Reach for them rather than re-deriving:

| Skill | Use it for |
|---|---|
| `tdd` | Changing behaviour in `src/` — the loop, and what unit tests can and cannot reach here |
| `verify-live` | Any question about how Azure DevOps actually behaves; bundles CDP and scope-probing scripts |
| `release` | Packaging, publishing, sideloading, and why a change is not showing up |
| `pr-review` | Reviewing a branch or PR before merge |

## Tests

Work test-first: `.claude/skills/tdd/SKILL.md` has the workflow and, more usefully, the boundary of what
unit tests can and cannot reach in this codebase.

`npm test` (vitest). The suite covers `src/Deployments.ts`, which is where the decisions live: build-link
parsing, result mapping, environment filtering, grouping and ordering. It is deliberately free of SDK
imports so it runs in plain Node; the services are thin wrappers that fetch and delegate to it. Put new
logic there rather than in a service, or it cannot be tested.

CI runs it before the build and publishes JUnit results, so a failure fails the run.

## Verifying against a real organization

Unit tests do not cover the SDK integration, and two techniques were worth more than the rest for that:

**Drive the real UI over CDP.** Launch a second Edge on a throwaway profile with
`--remote-debugging-port=9222 --user-data-dir=<temp> --ignore-certificate-errors`; on a machine signed
into Entra it SSOs into Azure DevOps by itself, and it never touches the developer's own browser
session. Attach with a plain `WebSocket` (Node has one built in), find the target whose URL contains
`DeploymentsGroup`, and `Runtime.evaluate` inside it. This is how the sizing loop and the status icon
bug were diagnosed after several wrong guesses from reading code alone.

**Mint scoped PATs to answer scope questions.** `POST _apis/tokens/pats` with a single `scope` creates a
short-lived token; hitting an endpoint with it answers "does this need that scope" definitively. Revoke
them afterwards via `DELETE _apis/tokens/pats?authorizationId=...`. Guessing from Microsoft's
documentation produced three wrong conclusions in a row on this project.

## Known gaps

- Load time, measured in the browser with marks inside the control: SDK init resolves ~1.1 s after the
  frame starts, data loading finishes ~3.2 s, content renders ~3.6 s. Only ~0.3 s of that is HTTP; the
  rest is bundle boot and SDK host round trips (access token, work item form service, extension data).
  Optimising the REST calls further will not help.
- The `order: 35` on the menu item is a guess. Grouping and ordering semantics for
  `build-definition-menu` are undocumented and were never verified against the native items.
