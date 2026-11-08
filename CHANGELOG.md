# Changelog

Release downloads are available on [GitHub](https://github.com/StefanSofka/typoscript-highlighting/releases).

## 1.8.1 — 2026-11-08

### Fixed

- Normalize Windows separators before rejecting parent traversal in TypoScript imports.
- Replace regex-based filename globs with literal wildcard matching to prevent pathological backtracking in YAML imports.
- Fix hover hit-testing and highlight ranges inside multiline YAML values.
- Enforce the YAML analysis size limit in UTF-8 bytes, including multibyte input.
- Recover the rendered-color test when the workbench dismisses the extension menu before an automated click.
- Upload rendered-color reports and failure screenshots from the hidden test directory.

### Changed

- Share URI containment, directory lookup, wildcard matching and language detection rather than duplicating them.
- Update vulnerable development-tool dependencies and add a CI dependency audit with read-only repository permissions.
- Separate the quick-start README, user guide, development workflow, architecture and security policy. Validate local documentation links and packaged README images.

## 1.8.0 — 2026-11-07

Introduced the simplified visual Theme Settings editor, five-entry native Settings page, consolidated theme storage and scope-preserving migration.

See the [1.8.0 release notes](https://github.com/StefanSofka/typoscript-highlighting/releases/tag/v1.8.0) and [historical development log](docs/development-log.md) for earlier changes and validation.
