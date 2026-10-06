---
name: release
description: Package, publish, install and iterate on this Azure DevOps extension. Use this when changing anything in a manifest (vss-extension.json or src/**/*.manifest.json), when scopes or contributions change, when a change does not appear in Azure DevOps after editing code, when asked to package, publish, install, sideload or version the extension, and when deciding whether a change needs a reinstall or just a reload.
---

# Releasing and iterating

## The rule that wastes the most time

**Code changes hot-reload. Manifest changes do not.**

`configs/dev.json` sets `baseUri: https://localhost:3000`, so an installed dev build loads its HTML and
JS from the dev server. Edit a `.tsx` file, reload the page, done.

Manifests are baked into the `.vsix`. Anything in `vss-extension.json` or `src/**/*.manifest.json` —
scopes, contributions, constraints, menu text, the work item group's `height`, the feature flag —
requires a repackage, publish and install before it has any effect.

When a change "isn't showing up", check which kind it was before debugging anything else.

## Dev loop

```bash
npm run start:dev     # https://localhost:3000, writes to disk
npm test              # before committing
npm run build         # and this -- read the output, not just the summary line
```

Two things that silently break the dev loop:

- **Port 3000 collides with other extension dev servers.** Only one can bind it; whichever loses, its
  assets 404 inside Azure DevOps and the contribution renders blank. Check what is on 3000 before
  assuming the code is wrong.
- **The self-signed certificate must be accepted once.** Until it is, the iframe is blocked and the
  control renders blank *with nothing in the console*. Visit `https://localhost:3000` directly, or
  launch the browser with `--ignore-certificate-errors`.

## Packaging

```bash
npm run package:dev    # out/*-dev-*.vsix, baseUri -> localhost
npm run package:prod   # out/*.vsix, --rev-version
```

Both pass `--manifest-globs vss-extension.json "src/**/*.manifest.json"`, because contributions live
beside their source rather than in the root manifest. A new contribution needs its manifest to match
that glob or it is silently absent from the package.

`tfx extension create` validates the manifest but **not scopes** — an invalid scope packages happily and
fails at install with *"Scope is not valid. Cannot mix uri based and modern scopes"*. Verify scopes with
the `verify-live` skill rather than at install time.

## Publishing

CI does this: `.azure-pipelines/build.yml` runs tests, builds and packages both variants;
`deploy.yml` publishes. All are private and shared with the `excelery` org:

- **dev** (`<id>-dev`): every branch. Loads code from `localhost:3000`.
- **test** (`<id>-test`): every branch, after approval on the test environment. The real build.

After each publish, `IsAzureDevOpsExtensionValid@5` waits for Marketplace validation, using the same
service connection.

The build number is the extension version
(`$(majorVersion).$(minorVersion)$(rev:.r)` from `variables.yml`), so the version in
`vss-extension.json` is ignored by CI.

The Marketplace **rejects a version that is not higher** than the published one. Hand-uploading a local
package built at `0.1.0` over a CI-published `0.1.36` fails. Let CI publish, or bump first.

`extensionTag` is appended to the extension id — do not also set a suffixed `extensionId`, or you
publish `<id>-dev-dev` as a separate extension.

## After installing

Azure DevOps auto-updates installed extensions, but not instantly. Check what is actually installed
rather than assuming:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://extmgmt.dev.azure.com/<org>/_apis/extensionmanagement/installedextensions?api-version=7.1-preview.1"
```

The response lists the version, the declared scopes and every registered contribution — which answers
"did my manifest change actually ship" directly.

**The contributions are gated behind a preview feature flag, off by default.** After installing, switch
on the extension's feature in **User settings → Preview features**. Until then the work item control and the pipeline menu item do not render at all, which looks
exactly like a broken build.

## Changing scopes

Scope changes are the most disruptive thing to ship: Azure DevOps requires an administrator to approve
the new scopes before the extension works again. Batch them, avoid anything that triggers the
high-privilege warning, and confirm the endpoints genuinely need what you are asking for.
