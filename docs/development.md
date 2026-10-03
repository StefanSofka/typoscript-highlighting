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
| `npm run check` | Check JavaScript syntax and ensure generated grammars are current. |
| `npm test` | Run version-detection, controller, color, picker-host, manifest, package-content and TextMate regression tests. |
| `npm run test:integration` | Launch a separate editor and test the extension in temporary TYPO3 projects. |
| `npm run test:colors` | Verify rendered syntax colors and operate the real picker in an isolated editor. |
| `npm run build:grammars` | Regenerate both TextMate grammars. |
| `npm run package` | Run checks and regression tests, then build the versioned VSIX in the project root. |

## Editor integration tests

The integration runner creates temporary TYPO3 11, 12, 13 and 14 Composer projects and an isolated editor profile. It tests project detection, Composer watcher updates, folder settings, manual language selection, comment toggling, color settings/reset, the picker command and explicit version settings.

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
| `TYPOSCRIPT_COLOR_REPORT` | Choose the rendered-color JSON report path. |
| `TYPOSCRIPT_EXTENSION_PATH` | Load an extracted VSIX's extension directory to test packaged runtime files. |

For previous editor versions, scenario counts and audit results, see the [release verification log](development-log.md#version-130-release-color-audit-on-october-2-2026).

## Edit grammars and debug

Both grammar JSON files are generated from `scripts/build-grammars.js`. Edit that source and run `npm run build:grammars`. The `check` command detects outdated generated files.

Press **F5** with the included **Run TypoScript Extension** launch configuration to inspect the extension manually. Use **Developer: Inspect Editor Tokens and Scopes** to inspect highlighting, and the **TypoScript Highlighting** output channel to check update errors.

## Build and inspect a VSIX

```bash
npm run package
npx --no-install vsce ls --tree
```

The package includes runtime modules, picker assets, language configurations, grammars, images and documentation. The two runtime token engines include Oniguruma's WASM binary and their license notices. `.vscodeignore` allowlists the required files; development tools and tests are excluded. Building a VSIX does not publish it to an extension registry.

GitHub Actions runs regression checks and packaging on Node.js 22, 24 and 26, plus integration and rendered-color tests on Linux. The color job uploads its JSON report and any failure screenshot.

See the [project review](project-review.md) for architecture and resolved findings, and the [development log](development-log.md) for investigation records.
