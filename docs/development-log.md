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

## Version 1.4.0: project editing and settings, October 21, 2026

Implemented the follow-up review on the `dev` branch:

- Persisted automatic/manual language origins, including restart while a version is temporarily forced; released unused shared Composer watchers.
- Added `typo3Version` with compatibility for `commentRules`, source-aware status and a shared-language-settings command.
- Reused TextMate line states after edits, including inserted/deleted lines and multiline state convergence.
- Added structural analysis, outline, region/object/condition/value folding, relative/EXT import links and wildcard selection.
- Added project constant definitions, references, hover and completion, plus contextual setup/TSconfig snippets.
- Added structural/import/version diagnostics, safe legacy-import migration and opt-in indentation-only formatting that preserves values and EOLs.
- Added explicit color inheritance, local theme resets, scope origin/override labels, bulk actions, undo, remembered scope, dark/light palettes, preview and contrast feedback.
- Extended syntax checks to all authored JavaScript and CI integration coverage to VS Code 1.70.0 and stable.

Verification includes unit/regression/package-content tests, native provider integration on VSCodium 1.140 and VS Code 1.70.0, and rendered foreground comparisons with real picker interaction. Documentation screenshots are captured from the isolated VSCodium instance and visually reviewed. Screenshot-only stages maximize the picker after foreground assertions, then restore the editor layout.

The extension remains a source-oriented editing assistant. It does not evaluate conditions, execute TYPO3, load database templates or reconstruct the final effective runtime configuration. Formatting is disabled by default and changes only indentation on recognized code lines in structurally complete documents.


## Version 1.5.0: Composer and Classic detection, October 21, 2026

Starting revision: `3436f6d`, version 1.4.0. The follow-up implements automatic installed-core discovery for Composer and Classic installations and the related project-navigation improvements.

- Read the literal version from the namespaced core class without executing PHP. Respect configured Composer vendor/webroot paths, installed.json formats, locked versions, conservative manifest ranges, copied cores and active Classic symlinks. Inactive source archives are ignored. Composer migrations with leftover sysext copies prefer the declared Composer installation's vendor core.
- Keep installation context for imports even with a syntax override. Enclosing installations take precedence over a Sitepackage's compatibility range; incomplete nested sites retain their own boundary. Core/lock conflicts are visible and both sources can be opened.
- Reuse project roots for EXT imports, including manifest-free Classic local and system extensions. Provide a focused core/property completion catalogue, exact-version PAGEVIEW gating and advisory TEMPLATE/PAGEVIEW migration hints.
- Read static YAML site settings and scalar set defaults, including dotted maps, nested trees, locations, documentation and unsaved edits. Alias/tag/import resolution, site-set activation order and runtime values remain outside the parser. Shared in-flight requests use batches of at most 16 reads/searches, up to 300 locations, 500 files and 20,000 scalar definitions per project lookup. Closing a discarded YAML edit invalidates cached definitions.
- Move manual version selection behind an optional override action. Retain both existing version settings for compatibility; default Auto needs no configuration.

The native VSCodium run demonstrated that the file service can omit symlink replacement events. A three-second check now reads the active core's small version file once per detected project, without recursive polling. Incomplete known installations can recover when the core reappears. Closed projects stop reading and release their watchers. Watch roots are restricted to existing directories because VS Code 1.70 logs errors when asked to watch missing bases.

Verification: all 226 unit/regression/package-content tests and authored JavaScript/grammar checks pass. Native integration covers VSCodium 1.140.0 and VS Code 1.70.0, including a real active symlink switch without manual refresh, Classic EXT imports, custom Composer roots, core/lock mismatch, enclosing project discovery, YAML navigation/hover/completion and unsaved YAML updates. The visual VSCodium run passes 53 scenarios (including six screenshot-only stages), 305 token ranges and 6,204 character foreground comparisons. Seven documentation screenshots are captured from the isolated editor and visually reviewed. Runtime npm dependencies have no reported audit vulnerabilities.

The integration runner now requires a completion record from the extension host: using a CLI wrapper previously exited successfully without running provider assertions. The documented VSCodium executable is the actual editor binary.

