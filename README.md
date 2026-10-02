# TypoScript Highlighting

Syntax highlighting and basic editing support for TYPO3 TypoScript and TSconfig in VSCodium and Visual Studio Code.

## Features

- Automatic recognition of `.typoscript` and `.tsconfig` files.
- Highlighting for assignments, multiline values, object paths, copy and reference operators, value modifiers, blocks, constants, imports, conditions, and comments.
- Separate comment rules for TYPO3 v11 and TYPO3 v12/13/14.
- Per-document TYPO3 detection from the nearest Composer project, including parent projects and mixed-version workspaces.
- Automatic refresh when Composer files or language settings change.
- Comment toggling, bracket matching, automatic closing, indentation rules, and region folding.
- Optional colors per syntax category, with a spectrum picker, direct hex input, and System Default using the active editor theme.

This extension provides TextMate syntax highlighting. It does not validate or execute TypoScript, and it does not provide a language server, completion, formatting, or semantic diagnostics. Colors follow the selected editor theme unless you configure an override.

## Installation

Build a VSIX from this repository, then install it in VSCodium:

```bash
npm ci
npm run package
codium --install-extension typoscript-highlighting-1.3.0.vsix --force
```

Alternatively, use **Extensions: Install from VSIX** in the editor. Visual Studio Code uses `code --install-extension` with the same package.

## Comment rules and version detection

The setting `typoscriptHighlighting.commentRules` accepts:

| Value | Behavior |
| --- | --- |
| `auto` | Detect the nearest TYPO3 Composer project for each document. This is the default. |
| `v11` | Force TYPO3 v11 rules. |
| `v12` | Force modern comment rules for TYPO3 12. |
| `v13` | Force modern comment rules for TYPO3 13. |
| `v14` | Force modern comment rules for TYPO3 14. |

The Settings dropdown lists **Auto (Composer detection)** and **TYPO3 11**, **12**, **13**, and **14**. The explicit `v12`, `v13`, and `v14` choices all use the shared modern grammar and the **TypoScript (v12+)** language mode. Projects using TYPO3 13 or 14 automatically select that modern mode.

| TYPO3 version | Automatic comment mode | Verification |
| --- | --- | --- |
| 11.5 | `v11` | Legacy grammar regression tests and editor version selection |
| 12.4 | `v12` | Modern grammar regression tests and editor version selection |
| 13.4 | `v12` | Official documentation, both core tokenizers, Composer detection, and editor settings |
| 14.3 | `v12` | Official documentation, both core tokenizers, Composer detection, and editor settings |

