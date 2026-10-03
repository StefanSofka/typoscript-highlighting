# TypoScript Extension Development Log

This log records investigations, implementation decisions and verification results. The current architecture and finding status are described in the [project review](project-review.md).

## Initial inspection on October 2, 2026

The inspection started from clean commit `6572d0d`, version 1.0.3, using Node.js 26.7.0 and npm 11.19.0. It covered tracked text files, history, manifest paths, runtime decisions, both grammars and the existing VSIX archive. No extension code was changed during that inspection.

### Observations

- JavaScript and JSON were syntactically valid.
- The declared language configuration was missing from source and VSIX.
- Common installed versions and requirements produced `null` because of a double-escaped regex. A v11 Composer project incorrectly selected v12 in automatic mode.
- All three language IDs mapped to the same root scope, despite referring to two different grammar files.
- Stateful TextMate checks reproduced missing or incorrect highlighting for standard multiline values, copy and modification operators, references, blocks, object paths and conditions.
- The lockfile still identified the project as version 1.0.2.
- `vsce ls --no-yarn` crashed in `buffer-equal-constant-time` under Node.js 26.7.0.

The original VSIX was 24,954,055 bytes with 7,264 archive entries, including 7,253 under `extension/node_modules/`. Its manifest, runtime and grammars matched the source byte for byte. Two signing binaries each occupied about 15.9 MB before compression.

The initial runtime check used an isolated VM and a small editor API double. The initial grammar check used `vscode-textmate@9.3.2` and `vscode-oniguruma@2.0.1`, with 15 cases per grammar. These checks established the baseline defects; a real editor was not exercised at that stage.

## Functional repair on October 2, 2026

### Implementation

Version 1.0.4 repairs B01 through B13 and addresses the document-management limitations identified during inspection.

- Split activation, document control and Composer detection into small CommonJS modules.
- Replaced broken version parsing and defined conservative handling of Composer constraint families.
- Added per-document ancestor discovery, lockfile precedence, asynchronous filesystem reads and cached directory results.
- Added Composer file watchers, resource-scoped settings, manual language pins and serialized document updates with stale-result protection.
- Added output-channel reporting for filesystem and language-switch failures.
- Rebuilt both grammars from a shared generator, with distinct modern/legacy scopes and corrected syntax coverage.
- Added editing configurations; legacy mode uses line comments to avoid unsupported inline block comment generation.
- Moved tooling to development dependencies, updated the packager and synchronized the manifest and lockfile.
- Added a package allowlist, regression tests, a real editor integration runner, an F5 launch configuration and GitHub Actions.
- Translated and renamed the documentation to English and updated the README.

### Test design

`test/version.test.js` checks installed versions, constraints, package precedence, malformed JSON, directory caching, nested projects, remote URIs, Windows drive and UNC share boundaries, and read failures.

`test/controller.test.js` checks mixed projects, resource settings, Composer file events, manual choices, rejected language switches, stale asynchronous work, closed documents and disposal. Its editor double reproduces the close/open events emitted by real language switching.

`test/grammar.test.js` loads both modes into a single real TextMate registry, catching root-scope collisions as well as tokenization errors. Multiline tests carry state to subsequent lines and check recovery after closing delimiters. Malformed single-line conditions, modifiers and includes must not leak into following statements.

`test/manifest.test.js` checks referenced files, scopes, lockfile consistency and editing configuration. `test/package.test.js` invokes the actual packager file-selection command and rejects unexpected development files.

`test/integration/index.js` activates the extension in an isolated editor profile and temporary multi-root workspace. It exercises version selection, real Composer watcher events, workspace-folder settings, manual selection/reset and line-comment toggling. The runner removes its temporary data afterwards.

### Verification

The following checks passed locally:

| Check | Result |
| --- | --- |
| `npm run check` | JavaScript syntax and generated grammar consistency passed |
| `npm test` on Node.js 26.7.0 | All 130 regression tests passed |
| Regression suite on Node.js 22.23.3 | Passed |
| Regression suite on Node.js 24.21.0 | Passed |
| VSCodium integration runner | All five editor scenarios passed with exit code 0 |
| `npm run package` | Prepublish checks and tests passed; VSIX created |
| Documentation review | English source text and working relative Markdown links |
| `git diff --check` | Passed |

The real editor tests used the installed VSCodium build 1.135.06055. They verified activation in a mixed v11/v13 workspace, Composer filesystem watchers, folder-specific settings, manual language changes/reset and comment toggling. They used separate temporary profiles and projects.

