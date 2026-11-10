# Deployment Status to Boards for YAML

This extension brings the Classic release pipeline feature [Automatically link work items to releases and report deployment status to a work item](https://learn.microsoft.com/en-us/azure/devops/pipelines/integrations/configure-pipelines-work-tracking#classic-report-boards) to YAML pipelines that deploy to Azure DevOps environments.

The Azure DevOps team has this feature on the [roadmap](https://learn.microsoft.com/en-us/azure/devops/release-notes/roadmap/2024/boards-yaml-stage-status-on-work-item). But until there is built-in support for this, this extension can bridge the gap.

The extension adds a custom control to Azure Boards work item forms that shows deployment status for YAML pipelines, in the same style as the classic Deployment control. Instead of relying on Integrated in release stage links, it finds the runs that belong to the work item and displays [Deployment Jobs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs?view=azure-devops) that target [Environments](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/environments?view=azure-devops).

The extension does not write data to work items; it only reads existing links. Uninstalling it will not affect your work items or any existing data.

![Deployment section on a work item](static/screenshots/work-item.png)

## How it works

The extension finds the pipeline runs that include the work item, and shows where each run was deployed.

Runs are found through:

- The Integrated in build links on the work item (completed runs).
- The commits and pull requests linked to the work item (runs in progress, not used with Completed runs only).
- Other runs of the same pipeline built from the same commit as a linked run.

For each environment, the first deployment is shown.

## Get started

### 1. Enable automatic work item linking

In your pipeline, open Settings and turn on Automatically link work items included in this run. This is what creates the Integrated in build links on the work items.

![Pipeline settings](static/screenshots/pipeline-settings.png)

### 2. Configure Boards Integration

In pipeline menu, open ⋯ > Boards Integration.

![Boards Integration in the pipeline menu](static/screenshots/pipeline-menu.png)

Choose a deployment type for each environment.

![Boards Integration panel](static/screenshots/boards-integration.png)

Choose which deployments to show:

| Symbols | Option | What is shown |
|---|---|---|
| ![Three completed stages, one waiting, one not started](static/screenshots/shown-all.png) | All deployments (default) | Includes deployments in progress or waiting for approvals and checks. In addition to completed deployments, this also displays stages waiting to be deployed. |
| ![Four completed stages, one not started](static/screenshots/shown-completed-deployments.png) | Completed deployments | Includes completed deployments from runs still in progress. This is typically the case for multi-stage pipelines waiting for a deployment to the next stage, where the pipeline has not yet created an Integrated in build link. |
| ![Five completed stages](static/screenshots/shown-completed-runs.png) | Completed runs only | Includes only deployments from completed runs. This is typically the case for a pipeline deploying to a single stage only. |

### 3. Add the new control to your work item forms

Open Organization settings > Process and select your process. For each work item type where you want deployment status displayed, open Layout.

Add a new Deployment group, in the same column.

Add the Deployment Status for YAML custom control to the group.

![Add the custom control](static/screenshots/add-control.png)

The Deployment group with the custom control appears in the layout, in the same column as the built-in sections.

![Work item layout with the Deployment group and custom control](static/screenshots/layout.png)

If not needed for classic release pipelines, Hide the built-in Deployment section.

## Permissions and privacy

This extension requires read-only access to work items and builds. No data leaves your Azure DevOps organization. See [PRIVACY.md](https://github.com/excelery/azdo-extension-deployment-status/blob/main/PRIVACY.md).

## Support

Report bugs and request features through [GitHub Issues](https://github.com/excelery/azdo-extension-deployment-status/issues). Work item linking is a fairly complex area. Before reporting a problem, check that the pipeline and the extension are configured as described above, and read [SUPPORT.md](https://github.com/excelery/azdo-extension-deployment-status/blob/main/SUPPORT.md), which lists the common causes. Please check existing issues before opening a new one.

To report a vulnerability, follow [SECURITY.md](https://github.com/excelery/azdo-extension-deployment-status/blob/main/SECURITY.md).

## Contributing

See [CONTRIBUTING.md](https://github.com/excelery/azdo-extension-deployment-status/blob/main/CONTRIBUTING.md) for contribution guidelines.


