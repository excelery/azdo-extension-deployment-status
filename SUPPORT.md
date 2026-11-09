# Support

## Troubleshooting

| Symptom | Cause | Resolution |
|---|---|---|
| The new Deployment section does not appear | The  control is not configured the work item type | Turn Add the **Deployment Status for YAML** control to the work item type's layout |
| The work item shows no linked runs | Work item linking is off for the pipeline, and the work item has no commit or pull request links | Turn on **Automatically link work items included in this run** in the pipeline's **Settings**, and check its branch filter. Link the work item to its commits or pull requests |
| A pipeline run lists many work items not associated with a current commit | Azure DevOps lists the work items since the last run of the same source, a branch or a tag, that completed successfully | This is how Azure DevOps counts. The Deployment section shows the first deployment per environment, so a work item is not repeated for every later run |
| A completed release run is not shown | The run was built from a Git tag. Azure DevOps does not link tag runs to work items | Run the release from a branch, for example `release/24.0`. Tag runs are shown only while in progress, or when a linked run of the same pipeline was built from the same commit |
| A deployment is missing, although another run of the same pipeline deployed the same commit | Azure DevOps lists only the commits since the pipeline's last successful run. A run that builds a commit again has no work items and gets no link | The extension includes other completed runs of the pipeline that were built from the same commit as a linked run. It finds nothing when no run of that commit is linked, so check that **Automatically link work items included in this run** is on |
| A run in progress is not shown | **Show** is set to **Completed runs only**, the work item has no commit or pull request link to the repository, the repository is on GitHub, or the pipeline is in another project than the repository | Runs in progress are found through the work item's commit and pull request links in Azure Repos. Other runs appear when they complete |
| **Boards Integration** settings lists no environments | The pipeline has not deployed yet | Run the pipeline once; environments appear after the first deployment |
| An environment shows no deployments | The environment is not mapped, or the job is not a deployment job | Map the environment in **Boards Integration**; only `deployment:` jobs that target an `environment:` are reported |
| The environment deployment page shows no changes or work items | The deployment job does not check out the repository | Add `- checkout: self` to the deployment job's steps. This only affects that Azure DevOps page, not the Deployment section |

## Reporting an issue

Work item linking is a fairly complex area. Before you report a problem, check that the pipeline and the extension are configured correctly, and that none of the causes in Troubleshooting applies.

[Open an issue](https://github.com/excelery/azdo-extension-deployment-status/issues) and include:

- The extension version, shown in **Organization settings > Extensions**
- What you expected to see, and what you saw instead
- Steps to reproduce the problem
- A screenshot, with any organization details removed
- Any errors from the browser console (F12)
