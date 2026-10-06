# Support

## Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| The new Deployment section does not appear | The  control is not configured the work item type | Turn Add the **Deployment Status for YAML** control to the work item type's layout |
| The work item shows no linked runs | Work item linking is off for the pipeline | Turn on **Automatically link work items included in this run** in the pipeline's **Settings**, and check its branch filter |
| **Boards Integration** settings lists no environments | The pipeline has not deployed yet | Run the pipeline once; environments appear after the first deployment |
| An environment shows no deployments | The environment is not mapped, or the job is not a deployment job | Map the environment in **Boards Integration**; only `deployment:` jobs that target an `environment:` are reported |
| The environment deployment page shows no changes or work items | The deployment job does not check out the repository | Add `- checkout: self` to the deployment job's steps. This only affects that Azure DevOps page, not the Deployment section |

## Reporting an issue

[Open an issue](https://github.com/excelery/azdo-extension-deployment-status/issues) and include:

- The extension version, shown in **Organization settings > Extensions**
- What you expected to see, and what you saw instead
- Steps to reproduce the problem
- A screenshot, with any organization details removed
- Any errors from the browser console (F12)