This verification covers comment highlighting and version selection. See the [development log](docs/development-log.md#issue-1-follow-up-on-october-2-2026) for the tested source revisions and results.

```json
{
  "typoscriptHighlighting.commentRules": "auto"
}
```

The setting can be configured per workspace folder. Detection starts in the document's directory and searches upwards, so opening a Sitepackage subdirectory also finds its parent Composer project. Nested projects and different workspace folders are evaluated independently.

A usable installed version in `composer.lock` takes precedence. `composer.json` is used when the lockfile is missing, unreadable, or does not provide a usable version. Both `typo3/cms-core` and `typo3/cms` are recognized, including development dependencies; normal requirements take precedence over development requirements.

Common exact, caret, tilde, wildcard, comparison, hyphen, and OR constraints are supported conservatively. Detection only selects v11 when the complete supported range stays in v11. Constraints spanning v11 and v12+, unsupported branch aliases, and unknown versions default to v12+; use an explicit setting for such projects. An ambiguous nested TYPO3 project does not inherit its parent's version.

In `auto` mode, manually choosing **TypoScript (v11)** or **TypoScript (v12+)** pins that open document to the selected mode. Choose **TypoScript** to resume detection. An explicit `v11`, `v12`, `v13`, or `v14` setting takes precedence over a manual selection. Untitled and other unsupported resource schemes use the default rules or an explicit selection. Local and `vscode-remote` files are read asynchronously through the editor filesystem API.

## Syntax notes

A multiline value starts with the object path followed directly by `(`:

```typoscript
page.10.value (
  This is a multiline value.
  # This line is part of the value.
  Site: {$site.name}
)
```

With a normal `=` assignment, everything following the operator is a value, including `#`, `//`, and `/*`. Writing `value = (` assigns a single-line value; it does not start a multiline block. See the [TYPO3 syntax reference](https://docs.typo3.org/m/typo3/reference-typoscript/12.4/en-us/Syntax/Operators/Index.html).

TYPO3 v11 block comments must start and end at the beginning of a trimmed line. TYPO3 12, 13, and 14 also allow inline block comments. The v11 editor configuration offers line-comment toggling with `#` to avoid generating unsupported inline block comments. See the [v11 syntax rules](https://docs.typo3.org/m/typo3/reference-coreapi/11.5/en-us/Configuration/TypoScriptSyntax/Syntax/TypoScriptSyntax.html) and the comment rules for [v12](https://docs.typo3.org/m/typo3/reference-typoscript/12.4/en-us/Syntax/Comments/Index.html), [v13](https://docs.typo3.org/m/typo3/reference-typoscript/13.4/en-us/Syntax/Comments/Index.html), and [v14](https://docs.typo3.org/m/typo3/reference-typoscript/14.3/en-us/Syntax/Comments/Index.html).

Empty block comments such as `/**/` close immediately in modern mode, so the next statement receives normal highlighting:

```typoscript
/**/
page = PAGE
```

In v11 mode, the closing `*/` must still start its own trimmed line. Inside `=` assignments and multiline values, `/**/` remains part of the value in every mode. Documentation comments containing text retain their separate documentation-comment scope.

## Custom colors

Open **Settings** and search for `typoscriptHighlighting.colors`. Each category accepts a `#RRGGBB` color directly; an empty field means **System Default**, which follows the active editor theme, including theme changes.

Click **Open color picker** in a setting's description to open that category in the **TypoScript Colors** view. Alternatively, run **TypoScript Highlighting: Configure Colors** from the Command Palette. The standard Settings UI uses text fields; the linked view provides the spectrum controls.

- Click a category's color swatch to select it, then choose saturation and brightness in the spectrum and the color tone with the Hue slider.
- Enter a six-digit hex color in the field beside a category. The picker also accepts input without `#` and normalizes it to `#RRGGBB`. Invalid or incomplete values display an error and are not saved; **System Default** also clears an invalid draft.
- Choose **System Default** or clear the hex field to restore the theme for that category.
- Select **User**, **Workspace**, or a workspace **Folder** under **Save colors in**. The active document's folder is selected initially when available; otherwise the view starts with User settings. More specific settings retain the editor's normal precedence.

Changes save automatically and apply to open editors. Opening the picker does not change any setting. At each selected scope, the view displays inherited colors until overridden. System Default saves an empty string at that scope, so an inherited extension color no longer applies there. The spectrum is keyboard accessible: arrow keys adjust saturation and brightness, and Shift makes larger steps. The Hue slider also supports keyboard input.

| Setting suffix | Syntax category |
| --- | --- |
| `comments` | Line/block/documentation comments and their delimiters |
| `objectPaths` | Object paths and copy/reference targets |
| `values` | Assignment values and quoted strings |
| `operators` | Assignment, copy/reference, modification, and deletion operators |
| `constants` | References such as `{$site.name}` |
| `conditions` | Conditions and END/GLOBAL/ELSE keywords |
| `imports` | Import keywords, file paths, and legacy import attributes |
| `functions` | Value modification functions such as `addToList` |
| `punctuation` | Block braces, value/argument parentheses, and legacy import closing brackets |

For example, in user settings or a workspace folder's `.vscode/settings.json`:

```json
{
  "typoscriptHighlighting.colors.comments": "#6A9955",
  "typoscriptHighlighting.colors.objectPaths": "#9CDCFE",
  "typoscriptHighlighting.colors.values": "#CE9178",
  "typoscriptHighlighting.colors.constants": "#DCDCAA"
}
```

Unspecified categories keep their theme colors. Reset a setting or remove its JSON entry to resume inheritance; enter an empty string to explicitly use System Default at that scope. Colors can differ between workspace folders and apply to `.typoscript` and `.tsconfig` documents in all three TypoScript language modes.

Colors from versions 1.1.0 and 1.2.0 continue to work, including legacy `custom` selections and their `typoscriptHighlighting.customColors` entries. The picker displays those resolved colors and stores future edits directly in the individual color settings. The legacy custom-color object is deprecated and can be removed after replacing its selections with direct hex values.

Custom colors change only the foreground of the selected syntax categories; the editor theme continues to supply font styles and other appearance settings. Nested constants and imports keep their own category rather than inheriting a value or comment override. The extension does not rewrite `editor.tokenColorCustomizations` or theme settings. The token engines are loaded only when a visible TypoScript editor has an explicit color. The picker uses packaged local HTML/CSS/JavaScript without additional runtime dependencies.

## Development

Use Node.js 22 or newer for the development tools. `.nvmrc` selects Node.js 24. These requirements apply to the tooling; the extension retains its VS Code API minimum of 1.70.

```bash
npm ci
npm run check
npm test
npm run test:integration
npm run test:colors
npm run package
```

`npm test` runs version-detection, controller, custom-color, manifest, package-content, and real TextMate regression tests. Integration tests launch a separate editor profile with temporary TYPO3 11, 12, 13, and 14 Composer projects. They test per-project detection, Composer watcher updates, folder settings, manual selection, comment toggling, and direct hex/legacy custom-color settings/reset, the spectrum command, and explicit TYPO3 13/14 comment selections. Before changing a Composer version, the suite waits for an actual filesystem event so asynchronous watcher registration cannot race the test. They download VS Code by default. To use an installed VSCodium executable on Linux:

```bash
VSCODE_EXECUTABLE_PATH=/opt/vscodium-bin/codium npm run test:integration
```

`npm run test:colors` runs the rendered-color suite. It uses temporary TYPO3 11/12/13/14 projects and an isolated editor profile, then reads computed foreground RGB values through a localhost debug connection. It verifies all nine categories, literal comment markers and nested constants, CRLF TSconfig, User/Workspace/Folder precedence, grammar switches, edits, close/reopen, legacy Custom settings, shared colors, black/white, invalid input, dark/light themes, picker hex/spectrum/keyboard controls, reset and unrelated languages. Full resets compare every non-whitespace character with its captured theme baseline. Native token-color settings are checked for unwanted changes.

```bash
VSCODE_EXECUTABLE_PATH=/opt/vscodium-bin/codium npm run test:colors
```

The suite checks both rendering and persisted picker settings; it waits for all settings writes to finish before checking reset. Theme baselines wait for native syntax and bracket tokenization to settle. Editor DOM rows are sorted by their rendered position because Monaco reuses rows after edits. The JSON report defaults to `.vscode-test/color-results.json`; set `TYPOSCRIPT_COLOR_REPORT` to choose a path. Failed runs also attempt to save a screenshot next to the report. `TYPOSCRIPT_EXTENSION_PATH` can point to an extracted VSIX to verify the packaged extension.

The release audit passed **37 rendered-color scenarios**, **265 token ranges**, and **5,416 character foreground checks** per editor in VS Code 1.140.0 and VSCodium 1.135.06055. These are representative syntax/color tests, rather than a proof of every TYPO3 construct or theme. See the [release verification log](docs/development-log.md#version-130-release-color-audit-on-october-2-2026).

On headless Linux, run integration tests with `xvfb-run -a npm run test:integration` and color tests with `xvfb-run -a npm run test:colors`. The test runner removes its temporary profile and projects afterwards. Downloaded VS Code builds are ignored by Git.

Both grammar JSON files are generated from `scripts/build-grammars.js`. Edit that file and run `npm run build:grammars`; `npm run check` detects outdated generated files. Press F5 with the included **Run TypoScript Extension** launch configuration to inspect the extension manually. Use **Developer: Inspect Editor Tokens and Scopes** to inspect highlighting.

Packaging runs the checks and regression suite before creating the VSIX. The package includes runtime code, picker assets, language configurations, grammars, images, documentation, and the two token engines used for custom colors, including Oniguruma's WASM binary and license notices. Development dependencies and tests are excluded. GitHub Actions covers Node.js 22, 24, and 26 and runs editor integration and rendered-color tests on Linux. The color job uploads its JSON report and any failure screenshot.

See the [project review](docs/project-review.md) for architecture and resolved findings, and the [development log](docs/development-log.md) for investigation and verification records.

## Screenshot

The original screenshot illustrates the extension's appearance; exact colors depend on the theme.

<img src="images/example.png" alt="Example of TypoScript syntax highlighting" width="450px" />

## Feedback and contributions

Report problems or submit changes through the [GitHub repository](https://github.com/StefanSofka/typoscript-highlighting). Include a small TypoScript example, the selected comment mode, and the expected highlighting when reporting a grammar issue.

## License

[MIT](LICENSE).
