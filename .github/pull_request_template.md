<!-- Excelery maintainers: the checklist below is the review bar for this repo.
     Outside contributors: please open an issue first -- see CONTRIBUTING.md. -->

## What changed

<!-- One or two sentences. The why matters more than the what. -->

## Checks

- [ ] `npm test` passes, and any behaviour change has a test that was watched to fail first
- [ ] `npm run build` passes — output read, not just the summary line
- [ ] The extension still writes nothing to work items, pipelines or environments
- [ ] Scopes unchanged (`vso.work`, `vso.build`), or the change is justified below
- [ ] Docs updated if behaviour, scopes or configuration changed
      (`README.md`, `CLAUDE.md`, `PRIVACY.md`, `SUPPORT.md`)

## Manifest changes

<!-- Delete if none. Manifests do not hot-reload, and packaging does not validate scopes,
     so these need installing before they can be trusted. -->

- [ ] Packaged and installed in a real organization
- [ ] Contributions render as intended

## Evidence

<!-- A diff cannot show whether the control renders, sizes itself, or handles a deleted
     build. Screenshots or notes from a live check, if this touches the UI or data path. -->
