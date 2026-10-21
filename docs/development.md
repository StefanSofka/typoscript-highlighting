# Development

[Back to the README](../README.md)

## Set up the project

Use Node.js **22 or newer**. The repository's `.nvmrc` selects Node.js 24. These requirements apply to development tools; the extension's declared VS Code API minimum is 1.70.

```bash
npm ci
npm run check
npm test
```

## Commands

| Command | Purpose |
| --- | --- |
| `npm run check` | Check every authored JavaScript file and ensure generated grammars are current. |
| `npm test` | Run version, lifecycle, incremental tokenization, structure, project imports, site-set graph, typed settings, palette, manifest and package regression tests. |
| `npm run test:integration` | Launch a separate editor and test the extension in temporary TYPO3 projects. |
| `npm run test:colors` | Verify rendered syntax colors and operate the real picker in an isolated editor. |
| `npm run build:grammars` | Regenerate both TextMate grammars. |
| `npm run package` | Run checks and regression tests, then build the versioned VSIX in the project root. |

## Editor integration tests

The integration runner creates temporary TYPO3 11, 12, 13 and 14 Composer projects and an isolated editor profile. It tests project detection, Composer watcher updates, folder settings, manual language selection, comment toggling, color settings/reset, the picker command and explicit version settings. Additional fixtures exercise real Classic symlinks, automatic target switches, manifest-free EXT imports, configured Composer paths, core/lock conflicts, enclosing installation selection, YAML definitions/hover/completion and unsaved YAML edits. A completion record written by the extension host prevents a CLI wrapper from producing a false successful run.

The provider suite also checks real outline entries, folding, relative and EXT wildcard links, constant definitions/references/hover/completion, contextual snippets, diagnostics, migration edits and idempotent CRLF formatting. Tests use public editor commands when available; VS Code 1.70 predates the public folding-provider test command, so that check runs on current editors while structural folding is covered by unit tests on every runtime.

Site-set fixtures cover Composer projects with custom roots and Classic symlinked extensions, dependency load order, implicit set and local site sources, direct `siteSettings:` getters, multiline `insertData` references, imported settings, typed list defaults, dependency/key/value completion, YAML links and references, live type/dependency diagnostics, unsaved edits and multi-site context selection. Completion assertions apply the returned edit to existing YAML and verify that values, names and trailing comments survive.

VS Code is downloaded by default. To use an installed editor, point `VSCODE_EXECUTABLE_PATH` at its executable. For example, when VSCodium is installed at this path:

```bash
VSCODE_EXECUTABLE_PATH=/opt/vscodium-bin/codium npm run test:integration
VSCODE_EXECUTABLE_PATH=/opt/vscodium-bin/codium npm run test:colors
```

On headless Linux, use a virtual display:

```bash
xvfb-run -a npm run test:integration
xvfb-run -a npm run test:colors
```

The runner removes temporary profiles and projects after each run. Downloaded editor builds live in the Git-ignored `.vscode-test/` directory.

### Rendered-color checks and reports

The color suite reads computed foreground RGB values through a localhost debug connection and checks persisted picker settings. It covers all nine categories, literal comment markers, nested constants, CRLF TSconfig, settings precedence, grammar changes, document edits, legacy colors, dark/light themes, hex/spectrum/keyboard input and theme resets. Reset checks compare non-whitespace characters with the captured theme baseline. The suite also verifies that native token-color settings and unrelated languages remain unchanged.

Reports default to `.vscode-test/color-results.json`. Failed runs attempt to save a screenshot beside the report.

| Environment variable | Purpose |
| --- | --- |
| `VSCODE_EXECUTABLE_PATH` | Select an installed editor executable. |
| `VSCODE_VERSION` | Download a particular VS Code build, such as `1.70.0`, when no executable is supplied. |
| `TYPOSCRIPT_COLOR_REPORT` | Choose the rendered-color JSON report path. |
| `TYPOSCRIPT_EXTENSION_PATH` | Load an extracted VSIX's extension directory to test packaged runtime files. |
| `TYPOSCRIPT_SCREENSHOT_DIR` | Capture real dark/light picker, editor, outline, Classic/Composer detection, YAML navigation, site-set load order and typed settings screenshots during the color suite. |
| `TYPOSCRIPT_TEST_VIEWPORT` | Set a compact color-test viewport such as `1024x800`; screenshot mode uses its fixed larger viewport. |

To verify the declared minimum and regenerate documentation screenshots:

```bash
VSCODE_VERSION=1.70.0 npm run test:integration
VSCODE_EXECUTABLE_PATH=/opt/vscodium-bin/codium TYPOSCRIPT_SCREENSHOT_DIR=images/screenshots npm run test:colors
```

Screenshot runs use a fixed 1600 × 1100 viewport. Dedicated picker captures maximize the active group after color assertions, then restore the editor layout. Inspect the PNGs before committing documentation changes.

For previous editor versions, scenario counts and audit results, see the [release verification log](development-log.md#version-130-release-color-audit-on-october-2-2026).

## Edit grammars and debug

Both grammar JSON files are generated from `scripts/build-grammars.js`. Edit that source and run `npm run build:grammars`. The `check` command detects outdated generated files.

Press **F5** with the included **Run TypoScript Extension** launch configuration to inspect the extension manually. Use **Developer: Inspect Editor Tokens and Scopes** to inspect highlighting, and the **TypoScript Highlighting** output channel to check update errors.

## Build and inspect a VSIX

```bash
npm run package
npx --no-install vsce ls --tree
```

The current source builds **typoscript-highlighting-1.6.0.vsix**, including site-set editing. Install the resulting file with **Extensions: Install from VSIX…**, or run one of:

```bash
codium --install-extension typoscript-highlighting-1.6.0.vsix
code --install-extension typoscript-highlighting-1.6.0.vsix
```

GitHub release downloads and extension registries are published separately; their available version can differ from the source version.

The package includes runtime modules, picker assets, language configurations, grammars, images and documentation. The runtime token engines include Oniguruma's WASM binary and license notices. The Node distribution and ISC license of the static YAML parser are included too. `.vscodeignore` allowlists the required files; development tools and tests are excluded. Building a VSIX does not publish it to an extension registry.

GitHub Actions runs regression checks and packaging on Node.js 22, 24 and 26, integration on VS Code 1.70.0 and stable, and rendered-color checks on stable. The color job uploads its JSON report and any failure screenshot.

See the [project review](project-review.md) for architecture and resolved findings, and the [development log](development-log.md) for investigation records.
