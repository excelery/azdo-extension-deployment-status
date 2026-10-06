# Testing in Azure DevOps

`scripts/fixtures.mjs` creates test data in a test project: a pipeline, a work item and environments.
Work items are linked through commits, the same way as in production.

## Personal access tokens

Create two tokens in **User settings > Personal access tokens**.

| Token | Scopes |
|---|---|
| Setup | Code (read & write), Build (read & execute), Work items (read & write), Environment (read & manage), Extension data (read & write) |
| Verify | Work items (read), Build (read) |

## Run

```powershell
$env:AZDO_ORG = "<organization>"
$env:AZDO_PROJECT = "<test project>"
$env:AZDO_PAT = "<setup token>"
$env:AZDO_READ_PAT = "<verify token>"

npm run fixtures -- setup
npm run fixtures -- seed --envs 3 --runs 5
npm run fixtures -- verify
npm run fixtures -- clean
```

| Command | Description |
|---|---|
| `setup` | Creates the test repository, pipeline and work item. Run once. |
| `seed --envs N --runs N` | Adds N environments and N pipeline runs. |
| `seed ... --fail 02 --skip 03` | Makes environment 02 fail and skips environment 03. |
| `verify` | Checks links and deployments using the verify token. |
| `clean` | Deletes the test environments and their deployments. |

After `setup`, turn on **Automatically link work items included in this run** in the test pipeline's
**Settings**.