Packaged minimum-version verification also exposed a color-picker disposal race: a renderer can disappear before the extension receives its close event. All webview posts now consume the expected old-editor RPC rejection while reporting unrelated delivery failures; a regression test covers both cases.

## Version 1.6.0: site sets and typed settings, October 21, 2026

Starting revision: `5521df0` on `dev`, extension version 1.5.0. Version 1.6.0 adds site-set dependency navigation, typed settings and a selected site context for shared source files.

- Discover named sets from Composer extensions, standalone extension roots and manifest-free Classic extensions, including symlinks and custom vendor/webroot paths. Only the detected installation's site directory contributes contexts; leftover configuration from the other installation type is ignored.
- Resolve required/optional dependency graphs, deterministic registry order, per-site closures, duplicate names, missing required sets and cycles. Unused sets stay outside navigation results. The status bar and two commands expose automatic/persisted site selection and load-order inspection with readable project-relative source paths.
- Compose typed defaults, per-set values and site values from available files, with source history, enum/readonly metadata, list defaults, local aliases and bounded static YAML imports. Separate settings files replace inline values. Custom tags, environment substitution, PHP code, database templates and runtime overrides remain unevaluated.
- Register YAML definitions, references, links, hover, key/type/value completion and live diagnostics. Mid-name/value completion replaces the existing suffix, retains neighboring YAML syntax and preserves trailing comments. Integration tests apply these edits to actual documents.
- Follow implicit set and local site TypoScript/TSconfig files, direct `siteSettings:` getters and multiline `insertData` references. Unsaved YAML edits, discarded changes and site-context selection invalidate cached results.
- Update the README, development guide, architecture review and package-content assertions. Capture and visually review two real VSCodium screenshots showing dependency order and a selected setting beside its typed default.

Verification: authored JavaScript/grammar checks and all 238 regression/package-content tests pass. Native integration passes on VSCodium 1.140.0 and the declared minimum VS Code 1.70.0, covering YAML completion edits, local site sources, multi-site isolation, imported settings, dependency/type diagnostics and Classic symlinked sets. The VSCodium visual suite passes 55 scenarios, 305 token ranges and 6,204 character foreground comparisons. The packaged runtime is checked in both isolated editors. GitHub Actions passes all six jobs on both branches: Node.js 22/24/26 regression and packaging, minimum/stable editor integration and rendered colors. The manifest and lockfile are synchronized to 1.6.0.

Release preparation updates the README download and installation commands to 1.6.0. The release attaches `typoscript-highlighting-1.6.0.vsix` and its SHA-256 checksum, with tag `v1.6.0` on the final master commit. Runtime files in the final archive are compared byte-for-byte with the verified package after the documentation update. GitHub releases and extension-registry publishing remain separate operations.

## Version 1.6.1: Marketplace icon format, October 21, 2026

Starting revision: `429fdc1`, version 1.6.0. Marketplace upload rejected the VSIX because `images/icon.png` contained WebP data despite its PNG filename. The package-content test checked the path but did not validate the actual image format.

Re-encode the existing icon as a real RGB PNG, retaining all 1024 × 1024 decoded pixels exactly. Add a regression test for the PNG signature, IHDR header and minimum 128 × 128 dimensions; the new assertion reproduces the original failure before the asset is corrected. Update the manifest, lockfile and installation instructions to 1.6.1. Extension runtime code and screenshots are unchanged.

Release validation includes authored JavaScript/grammar checks, 239 regression/package-content tests, decoding the icon extracted from the final VSIX and comparing its pixels with the original image. The release includes the rebuilt VSIX and a matching SHA-256 checksum.

## Version 1.7.0: Ready-to-use syntax skins, November 7, 2026

Add five bundled foreground skins: Dark, Light, Nord, Monokai and Solarized. Automatic is the installation default and selects Light/Dark from the active editor color mode without writing settings. OS changes propagate when the editor follows the system. Nord, Monokai and Solarized provide both dark and light variants. The workbench/background and the editor's OS-following preference remain under editor control.

