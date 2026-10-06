# Security Policy

## Supported versions

Only the latest version published to the Visual Studio Marketplace receives security updates. Azure
DevOps updates installed extensions automatically, so no action is needed to receive a fix.

| Version | Supported |
|---|---|
| Latest | Yes |
| Earlier versions | No |

## Reporting a vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Report them through
[private vulnerability reporting](https://github.com/excelery/azdo-extension-deployment-status/security/advisories/new).
Include as much of the following as you can:

- The type of issue, for example cross-site scripting or token exposure
- The affected files, version or configuration
- Step-by-step instructions to reproduce the issue
- Proof-of-concept code, if available
- The impact, and how an attacker could exploit it

## Response process

| Step | Target |
|---|---|
| Acknowledge the report | Within 3 business days |
| Confirm the issue and assess severity | Within 10 business days |
| Release a fix for confirmed issues | As soon as possible, based on severity |

We will keep you informed of progress and credit you in the advisory, unless you prefer to remain
anonymous.

## Disclosure policy

We follow coordinated disclosure. Please give us reasonable time to release a fix before disclosing an
issue publicly. We publish a GitHub security advisory for each confirmed vulnerability.

## Scope

| In scope | Out of scope |
|---|---|
| The extension's code and manifests | Azure DevOps itself; report those to the [Microsoft Security Response Center](https://msrc.microsoft.com/report) |
| The build and release pipelines in this repository | Vulnerabilities that require a compromised Azure DevOps account |
| Bundled third-party dependencies | Denial of service and social engineering |

## Security model

| Area | Details |
|---|---|
| Permissions | Read-only access to work items (`vso.work`) and builds (`vso.build`) |
| Execution | Runs in the browser, inside a sandboxed Azure DevOps frame, with the signed-in user's permissions |
| Backend | None. The extension has no server and calls no services outside your Azure DevOps organization |
| Data storage | One configuration document per pipeline, in Azure DevOps extension data storage |
| Browser storage | None. No cookies, local storage or session storage |

## Supply chain

The extension's dependencies run inside every user's Azure DevOps session, so they are the main risk.

- Dependabot keeps dependencies up to date.
- CI fails on high or critical advisories in runtime dependencies.
- GitHub Actions are pinned to commit SHAs.
- Marketplace publishing credentials are held only in Azure Pipelines, never in this repository.
- CodeQL analysis runs on every pull request once the repository is public.
