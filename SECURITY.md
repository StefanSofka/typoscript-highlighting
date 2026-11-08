# Security policy

[README](README.md) · [Development](docs/development.md)

## Supported versions

Security fixes target the latest GitHub release. Update to the latest release before reporting an issue that may already be fixed.

## Reporting a vulnerability

Send suspected vulnerabilities privately to the maintainer at [stefan.sofka@mailbox.org](mailto:stefan.sofka@mailbox.org), the public package contact. Include the affected version, editor/OS, a minimal reproduction and the expected impact. Remove credentials and private project data.

Please avoid publishing exploit details in a public issue before the maintainer can assess them. Ordinary bugs can use the [issue tracker](https://github.com/StefanSofka/typoscript-highlighting/issues).

## Security model

The runtime analyzes local/editor-accessible text. It does not execute PHP, Composer, TypoScript or project scripts, and does not fetch remote configuration. Documentation links open externally when the user follows them.

- TypoScript imports accept project-relative and `EXT:` paths. Path separators are normalized before rejecting parent traversal. Directory wildcards are not accepted.
- YAML supports static relative, absolute and `EXT:` resources, including paths outside the workspace. Composer detection can inspect ancestor directories, configured roots and symlink targets. These are read operations, not a workspace containment boundary.
- Filename wildcard matching treats fragments literally instead of constructing regular expressions from project input. YAML text size, alias evaluation, import depth and discovery are bounded; see [analysis limits](docs/user-guide.md#analysis-limits).
- The theme webview uses local media roots, a nonce-based content security policy and DOM text APIs. The extension host validates message IDs, allowed theme/category names and color formats before writing settings.
- Automatic migration writes the extension's own legacy settings into replacement data at the original User, Workspace or Folder scope. It saves the replacement before deleting source entries. Theme changes write the selected destination through the editor configuration API.
- Packaged files follow an explicit allowlist. Runtime dependencies and licenses are included; development tooling and tests are excluded.

The extension host inherits the editor's filesystem permissions. Static analysis and parser limits reduce exposure but do not turn an untrusted project into a sandbox.

## Dependency maintenance

Run `npm audit` after changing dependencies and before a release. CI audits both runtime and development dependencies. Patched versions are recorded in the lockfile, including a scoped VSCE/minimatch override explained in [Development](docs/development.md#testing-guidelines).

An audit reports known advisories, not proof that the code is free of vulnerabilities. Behavioral security regressions cover traversal and hostile filename wildcards alongside existing malformed-input and webview validation tests.
