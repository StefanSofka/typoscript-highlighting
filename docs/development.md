# Development

[README](../README.md) · [Architecture](project-review.md) · [Security](../SECURITY.md) · [Verification history](development-log.md)

## Setup

Use **Node.js 22 or newer** and npm. `.nvmrc` selects Node.js 24; these are development requirements, independent of the extension's VS Code API minimum.

```bash
npm ci
npm run check
npm test
npm audit
```

Runtime code is plain CommonJS JavaScript. Edit grammar sources in `scripts/build-grammars.js`, then run `npm run build:grammars`; do not hand-edit generated grammar JSON.

Press **F5** with **Run TypoScript Extension** to debug. Use **Developer: Inspect Editor Tokens and Scopes** and the **TypoScript Highlighting** output channel for investigation.

## Verification

| Command | Checks |
| --- | --- |
| `npm run check` | Authored JavaScript syntax and generated grammar consistency |
| `npm test` | Unit, regression, documentation and VSIX file-selection tests |
| `npm audit` | Known vulnerabilities in runtime and development dependencies |
| `npm run test:integration` | Detection, migration, navigation, diagnostics and formatting in a real editor |
| `npm run test:colors` | Rendered foregrounds, native/visual Settings, persistence and real menu interactions |
| `npm run test:readme` | Every inline README image in an extracted package's extension Details |
| `npm run package` | Checks/tests and the versioned release VSIX |
| `npm run package:preview` | A local preview with immutable screenshot URLs |

GitHub Actions runs regression/packaging on Node.js 22/24/26, integration on VS Code 1.70.0 and stable, colors on stable, and a dependency audit. The workflow grants read-only repository contents access.

### Real-editor tests

Tests create disposable profiles and temporary TYPO3 11–14 projects. Personal editor settings are not used. The runner checks extension-host completion rather than accepting a CLI wrapper's successful exit.

VS Code is downloaded by default. Select a version or an installed executable:

```bash
VSCODE_VERSION=1.70.0 npm run test:integration
VSCODE_EXECUTABLE_PATH=/opt/vscodium-bin/codium npm run test:colors
```

Headless Linux runners need Xvfb:

```bash
xvfb-run -a npm run test:integration
TYPOSCRIPT_TEST_VIEWPORT=1024x800 xvfb-run -a npm run test:colors
```

| Environment variable | Purpose |
| --- | --- |
| `VSCODE_VERSION` | Download a specified VS Code version, otherwise stable |
| `VSCODE_EXECUTABLE_PATH` | Use an installed editor binary instead of downloading |
| `TYPOSCRIPT_EXTENSION_PATH` | Load an extracted VSIX's `extension` directory |
| `TYPOSCRIPT_COLOR_REPORT` | Choose the JSON report path |
| `TYPOSCRIPT_TEST_VIEWPORT` | Set a compact rendered-test viewport, for example `1024x800` |
| `TYPOSCRIPT_SCREENSHOT_DIR` | Save documentation captures at a fixed 1600 × 1100 viewport |
| `TYPOSCRIPT_VERIFY_PREVIEW_README` | Include package README image checks in the color suite |

The default color report is `.vscode-test/color-results.json`; failures attempt to save an adjacent PNG. CI explicitly includes that hidden directory while restricting artifact collection to `color-results.json*`. If the workbench dismisses its extension menu before mouse handlers are active, the probe reopens the menu within the existing timeout; missing commands and failed page opening still fail.

Screenshot runs exercise extra installation and site-set scenarios. Inspect generated captures before committing them. Reinstalling a same-version preview requires **Developer: Reload Window** and reopening Theme Settings.

### Testing guidelines

Test observable behavior and relevant failures. Keep coverage for scope precedence, migration conflicts/write failures, asynchronous cancellation/lifetime, malformed YAML, cycles, import safety and literal values. Read fresh `WorkspaceConfiguration` objects after writes; they are snapshots.

Use isolated real-editor tests for platform APIs and rendered behavior. Existing minimum-version guards account for API commands absent in VS Code 1.70. Security wildcard regressions run in a bounded child process so a reintroduced backtracking problem cannot hang the suite.

The development-only `@vscode/vsce` override selects a patched `minimatch` 11 release for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). The lockfile also records patched transitive dependencies. Reassess the override when VSCE's declared dependency supports a patched range; verify Markdown rewriting, file selection and actual VSIX packaging after changes.

## Build and inspect a package

```bash
npm run package
npx --no-install vsce ls --tree
```

The output is `typoscript-highlighting-<package version>.vsix`. Installation instructions belong in the [README](../README.md#installation).

`.vscodeignore` allows runtime modules, grammars, media, images, documentation and required runtime dependency distributions/licenses. Development tools, tests and build artifacts are excluded. Inspect the final archive, not just the source tree.

Release packaging pins README image URLs and clickable links to its own `v<package version>` tag. A release tag must exist before those URLs can be verified online.

For review before a release tag exists:

```bash
npm run package:preview
```

Preview mode uses `SCREENSHOT_REVISION` in `scripts/package.js`. New screenshots must be available at that immutable commit. Standard HTTPS PNGs preserve extension Details compatibility; current editors sanitize local/data-URI image sources.

To test packaged runtime files, extract the VSIX and point `TYPOSCRIPT_EXTENSION_PATH` at its `extension` directory. Run integration at the declared minimum, the color suite on a current editor, and `test:readme`. Preview URLs allow image verification before the release tag is published. The independent README test also supports the minimum editor version.

## Release procedure

1. Update the manifest and lockfile with `npm version <version> --no-git-tag-version`. Update the README download/version and changelog together. Keep historical development-log entries intact.
2. Run checks, unit tests and the dependency audit. Verify minimum/current editor integration, compact rendered colors and the packaged runtime. Inspect the package and any changed images.
3. Commit and push `dev`. Wait for every CI job to succeed.
4. Merge the verified commit into `master` and push it. Wait for the master workflow to succeed.
5. Tag that master commit as `v<version>` and push the tag. Wait for tag CI; verify the package's pinned image and documentation URLs.
6. Generate a SHA-256 sidecar and publish a GitHub release with the VSIX, checksum, concise changes and actual verification results. Download/compare the assets and verify the published release.
7. Publish to Marketplace or Open VSX separately when registry publication is part of the task and credentials are available.

Do not change code after verification without rerunning the affected checks. A VSIX build, tag or GitHub release does not update extension registries by itself. Record final release evidence in the development log.
