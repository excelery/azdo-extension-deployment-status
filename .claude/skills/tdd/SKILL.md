---
name: tdd
description: Test-driven development workflow for this Azure DevOps extension. Use this whenever changing behaviour in src/ — adding logic, fixing a bug, changing how deployments are parsed, filtered, grouped, ordered or labelled, or touching anything in src/Deployments.ts or src/Contracts.ts. Also use when asked to "fix", "handle", "support" or "make it work when..." anything about this extension's data handling, and before committing any change to src/. Explains what is testable here, what is not, and how to verify the parts unit tests cannot reach.
---

# Test-driven development in this repo

Write the failing test first, make it pass, then tidy. The point is not ceremony — it is that a test
written after the fact tends to assert whatever the code already does, including the bug.

## The loop

1. **Write the test and watch it fail.** If it passes immediately, either the behaviour already exists
   or the test is wrong. Find out which before continuing.
2. **Make it pass** with the smallest change that does so.
3. **Refactor** with the test as a safety net.
4. **Run `npm test` and `npm run build`** before committing. The build catches type errors the tests
   do not, and a broken build has been pushed from here before by trusting a grep over the output.

```bash
npm test          # once
npm run test:watch # while working
```

## Where logic belongs

`src/Deployments.ts` holds the decisions: build-link parsing, result mapping, environment filtering,
grouping, ordering, relative time. It imports no SDK, so `src/Deployments.test.ts` runs in plain Node
with no mocking.

The services (`src/Services/*`) are deliberately thin — they fetch and delegate. `PipelineRunService`
calls the API and hands raw records to `toDeploymentRecords`; `DeploymentQueryService` gathers inputs
and calls `groupDeployments`.

**So: put new logic in `src/Deployments.ts`, not in a service.** Logic that lands in a service needs the
SDK to test, which in practice means it does not get tested. If a change seems to need logic in a
service, that is usually a sign a pure function is hiding in it — extract it, test it, call it.

## Write the test from the failure, not the fix

When fixing a bug, first express the bug as an assertion. A real example from this codebase: switching
to the typed Build client changed `TimelineRecord.result` to a numeric enum where `Succeeded = 0`, and
`result || "unknown"` silently reported every success as a failure. The test that belongs with that fix
is not "mapping works" — it is every result value mapping to its expected output, including the one
that is falsy.

Bugs worth a permanent test are the ones that were **silent**: wrong output rather than an error.

## Check the test can fail

A suite that has only ever passed proves nothing. After adding a test, reintroduce the bug and confirm
it fails:

```bash
# break it deliberately, run npm test, expect red, then restore
```

Do this at least for the test that motivated the change. It takes seconds and it is the only thing that
distinguishes a real test from a decorative one.

## What unit tests cannot reach here

Be honest about the boundary rather than writing tests that pretend to cover it:

| Not covered | Verify instead by |
|---|---|
| SDK handshake, `SDK.resize`, work item form services | Driving the real UI over CDP — see CLAUDE.md, *Verifying against a real organization* |
| Rendering, layout, theming | Same; look at it in a real work item |
| Azure DevOps API shapes and behaviour | Calling the API directly against a live org |
| Which scopes an endpoint needs | Minting a single-scope PAT and trying it — see CLAUDE.md |

The expensive bugs in this project were all in that right-hand column: the resize feedback loop, the
ignored `pipelineId` filter, deployment records outliving builds. Unit tests would not have caught any
of them. When a change depends on how Azure DevOps actually behaves, **check the behaviour first**, then
encode what you learned as a test of your own logic.

Mocking the Azure DevOps API to test our handling of it mostly tests the mock. Prefer a pure function
over raw API data, tested with a realistic fixture captured from a live call.

## Good assertions here

- Name the behaviour, not the function: `"drops records whose environment is not mapped"`.
- Cover the boundary that bit you: falsy values, empty arrays, missing optional fields, duplicates.
- Assert ordering explicitly when order is user-visible — the card shows newest-first and groups run
  production → staging → development.
- Check you have not mutated an input if a caller might reuse it.

## CI

`.azure-pipelines/build.yml` runs `npm test` before the build and publishes JUnit results with
`failTaskOnFailedTests`, so a regression fails the run. Keep tests fast and free of network calls — the
current suite runs in well under a second, which is what makes running it on every change painless.