The same five integration scenarios also passed when loading the extension extracted from the built VSIX. Archive inspection confirmed that its runtime modules, grammars and language configurations match the working source and that development dependencies are absent.

The repaired VSIX contains 16 archive entries, no `node_modules`, and is below 300 KB, compared with the original 24,954,055-byte archive. Both language configurations and all runtime modules are included. The version is 1.0.4. GitHub Actions was added for repeatable checks; its remote runs have not been observed during this local repair.

### Scope boundaries

The suite checks the repaired feature set. It does not prove that every TYPO3 construct or editor theme is correct. Composer branch aliases and unsupported constraints safely use the documented fallback. The extension remains a highlighter rather than a semantic validator. No marketplace publication or Git commit was made as part of this work.

## Issue 1 follow-up on October 2, 2026

The follow-up started from clean commit `c60a2cb`, version 1.0.4. It rechecked every statement in the [Issue 1 closing comment](https://github.com/StefanSofka/typoscript-highlighting/issues/1#issuecomment-3807439532), fixed the remaining empty-comment defect, and checked TYPO3 13 and 14 explicitly.

### Empty block comments

The original documentation-comment opener consumed `/**` in `/**/`. This consumed the star needed by the closing delimiter, leaving later lines inside a comment in modern mode. A negative lookahead now excludes this empty form from the documentation-comment rule. The ordinary block-comment rule handles the complete `/*` and `*/` pair instead.

Regression tests cover `/**/`, `/* */`, `/** */`, and `/***/`, empty inline comments after operators and conditions, and literal markers in single-line and multiline assignments. They also verify that v11 still waits for a closing delimiter at the start of a trimmed line. Documentation comments containing text keep their dedicated scope. Both generated grammars were rebuilt.

### TYPO3 13 and 14 verification

The [TYPO3 13.4 comment documentation](https://docs.typo3.org/m/typo3/reference-typoscript/13.4/en-us/Syntax/Comments/Index.html) and [TYPO3 14.3 comment documentation](https://docs.typo3.org/m/typo3/reference-typoscript/14.3/en-us/Syntax/Comments/Index.html) retain the modern comment rules introduced in v12. These versions therefore use the existing `typoscript-v12` language mode and `v12` setting.

The original `LosslessTokenizer` and `LossyTokenizer` classes and their tokenizer dependencies were downloaded into temporary directories and executed under PHP at these pinned core revisions:

| TYPO3 branch | Core revision | Result |
| --- | --- | --- |
| 13.4 | [`658c74d46926f924e97e03b8a6caef23e2174401`](https://github.com/TYPO3/typo3/tree/658c74d46926f924e97e03b8a6caef23e2174401/typo3/sysext/core/Classes/TypoScript/Tokenizer) | 14 examples passed against each tokenizer; 28 checks passed |
| 14.3 | [`d67668a0e7ced80532afa0942420d23b5a6bbab6`](https://github.com/TYPO3/typo3/tree/d67668a0e7ced80532afa0942420d23b5a6bbab6/typo3/sysext/core/Classes/TypoScript/Tokenizer) | 14 examples passed against each tokenizer; 28 checks passed |

The examples covered empty and ordinary block comments, documentation comments, standalone line comments, literal comment markers after `=`, multiline values, and inline comments after deletion, copying, references, modifiers, and conditions. Assertions checked the actual assignment paths and values returned by the core tokenizers. This is a direct tokenizer check, not a full TYPO3 installation or frontend test.

Controller tests now cover both TYPO3 13 and 14 with `composer.lock` and `composer.json`, both recognized TYPO3 package names, and documents inside Sitepackage subdirectories. Version tests additionally cover stable v14 versions and modern constraints such as `^13.4`, `^14.3`, `~14.3.0`, wildcards, bounded comparisons, and `^13 || ^14`.

### Editor test readiness

The unchanged integration test timed out waiting for a Composer update in VS Code 1.140.0. The file was modified before asynchronous watcher registration was ready. A diagnostic run with a delay confirmed the timing problem.

The integration test now waits for an observed Composer filesystem event before making its single version-changing write. It rewrites the unchanged initial manifest only while waiting for watcher readiness, with a bounded timeout. Runtime watcher code remains unchanged.

The isolated workspace now contains TYPO3 11, 12, 13, and 14 projects. Editor tests verify automatic detection, a manifest change from v11 to v14, folder settings without changing other projects, explicit `auto`/`v11`/`v12` settings for v13 and v14, manual language selection/reset, and comment toggling.

### Verification

| Check | Result |
| --- | --- |
| `npm run check` | Passed |
| `npm test` on Node.js 26.7.0 | All 154 regression tests passed |
| Additional stateful comment matrix | All 92 cases passed; the original audit had reproduced the `/**/` defect |
| Original TYPO3 13.4 tokenizers | All 28 checks passed |
| Original TYPO3 14.3 tokenizers | All 28 checks passed |
| VS Code 1.140.0 integration runner | All seven editor scenarios passed, exit code 0 |
| VSCodium 1.135.06055 integration runner | All seven editor scenarios passed, exit code 0 |
| VSIX packaging | Prepublish checks and tests passed; package built in a temporary directory |
| `git diff --check` | Passed |

README and project-review documentation now describe the shared modern mode, the verified TYPO3 branches, empty-comment behavior, and editor-test readiness. The extension version remains 1.0.4 in this working change; no publication is part of this follow-up.

## Optional syntax colors on October 2, 2026

Version 1.1.0 adds nine resource-scoped foreground color settings under `typoscriptHighlighting.colors.*`. Every setting defaults to an empty string: System Default, which uses the active editor theme and existing native token-color customization. Each explicit override accepts `#RRGGBB`; resetting a field or removing its entry restores the theme.

### Implementation

- Added `lib/tokenizer.js`, which loads the TextMate/Oniguruma engines lazily and uses the extension's actual modern or legacy grammar to classify ranges.
- Added `lib/colors.js`, which applies foreground-only editor decorations for explicitly configured categories. Per-document settings allow different projects to use different colors.
- Preserved separate categories for nested constants, quoted strings, and imports. Comment markers in assignment values retain their existing parser semantics.
- Cached ranges by document URI, version, and language. Text edits are debounced for 75 ms; configuration and visible-editor changes refresh immediately. Stale async work is rejected after document, mode, setting, visibility, or lifetime changes.
- Added cleanup for settings resets, closed documents, timers, decoration types, and token registries. System Default loads no token engines and creates no decoration types.
- Kept native `editor.tokenColorCustomizations` and theme settings untouched. The extension only reads its own color settings.
- Moved the two token engines from development dependencies to runtime dependencies. The package allowlist contains only their runtime JavaScript, manifests, WASM binary, and license/notice files. Packaging and test tools remain development dependencies.
- Updated the README with Settings instructions, the category list, JSON examples, reset behavior, and packaging details. Synchronized the extension manifest and lockfile to 1.1.0.

### Verification

| Check | Result |
| --- | --- |
| `npm run check` | Passed |
| `npm test` on Node.js 26.7.0 | All 165 regression tests passed |
| VS Code 1.140.0 integration runner | All eight editor scenarios passed |
| VSCodium 1.135.06055 integration runner | All eight editor scenarios passed |
| Rendered editor color inspection | All nine configured categories displayed the requested RGB colors |
| System Default reset inspection | Every non-whitespace character returned to its original theme foreground |
| VSIX packaging | Both runtime modules, both engines, WASM, and license notices included; development files excluded |

Color tests exercise the actual grammar engines, mixed resources, nested constants, v11/v12+ comment behavior, live edits/reset, invalid colors, initialization failures, stale settings during loading, and disposal. The editor scenarios additionally verify folder-specific settings, language switching, reset, and unchanged native token-color settings.

The visual check used an isolated VSCodium profile, the real extension, and a TYPO3 14.3 Composer project. Rendered foregrounds were inspected before overrides, after configuring all categories, and after clearing them. This checked the displayed result in addition to API calls. No marketplace publication is part of this change.

## Settings dropdowns on October 2, 2026

Version 1.2.0 replaces the nine free-text color controls with dropdowns. Each offers System Default, 17 named colors with hex labels, and Custom. System Default remains the initial choice. Custom resolves the matching resource-scoped entry in `typoscriptHighlighting.customColors`; missing or invalid entries fall back to the theme. Changes to either setting refresh visible editors immediately. Existing 1.1.0 hex overrides remain supported at runtime; values outside the palette can be moved into the custom-color object to match the new schema.

Comment Rules now lists Auto (Composer detection) and explicit TYPO3 11, 12, 13, and 14 choices. The v13/v14 overrides select the same modern grammar and TypoScript (v12+) language mode as v12, without Composer reads. Automatic detection and manual pins retain their existing behavior. Returning to auto restores a prior manual pin.

README and project-review documentation describe the dropdowns, custom-color object, migration of existing hex values, version selections, and reset behavior. Manifest and lockfile are synchronized to 1.2.0.

| Check | Result |
| --- | --- |
| `npm run check` and `git diff --check` | Passed |
| `npm test` on Node.js 26.7.0 | All 170 regression tests passed |
| VS Code 1.140.0 integration runner | All eight editor scenarios passed |
| VSCodium 1.135.06055 integration runner | All eight editor scenarios passed |
| Actual Settings controls in an isolated VS Code profile | All nine color dropdowns rendered with 19 choices; Comment Rules rendered all five choices; UI selections persisted and were read back through the editor API |
| Rendered VSCodium foregrounds | All nine categories displayed their selected preset/custom RGB colors; System Default restored the original theme foregrounds |
| VSIX packaging | Prepublish checks passed; runtime files, grammars, engines, WASM and documentation included |

The regression additions cover the settings schema, explicit v13/v14 overrides over legacy projects and manual pins, per-resource custom colors, live custom-color edits, reset, and missing/invalid custom values without engine initialization. Real editor tests exercise preset and custom selections and verify that native token-color settings remain unchanged. UI and rendering probes use temporary profiles and projects. No marketplace publication or Git commit is part of this change.

## Spectrum picker and direct hex input on October 2, 2026

Version 1.3.0 replaces the individual color dropdowns with direct `#RRGGBB` fields. Every field retains an empty-string System Default and links to the new TypoScript Colors view. The Configure Colors command also opens that view and activates the extension even without an open TypoScript document. TYPO3 11–14 Comment Rules choices remain unchanged.

The local webview provides a saturation/brightness spectrum, hue slider, per-category hex entry and System Default reset. Pointer dragging and keyboard adjustments synchronize the selected hex value. The picker accepts hex input with or without `#`, normalizes case, and rejects incomplete or invalid values without saving them. Changes save automatically; opening the view does not change any color. Narrow editor columns place the spectrum before the category fields, and swatch buttons bring it into view.

User, Workspace and Folder scope selection preserves resource settings. Inspection resolves inherited values at the selected scope; System Default writes an explicit empty string to mask an inherited extension override. The host captures the scope for each accepted edit and serializes writes so fast edits to different categories cannot lose settings. Existing 1.1.0 hex values and 1.2.0 `custom` selections remain usable. New picker edits write hex directly; the legacy custom-color object is deprecated.

Added `lib/color-settings.js` and local `media/color-settings.js` / `.css` assets with restricted resource roots and a nonce-based content security policy. Messages validate categories, values and scopes before saving. The panel is reused while open and releases its message listener on close. Configuration and workspace-folder changes refresh the view. No new runtime dependency was added. README, project review, package allowlist and the 1.3.0 manifest/lockfile were updated.

| Check | Result |
| --- | --- |
| `npm run check` and `git diff --check` | Passed |
| `npm test` on Node.js 26.7.0 | All 177 regression tests passed |
| VS Code 1.140.0 integration runner | All nine editor scenarios passed |
| VSCodium 1.135.06055 integration runner | All nine editor scenarios passed |
| Rendered VSCodium picker | Nine hex fields, spectrum pointer dragging, hue selection, keyboard adjustment, invalid-input rejection and System Default reset passed |
| Foreground inspection | Spectrum and hex selections produced the requested RGB values in the visible TypoScript editor |
| Native Settings entry | Direct hex field displayed; its Open color picker link activated and opened the selected category without saving a color |
| Native theme settings | Unchanged throughout the picker checks |
| VSIX packaging | Prepublish checks passed; host module, picker JavaScript/CSS, existing runtime engines and documentation included |

Host regression tests cover scope inheritance, legacy compatibility, serialized writes, scope changes during pending writes, explicit theme reset, invalid messages, external configuration changes, removed folders, close/disposal, save failures and recovery. The UI checks use isolated temporary editor profiles and real extension messages/settings, and inspect the rendered foregrounds rather than only API calls. No marketplace publication or Git commit is part of this change.

## Version 1.3.0 release color audit on October 2, 2026

The release audit starts from `c60a2cb` on master and includes the accumulated issue-1 fix, explicit TYPO3 13/14 Comment Rules, category colors and spectrum picker. The user requested an extensive check that the colors actually apply, updated documentation, and merge/push to master once verification passes. Work was isolated on `release/1.3.0-color-picker`.

Added a repeatable `npm run test:colors` suite using isolated real editors and temporary TYPO3 11/12/13/14 Composer projects. `test/integration/colors.js` drives settings and document operations; `scripts/color-probe.js` reads rendered RGB values and operates the actual spectrum view through a localhost debug connection. Fixtures include LF TypoScript and CRLF TSconfig. The probe carries independent expected categories and positions, sorts recycled DOM rows by their rendered position after edits, waits for native syntax/bracket tokenization before capturing theme baselines, and waits for picker saves before verifying persisted settings. Default restoration compares all non-whitespace characters against the captured theme baseline. JSON reports and failure screenshots are retained outside the temporary profiles.

### Coverage

- All nine categories on TYPO3 11, 12, 13 and 14, including reference targets, imports, nested constants, braces and literal markers in assignments/multiline values.
- Exact System Default restoration, User/Workspace/Folder precedence, folder isolation, explicit empty overrides and removal of inherited overrides.
- Legacy/modern grammar switching, multiline edits, subsequent edits and close/reopen.
- All legacy Custom categories, one shared color, black/white, partial overrides and invalid persisted values.
- Light/dark themes, custom colors retained across theme changes, and exact restoration to the current theme.
- Actual picker entry for all nine categories, lowercase hex without `#`, invalid input/recovery, pointer dragging, hue selection, keyboard adjustment, rapid reset, persisted values and UI scope selection.
- Unrelated plaintext documents remain unchanged despite effective custom-color settings; native token-color settings remain unchanged throughout.

The audit also identified a small interaction defect: an invalid draft in a default hex field left its System Default button disabled. The picker now enables reset for invalid drafts and gives an appropriate unsaved-input status. A guard also handles controls used before category initialization. The permanent rendered test verifies invalid-draft reset.

### Results

| Check | Result |
| --- | --- |
| `npm run check` and `git diff --check` | Passed |
| Node.js regression suite | All 177 tests passed |
| VS Code 1.140.0 standard integration suite | All nine scenarios passed |
| VSCodium 1.135.06055 standard integration suite | All nine scenarios passed |
| VS Code rendered-color suite | All 37 scenarios passed; 265 token ranges and 5,416 character foreground checks |
| VSCodium rendered-color suite | All 37 scenarios passed; 265 token ranges and 5,416 character foreground checks |
| Extracted 1.3.0 VSIX in both editors | All 37 rendered scenarios passed per editor, with the same 265 ranges and 5,416 character checks |
| Runtime setting/theme mutations | Only the requested extension color settings changed during picker checks; native token-color configuration unchanged |

A dedicated Linux CI job now runs the rendered suite under Xvfb and uploads the JSON report and any failure screenshot. README documents the suite, report path, installed-editor selection and extracted-VSIX verification. Project-review documentation records the audited scope and the invalid-draft fix. Version remains 1.3.0 because this feature version had not yet been merged or published. The extracted VSIX passed the same rendered suite in both editors. The final rebuild updates documentation and setting descriptions; its runtime, grammar and picker assets are compared byte-for-byte with the tested archive before merging. No Marketplace or Open VSX publication is included.

## README overhaul on October 3, 2026

Starting revision: `267a5eb`, extension version 1.3.0. The README was rewritten around installation and everyday use, with the feature description checked against the manifest, language configurations, version controller, tokenizer and color-picker host/UI.

The comparison used the official READMEs of [Prettier for VS Code](https://github.com/prettier/prettier-vscode/blob/main/README.md), [VS Code ESLint](https://github.com/microsoft/vscode-eslint/blob/main/README.md) and [vscode-icons](https://github.com/vscode-icons/vscode-icons/blob/master/README.md). The resulting structure puts the purpose and a real editor screenshot first, then installation, first use, configuration, version behavior and troubleshooting. Settings examples use the actual command and manifest keys. Detailed development instructions were moved to `docs/development.md`.

Live registry checks confirmed version 1.3.0 on both Open VSX and the Visual Studio Marketplace. Store links now lead the installation section; downloading a release VSIX is the alternative. Building from source is documented in the development guide. The decorative banner, duplicate installation commands, release test counts and implementation/audit details were removed from the README. Historical verification remains in this log.

The three existing screenshots were visually inspected and retained with descriptive alternative text, captions and links to their full-size images: the code/picker overview, the dark picker and the light System Default view. The guide explains scope precedence, theme reset versus inheritance, legacy file associations, the shared v12+ label for TYPO3 12–14, and literal comment markers in assigned values.

Verification: local links and heading anchors resolve; all external README links returned HTTP 200; JSON examples parse and extension setting values match the manifest; `vsce ls` includes the development guide and all three screenshots; `git diff --check` passes. A Chromium-rendered Markdown preview was inspected at 980 px and 390 px widths. All images loaded and the page had no horizontal overflow. These are documentation changes; runtime code, extension version and published release packages are unchanged.

## Recording future work

Add a dated entry with the starting revision, concrete task, decisions, changed behavior, checks and remaining issues. Refer to the finding IDs where useful. Update the project review when architecture or supported behavior changes, and distinguish proposed changes from implemented and verified results.