Share color resolution between the picker and open documents. The order is active Dark/Light category overrides, Base category overrides, then the skin. A saved empty category value continues to request the native editor theme; an absent value inherits the skin. Direct hex and legacy custom selections retain compatibility. Editor theme remains available for native syntax colors.

Add the skin selector to the existing color dialog, using its User/Workspace/Folder destination and serialized writes. Skin inheritance and undo preserve the distinction between an absent setting and an explicit selection. Skin changes preserve existing category overrides. Failed skin saves do not create undo entries; failed undo keeps the entry available. Update the README, settings descriptions, development guide, package-content checks and the real VSCodium picker screenshot.

Verification: authored JavaScript/grammar checks and all 247 regression/package-content tests pass. Native integration passes on VSCodium 1.143.1 and the declared minimum VS Code 1.70.0. The rendered VSCodium suite passes 60 scenarios, 539 token ranges and 8,076 character foreground comparisons, including a fresh unconfigured installation, all five skins, live automatic Light/Dark changes, real selector operation, custom-color precedence, inheritance and undo. The 1024 × 800 CI viewport passes the same checks. The screenshot variant passes 69 scenarios and provides visually verified skin-selector, dark editor and dark/light palette captures. Manifest and lockfile are synchronized to 1.7.0.

Release preparation points the README installation instructions at GitHub release `v1.7.0`, refreshes the current architecture description and packages the finalized source with the documentation screenshots. The GitHub release includes `typoscript-highlighting-1.7.0.vsix` and its SHA-256 checksum. Extension registry publication remains separate.

## Version 1.7.1: Keep individual color settings visible, November 7, 2026

A user reported that individual color settings appeared to be missing from Configure Colors. The fields and configuration entries were still present, but the responsive layout placed the large spectrum above all nine fields. In a narrow or split editor, the fields were far below the initial viewport. A new rendered visibility assertion reproduces the problem against the published 1.7.0 package.

Place Individual colors before the spectrum in narrow layouts and raise the responsive breakpoint to avoid squeezing the two-column layout. Give the category list a visible heading and help text. Add Individual colors / Color picker navigation and a return button in the narrow spectrum, with keyboard focus following navigation. Keep all nine editable colors, scopes, palettes, skin overrides, inheritance and undo available. Let nested webview scrolling settle before mapping real pointer input in the rendering test.

Validation includes JavaScript/grammar checks, all 247 regression/package-content tests, minimum VS Code 1.70.0 integration, and the 60-scenario rendered-color suite at 1024 × 800. The rendered suite checks initial visibility of the first category, navigation to the spectrum and back, and the existing real hex, mouse, keyboard and settings persistence checks. Refresh the documentation captures and add a split-editor screenshot focused on the individual fields. Package the correction as 1.7.1.

## Previous local preview: simplified theme settings, November 7, 2026

This section records the direct-entry build before the consolidated storage and reduced native Settings page described in the next section. Its validation counts apply to that earlier local build.

The requested review is prepared locally before any commit, push or release. **TypoScript Highlighting: Theme Settings**, using the stable `configureColors` command ID, opens the visual page directly. A Theme Settings item in this installed extension's gear/context menu is placed before the built-in Settings item. The visual page has one stable layout: a Theme dropdown with Automatic, five complete presets or Custom, nine editable colors, code preview and Save are always visible. Presets apply immediately and fill every input; editing one color automatically starts a Custom version of that entire preset. Remove the webview's destination/palette/skin controls, inheritance/reset/undo menus, section navigation and large spectrum.

Keep native schema entries for stored settings, direct value/JSON editing and compatibility, with an **Open Theme Settings** link to the visual page. The editor's generic Settings renderer cannot be replaced by an extension and remains available through its built-in Settings item. The old `editCustomTheme` command remains an internal alias for older links, hidden from the Command Palette rather than exposed as a second entry point. The extension-context handler ignores the supplied extension ID as a color category.

