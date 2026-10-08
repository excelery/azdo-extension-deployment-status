# Privacy

**Deployment Status to Boards for YAML** is published by Excelery.

## Summary

The extension does not send data outside your Azure DevOps organization. It has no backend, no
telemetry and no third-party services.

## Data read

| Data | Scope |
|---|---|
| Links on the open work item | `vso.work` (read) |
| Runs, environments and deployment records | `vso.build` (read) |
| Commits and pull requests linked to the open work item | `vso.code` (read) |

## Data stored

One configuration document per pipeline, in Azure DevOps extension data storage within your
organization. It contains the pipeline ID, whether reporting is enabled, and the deployment type of
each environment. Uninstalling the extension removes it.

The extension does not use cookies, browser storage, tracking or analytics.

## Contact

See [SUPPORT.md](SUPPORT.md).
