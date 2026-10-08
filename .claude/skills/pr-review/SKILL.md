---
name: pr-review
description: Review a pull request or branch for this Azure DevOps extension before merging. Use this when asked to review a PR, review changes before merge, check a branch is ready, or approve work. Covers what to check in this repo specifically — the read-only invariant, scope changes, manifest versus code changes, documentation that goes stale, and what cannot be judged from the diff alone.
---

# Reviewing before merge

Run `/code-review` first for correctness, then work through what is specific to this repo. `/code-review`
finds bugs in the diff; it does not know this project's invariants, and most of the damage that can be
done here is invisible to it.

## The invariants

Check these on every change. Each one has a reason a future change is likely to quietly break it.

**The extension writes nothing.** No work item links, fields, tags or comments; no pipeline or
environment changes. This is the product's central promise: it is a stopgap until Microsoft ships the
feature natively, and writing nothing is why it cannot collide with their implementation or leave
anything to clean up. A PR that introduces a write — a decorator, a task, a `PATCH` — breaks that
promise. It needs an explicit product decision, not a review nod.

**Scopes stay `vso.work` + `vso.build`, both read-only.** Any scope addition needs an administrator to
re-approve the extension in every org, and anything `_manage` triggers *"This extension requires high
privilege scopes"* at install. If a diff adds a scope, ask whether another API route avoids it — that
has worked before. Verify with the `verify-live` skill rather than accepting the reasoning.

**Logic lives in `src/Deployments.ts` and `src/InProgressRuns.ts`.** It imports no SDK so it can be tested. Logic that drifts into a
service becomes untestable in practice. If a PR adds branching to a service, a pure function is usually
hiding in it.

**Tests accompany behaviour changes.** See the `tdd` skill. Ask whether the new test was watched to
fail — a test written after the fix often asserts the bug.

## Traps this codebase has already fallen into

Treat these as review checklist items, because each shipped once:

- **Falsy enum values.** `TimelineRecord.result` is numeric with `Succeeded = 0`; `result || "unknown"`
  turned every success into a failure. Any `||` fallback over an API value deserves a second look.
- **Filters the server ignores.** `pipelineId` on `environmentdeploymentrecords` is accepted and
  ignored. Server-side filtering should be verified, not assumed, and usually re-applied client-side.
- **Retention.** Builds are deleted; deployment records outlive them. Anything reading build-scoped APIs
  must tolerate 404s, and `Promise.all` over per-build calls turns one deleted build into a total
  failure.
- **Ambiguity over time.** A stage can deploy to several environments across its life. Resolve by most
  recent, deterministically — racing parallel requests and taking the first answer gives different
  results run to run.
- **Sizing feedback loops.** The work item control reports its own height; measuring an element that
  fills the frame returns the frame height and can never shrink. See CLAUDE.md before touching resize.

## Manifest changes need more than a diff read

A change to `vss-extension.json` or `src/**/*.manifest.json` cannot be validated by reading it:

- packaging does **not** validate scopes — invalid ones fail at install
- contribution targets, menu placement and constraints only prove out when rendered
- anything manifest-side needs a repackage and install, so "it works locally" may mean the old manifest

If a PR changes a manifest, it should say it was installed and checked, or the reviewer should do it.
The `release` skill covers the loop.

## Documentation that goes stale

These describe behaviour and drift silently:

- `README.md` — architecture, scopes, the data-flow diagram
- `CLAUDE.md` — conventions and the traps list
- `README.md` — also the Marketplace page users read before installing
- `PRIVACY.md` — what is read and stored; **must** be corrected if data handling changes
- `SUPPORT.md` — the troubleshooting causes

A PR that changes the data source, scopes or configuration shape should update them in the same change.

New or changed text must follow the *Writing style* rule in `CLAUDE.md`: short, plain, no filler.

## What a diff cannot tell you

Ask for evidence rather than inferring:

- Does it render correctly, in both themes, at the real column width?
- Does the control still size itself to its content?
- Does it behave when the pipeline has never deployed, when a build has been deleted, when the work item
  has no build links, or only commit links to a run still in progress?

The expensive bugs here were all in this category. If the PR touches the control or the panel, ask for a
screenshot or verify with `verify-live`.

## Automated review

`.github/workflows/claude-review.yml` runs a review on every pull request and posts findings as
comments. It is pointed at this file, so the automated and manual reviews apply the same standard --
changes here change both.

It needs an `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` repository secret, and it does not run on pull requests from forks,
which have no access to secrets.

Treat its findings as a first pass, not an approval. It reads the diff; it cannot install a manifest
change or look at the rendered control.

## Mechanics

```bash
gh pr list
gh pr view <n>
gh pr diff <n>
gh pr checks <n>
```

Confirm checks are green before approving. GitHub Actions runs tests, build and packaging on pull
requests; a red run means tests or types, both blocking.

**Releases are published from Azure Pipelines**, not GitHub, because the Marketplace credentials live
there. So a green PR does not mean a release succeeded — that is a separate run in Azure DevOps after
merge, and it is where a publishing failure will show up.

Pull requests from forks do not run in Azure Pipelines (no secrets), which is why GitHub Actions
validates them.