An explicitly selected preset ignores saved custom colors without deleting them. Custom restores the base category values. Existing installations keep the old color resolution until a modern Theme choice is explicitly configured. The theme editor keeps custom drafts separate from displayed preset colors and preserves invalid intermediate input. Drafts survive switching through all five presets and back. Preset changes write only Theme; saving validates the complete custom palette and selects Custom after the palette write. Native setting changes synchronize the dropdown, and preset changes and Save share one serialized queue. An existing project override determines the destination automatically; otherwise it saves User settings.

The direct visual entry point has 250 passing regression/package-content tests. Prior always-visible-layout validation included minimum VS Code 1.70.0 integration and real VSCodium tests of native compatibility selection/color edits, visual-editor validation/save, preset/custom switching and rendered foregrounds. That compact 1024 × 800 suite passed 63 scenarios with 480 token-range and 6,724 character checks; its screenshot run passed 68 scenarios. Checks cover all nine editable fields for every preset, changing only one preset color and saving the other eight unchanged, Custom draft restoration, and retaining draft colors when the editor appearance changes.

Direct-entry validation subsequently passed 69 screenshot scenarios on VSCodium 1.143.1, covering 480 token ranges and 6,724 character foreground checks. The test clicked the real extension gear menu and its Theme Settings item, confirming that it opens the visual page directly with all nine color fields visible. Normal integration also passed on minimum VS Code API 1.70.0. These results cover the new entry point separately from the preceding 63/68-scenario layout checks. The source version is unchanged while awaiting review; the local VSIX is named `typoscript-highlighting-preview.vsix`.

## Local preview: reduced native Settings and consolidated theme data, November 7, 2026

The native `@ext:stefan-sofka.typoscript-highlighting` page is reduced to Theme, Custom Theme, Diagnostics, Formatting and the optional TYPO3 Version override. Theme keeps its preset dropdown and an **Open Theme Settings** link. Custom Theme is one nested JSON data entry with access to the visual editor. Remove the nine duplicated color hex fields and the older Skin, Dark/Light palette, custom-color and Comment Rules contributions.

Register the resource-scoped `typoscriptHighlighting.customTheme` object with an empty-object default. Save modern custom category colors together in its `colors` member. Store compatibility records for `skin`, `darkColors`, `lightColors`, `customColors` and `commentRules` in an optional `legacy` member. This keeps old values usable without adding obsolete controls to the normal Settings page.

Use the valid schema type array `["object"]` for Custom Theme so the Settings editor offers compact JSON editing while preserving validation. Keep TYPO3 Version visible by removing its former advanced tag. `lib/settings.js` adapts the runtime's internal settings paths to the consolidated object and provides raw-value fallback after migration errors. `lib/settings-migration.js` runs before controllers initialize. Add `jsonc-parser` 3.3.1 as a direct runtime dependency for Folder settings reads, including its UMD files and MIT license in the VSIX.

On activation, migrate configured User, Workspace and open Folder values at their original scopes. Queue migration again when workspace folders change, including a folder added after activation. Existing destination members win. Save each replacement before removing its old keys; preserve explicit empty values and inheritance, report failures and leave source values available if saving fails. Migration does not select a Theme or rewrite other workspaces. Modern preset selection and the visual editor's one-color customization/explicit Save behavior remain as described in the preceding preview.

Custom Save now performs one atomic object update for all nine category colors, preserving other stored Custom Theme data, before a second write selects Custom. Native editor theme and token-color settings remain untouched; the migration intentionally updates the extension's own obsolete data entries.

Rewrite the README around the current workflow and the five-entry native menu. Separate the unpublished local preview from the existing 1.7.1 release download. Update the development guide for consolidated storage, migration, fresh configuration snapshots, reduced native-page checks and preview packaging. Replace the project review's mixed historical descriptions with the current runtime architecture, configuration, limits and verification scope. Keep the earlier release records in this log.

Validation passes authored JavaScript/grammar checks and all 267 unit/regression/package-content tests. Real integration passes on minimum VS Code 1.70.0, including JSONC migration, existing modern colors, all configuration scopes and preservation of unrelated settings. VSCodium 1.143.1 passes 72 screenshot scenarios and 67 compact 1024 × 800 scenarios, each with 480 token-range and 6,724 character foreground checks. The tests operate the five-entry native page, its Theme dropdown and real visual-editor link, the extension gear menu and all nine editable colors. Refresh and visually inspect the reduced-menu, preset, custom-palette and menu screenshots. Monaco delays enabling menu mouse-up handlers by 100 ms; the compact UI test waits for that delay before clicking, instead of relying on screenshot capture to supply it. The preceding 250-test/69-scenario results remain an earlier baseline. The source version remains 1.7.1; no commit, push or release is part of this local review step.

## Local preview follow-up: refactoring and README images, November 7, 2026

Continue the consolidated-settings preview from `98c07bc` without changing the extension version. Share category metadata, configuration-layer order, object-palette semantics and legacy destination paths in `lib/settings.js`. Migration uses the same paths as the adapter. Palette and scalar lookups share one scope-selection helper, and custom draft colors are resolved in `lib/palette.js`. Separate webview markup/CSP into `lib/color-settings-view.js`; keep lifecycle, validation and one serialized write/error queue in the host controller. Remove obsolete test helpers.

Correct destination selection for migrated Dark/Light/custom project palettes: opening Theme Settings must continue at that project's Folder or Workspace scope. Add regressions for these cases and unmigrated raw folder colors. Existing scope inheritance, explicit empty values, custom drafts, failed writes, queue ordering and closed-panel behavior remain covered.

Reproduce the README failure in the installed extension's Details view. VSCE rewrote the new local screenshots to `github.com/.../raw/HEAD/...`, where those uncommitted files did not exist. Current editors sanitize local and data-URI image sources, so embedding images is not a compatible workaround. Add `npm run package:preview` with ordinary PNG/HTTPS URLs pinned to a screenshot-only commit, including clickable image links. Source Markdown remains relative. Add documentation regressions using VSCE's actual Markdown processor, an independent `test:readme` editor run, and optional README assertions in the full color suite.

With the user's approval, publish only the five PNGs on `preview/readme-images-2026-11-07`. Commit `62cf62942f07d01adf5fd71cb4073a0c143322f8` also refreshes the menu capture with a correctly loaded image behind it. No new extension code, release or registry package is published. Check each new HTTPS response's PNG content type, decode it and compare its bytes with the local file. Decode all 17 screenshot/icon PNGs locally, and verify all 26 packaged runtime/assets files against source bytes.

Validation passes JavaScript/generated-grammar checks and all 271 regression/package-content tests. Source and extracted-runtime integration pass on VS Code 1.70.0. VSCodium 1.143.1 passes 67 compact scenarios and 73 packaged screenshot scenarios, with 480 token ranges and 6,724 character foreground checks; the latter additionally verifies all nine inline README images and captures the working Details view. The fresh README and corrected menu screenshots have been visually inspected.

The final pinned revision passes independent Details-view checks on both VS Code 1.70.0 and VSCodium 1.143.1: all nine inline images decode correctly. Verify all ten live screenshot/click destinations against local bytes and PNG content types, and decode all 19 PNGs from the final VSIX, including the icon. The standalone test retries the current workbench's initial installed-extension discovery race before opening Details. The source stays at 1.7.1, and the preview includes a SHA-256 sidecar.

## Version 1.8.0: simplified Theme Settings, November 7, 2026

Release the reviewed settings cleanup and refactoring from `98c07bc` as version 1.8.0. The visual Theme Settings editor opens directly from the extension menu and Command Palette. Automatic, five complete presets, Custom, all nine editable colors, a code preview and explicit Custom saving share one layout. Native Settings exposes five entries. Existing User, Workspace and Folder settings migrate into the grouped Custom Theme object while preserving destination values, compatibility behavior and scope inheritance. Project palettes retain their project save destination.

Synchronize the manifest, lockfile, installation commands, current architecture and development guide to 1.8.0; retain previous preview records as history. Use one `scripts/package.js` entry point for versioned releases and optional local previews. Release image and content URLs are pinned to the release's own `v1.8.0` tag. Preview mode retains its immutable screenshot commit. Add release-tag coverage beside the preview Markdown regression, bringing the regression/package-content suite to 272 tests.

Package `typoscript-highlighting-1.8.0.vsix` with the verified PNG screenshots and a matching SHA-256 sidecar. Publish the source through `dev` and `master`, tag the final master merge as `v1.8.0`, and attach the package and checksum to the new latest GitHub release. Verify the extracted runtime, icon and screenshot formats, real-editor behavior and tagged image links. GitHub release publication and extension-registry publication remain separate operations.

## CI follow-up: intermittent Theme Settings menu dismissal, November 8, 2026

The first `colors` attempt in [release workflow 42385839878](https://github.com/StefanSofka/typoscript-highlighting/actions/runs/42385839878) failed with `Theme Settings menu item disappeared`: the workbench dismissed the extension Manage menu before the simulated click. The existing rerun of the same `193170e` commit passed all 67 rendered scenarios on VS Code 1.145.2.

Reopen the real Manage menu and retry selection within the probe's existing timeout when its Theme Settings item disappears during the mouse-handler activation delay. Continue checking the real menu contribution and the resulting webview. Enable `include-hidden-files` for the narrowly scoped `.vscode-test/color-results.json*` artifact upload; both original attempts skipped these reports because their parent directory is hidden.

Validation passes JavaScript/generated-grammar checks, all 272 regression/package-content tests and workflow YAML parsing. On VS Code 1.145.2 at 1024 × 800, a temporary fault-injection probe dismisses the menu with Escape just before selection: the original probe reproduces the CI error, while the corrected probe reopens the menu and passes all 67 scenarios. A separate normal run also passes all 67 scenarios. Each successful color run verifies 480 token ranges and 6,724 character foregrounds. These changes concern the test probe, CI artifact collection and development documentation.

## Version 1.8.1: maintenance and security review, November 8, 2026

Review the runtime, project/source discovery, YAML handling, settings migration, theme webview, asynchronous controllers, packaging and current documentation. Move shared URI directory/containment and filename matching into `lib/paths.js`; reuse the common language predicate in the color controller.

Normalize Windows separators before rejecting TypoScript parent traversal. Replace user-derived filename regular expressions with a reusable literal-fragment matcher: an adversarial 32-wildcard pattern makes the former matcher exceed a bounded subprocess timeout, while the replacement completes normally. Preserve multiple YAML filename wildcards, literal punctuation, deterministic sorting and TypoScript's single-wildcard restriction. Enforce the documented YAML size bound in UTF-8 bytes. Correct multiline YAML hit-testing and return a hover range containing the requested value position, verified through the real editor provider API.

The initial dependency audit flags six development-tool dependency entries. Update the lockfile to patched Azure identity/MSAL, qs and underscore releases; scope a patched minimatch 11 override to VSCE. Full and production-only audits both report zero known vulnerabilities after the update. Add an independent CI dependency audit, read-only repository permissions and the corrected hidden color-report upload. A scan for common private-key and access-token patterns finds no matches in authored project files; this does not establish the absence of all secrets or vulnerabilities.

Rewrite the README as installation, quick start and the authoritative five-setting reference. Move detailed feature examples and troubleshooting to a user guide; keep development commands/release steps, architecture invariants, security policy and changelog in their own linked documents. Preserve previous investigation records as history. Documentation tests validate local files/headings, current install references, image formats and VSCE link rewriting without requiring a historical screenshot count.

Local validation passes JavaScript/generated-grammar checks and all 281 regression/package-content tests. The extracted preview passes integration on VS Code 1.70.0 and 1.145.2, including the new multiline-value hover check. At 1024 × 800, the current editor passes 68 rendered scenarios including both inline README images; fault injection that closes the Manage menu before selection passes 67 scenarios. Both runs verify 480 token ranges and 6,724 character foregrounds. Independent README verification also loads both images in VS Code 1.70.0. All 19 packaged PNGs decode, and extracted runtime assets match the reviewed source. GitHub CI and published asset verification are recorded in the release notes after publication.
