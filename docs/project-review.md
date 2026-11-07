# TypoScript Extension Architecture

This document describes version **1.8.0**, including the simplified theme editor, consolidated settings, compatibility migration and refactored configuration code. Historical investigations, release-specific behavior and earlier test results are recorded in the [development log](development-log.md). Everyday instructions are in the [README](../README.md).

## Runtime structure

The extension uses CommonJS JavaScript and generated TextMate grammars, with no compilation step. It supports TypoScript and TSconfig highlighting, project navigation, site sets, typed static settings, diagnostics and optional indentation formatting. It does not run TYPO3 or evaluate its final runtime configuration.

| File or directory | Responsibility |
| --- | --- |
| `package.json` | Languages, the five public settings, commands, activation and development tools |
| `extension.js` | Activation, configuration migration, controller initialization and output channel |
| `lib/settings.js` | Shared category/scope metadata, consolidated theme adapter and legacy fallback paths |
| `lib/settings-migration.js` | Scope-preserving migration, JSONC Folder reads and post-save cleanup |
| `lib/controller.js` | Per-document detection, manual language selection, watchers and update lifecycle |
| `lib/version.js` | Composer/Classic installation context, version sources, conflicts and caches |
| `lib/language.js` | Shared language IDs and target-version compatibility |
| `lib/editor.js` | Version indicator, source inspection, optional override and shared language settings |
| `lib/parser.js` | Structural TypoScript/TSconfig analysis without runtime evaluation |
| `lib/project.js` | Installation-scoped imports, extension discovery and source searches |
| `lib/features.js` | Outline, folding, links, completion, navigation, diagnostics, quick fixes and formatting |
| `lib/snippets.js` | Setup and TSconfig completion snippets |
| `lib/site-sets.js` | Set registry, dependency ordering, static composition and site context |
| `lib/site-settings.js` | Static YAML values, typed definitions, imports, validation and source ranges |
| `lib/site-set-features.js` | YAML dependency/setting navigation, hover, completion and diagnostics |
| `lib/site-context.js` | Automatic or remembered site choice and load-order inspection |
| `lib/skins.js` | Five syntax-color presets and automatic Light/Dark resolution |
| `lib/palette.js` | Modern custom colors and legacy palette resolution at resource scopes |
| `lib/color-settings.js` | Visual Theme Settings command, captured destination, saves and panel lifecycle |
| `lib/color-settings-view.js` | Webview markup, preview example, CSP and local asset URLs |
| `media/` | Theme dropdown, nine swatch/hex fields, local preview, validation and Save |
| `lib/colors.js` | Foreground decorations, per-resource colors, caching and cleanup |
| `lib/tokenizer.js` | Lazy TextMate/Oniguruma initialization and grammar-based color categories |
| `scripts/build-grammars.js` | Shared source for generated modern and legacy grammars |
| `scripts/run-integration.js` | Disposable editor profiles and project fixtures |
| `scripts/color-probe.js` | Native/webview interaction and rendered foreground checks |
| `scripts/package.js` | Versioned VSIX with links pinned to the release tag, or a preview using a screenshot-only commit |
| `test/` | Unit, regression, packaging and real-editor checks |
| `.vscodeignore` | Runtime/package allowlist |
| `.github/workflows/test.yml` | Regression, packaging and editor validation |

Runtime dependencies are `vscode-textmate`, `vscode-oniguruma`, the static `yaml` parser and `jsonc-parser` 3.3.1 for settings migration. The package includes the token engines, Oniguruma WASM, required licenses/notices, YAML's Node distribution, JSONC parser UMD files and MIT license, local theme-editor assets, generated grammars, images and documentation. Development tools and tests are excluded from the VSIX.

## Settings and theme workflow

The native extension Settings page contributes five resource-scoped entries:

| Setting | Role |
| --- | --- |
| `typoscriptHighlighting.theme` | Automatic, Dark, Light, Nord, Monokai, Solarized or Custom |
| `typoscriptHighlighting.customTheme` | One stored object for custom colors and migrated compatibility data |
| `typoscriptHighlighting.diagnostics.enabled` | Enable structural, import, migration and YAML diagnostics |
| `typoscriptHighlighting.formatting.enabled` | Opt in to conservative indentation formatting |
| `typoscriptHighlighting.typo3Version` | Optional target override when automatic detection is insufficient |

The nine individual color inputs, old Skin selector, separate Dark/Light palettes, legacy custom-color object and duplicate Comment Rules selector are removed from the public configuration contributions. The native page retains the Theme dropdown and **Open Theme Settings** link. The nested Custom Theme object uses the valid schema type array `["object"]` to retain compact JSON access on the minimum and current editors instead of expanding into nine more input rows. The optional TYPO3 Version control remains visible alongside the other four entries.

The visual page is the color-editing interface. The stable `typoscriptHighlighting.configureColors` command is presented as **TypoScript Highlighting: Theme Settings**. A guarded `extension/context` contribution places it in this installed extension's gear menu at `2_configure@0`, before the built-in Settings item. The extension ID passed by that menu is ignored as a color-category argument. `editCustomTheme` remains an internal alias for older links, without a second Command Palette entry.

VSCodium/VS Code owns the generic Settings renderer. Configuration contributions define its standard fields, descriptions and order; the extension does not override that renderer or intercept the built-in Settings command. Swatches, the color picker and the live syntax preview belong to the visual webview.

### Presets and custom drafts

The visual page always displays the same Theme dropdown, nine editable color fields, code preview and Save button. Automatic follows the editor's light/dark appearance; OS changes propagate when the editor follows the system. Dark and Light provide fixed palettes. Nord, Monokai and Solarized have light and dark variants. These are foreground palettes; they do not change the workbench or editor background.

Selecting a preset applies that selection immediately and fills all nine fields from its complete palette. Saved custom colors are retained separately. Editing any field starts a Custom draft containing all nine visible colors, preserving the other eight preset values. Swatch and hex input update only the local preview until Save. The dropdown can return to a saved or unsaved Custom palette after viewing presets while the panel remains open. Closing the panel discards unsaved drafts.

Save requires nine valid six-digit hex colors. It writes the entire custom palette with one atomic Custom Theme object update at the captured destination, preserving compatibility data, and then selects Custom with a second write. Preset selection writes only Theme. Both operations share a serialized host queue and disable controls while pending. A failed preset write restores the previous selection and field values; errors are reported without pretending a draft was saved. The host validates message shapes, categories and values independently of frontend validation.

User settings are the default destination. If the active TypoScript file already has explicit project theme/custom data, including migrated Dark/Light/custom palettes, the editor continues at that Folder or Workspace scope. A plain label identifies the destination; there are no separate scope, palette, inheritance, reset or undo menus. External settings and editor-appearance changes synchronize presets without discarding an unsaved Custom draft. The panel is reused while open and releases listeners on close. Local resource roots and a nonce-based content security policy restrict its assets. Markup is isolated in `color-settings-view.js`; the host shares one write/error queue for preset changes and custom saves.

### Consolidated storage and migration

`customTheme` defaults to `{}`. Its `colors` member stores the nine modern category values. Its optional `legacy` member stores migrated `skin`, `darkColors`, `lightColors`, `customColors` and `commentRules` values. The compatibility data preserves older behavior without recreating old settings in the UI.

Activation migrates configured User, Workspace and open Folder scopes independently. Each old `colors.<category>` value becomes the corresponding member of `customTheme.colors`; the five older compatibility settings move into `customTheme.legacy`. Existing destination members win conflicts. The replacement is saved before old keys are removed. A migration must preserve explicit empty values and scope inheritance, report failures, leave source data recoverable on a failed replacement save, and avoid changing Theme or editing other workspaces.

Activation awaits `migrateSettings` from `lib/settings-migration.js` before starting controllers. Workspace-folder changes queue another migration so folders added later retain their old settings too; public refresh/idle operations await that queue. Folder values are read from JSONC explicitly because the removed setting keys no longer carry registered resource-scope metadata. `jsonc-parser` accepts comments, trailing commas and a BOM; invalid input prevents that scope from being rewritten. The editor configuration API performs saves and cleanup. `getSettings` in `lib/settings.js` maps the previous internal paths onto the new scoped object, fetching current configuration snapshots and falling back to raw legacy data after migration errors.

A modern explicit preset uses its complete palette regardless of saved custom data. Explicit Custom uses the custom category values. With no modern Theme selection, the compatibility resolver retains the earlier skin and dark/light override behavior. An absent legacy category inherits its skin; an explicitly saved empty category requests native editor syntax colors. Legacy `custom` category references resolve their migrated custom-color data. The optional modern TYPO3 Version setting takes precedence over a migrated Comment Rules value.

The extension never writes `editor.tokenColorCustomizations`, `workbench.colorCustomizations` or the user's editor theme selection.

Category metadata, configuration-layer order and legacy storage paths are shared by the adapter, palette resolver and migration. Presets, individual category overrides and legacy palettes use the same scope-selection helper, preserving explicit empty values and partial inheritance.

## Highlighting and document lifecycle

`.typoscript` and `.tsconfig` files enter `typoscript`. The controller selects `typoscript-v11` or `typoscript-v12` for the detected target. The generic and v12+ modes share `source.typoscript`; the legacy grammar uses `source.typoscript.v11`, so different grammars do not overwrite one registered scope. TYPO3 12, 13 and 14 share modern comment rules.

The generated grammars cover assignment, multiline literal values, object paths, references/copies, value modifiers, blocks, constants, quoted imports, legacy includes, conditions and comments. Parenthesized multiline values start directly after an object path; `value = (` is a single-line assignment. Comment-looking text inside literal values remains literal. Modern empty `/**/` comments close immediately; legacy block-comment closing rules remain line based.

Foreground decorations cover ranges identified by the same modern/legacy grammars. The most specific recognized scope determines the category, preserving nested constants and imports. Token engines load only when visible TypoScript needs extension-supplied colors; native Editor-theme compatibility with no overrides avoids this work.

Token ranges are cached by document URI, version and language. Edits debounce for 75 ms, carry grammar state across lines and stop when cached suffix state converges. Async work is discarded after settings, document, language, visibility or lifetime changes. Closed documents release ranges and watchers; disposal releases timers, decorations, registries and event listeners. Per-document queues and close/open tracking distinguish controller language changes from manual pins.

## Installation context and target selection

Version detection keeps project, webroot, vendor and active-core paths together. An installed Composer or Classic core takes precedence over installed package metadata, lockfiles and requirement ranges. Core version PHP is read as text, never executed. Classic `typo3_src` symlinks and copied cores work; inactive archived cores are ignored. Configured Composer vendor/webroot paths and nested/multi-root projects retain their own installation contexts. Incomplete nested project markers stop lookup from borrowing an unrelated parent.

The source-aware version indicator identifies installed, locked, range, manual and override states. A conflict opens both installed-core and lockfile sources. The status menu leads with inspection, refresh and automatic detection; target selection remains optional. Explicit `v11`/`v12`/`v13`/`v14` overrides take precedence over manual language pins. Choosing generic TypoScript or automatic detection resumes normal selection.

Filesystem events, window focus and explicit re-detection refresh caches. A three-second read of only the active core version also catches symlink switches omitted by file watchers; there is no recursive polling. Reads use `workspace.fs` and settings are resolved against document URIs. Rejected or stale updates cannot replace a newer detection result.

## Project and site-set providers

The structural parser analyzes source without executing conditions or TYPO3. Providers expose outline, folding, relative/EXT import links, constant definitions/references/hover/completion, contextual snippets and common core/property suggestions. Advisory migration diagnostics cover recognized old syntax and version-specific core names. Opt-in formatting changes leading indentation only, preserves literal values and line endings, and leaves structurally invalid documents for repair.

Import resolution uses the detected installation, extension keys and available Composer/Classic directories. Filename wildcards are supported; broad runtime/database configuration and arbitrary directory traversal are not. Project discovery bounds manifests, constants files, imports and reference candidates; cancellation and document versions prevent obsolete diagnostics from replacing current results.

The site-set registry discovers Composer and Classic sets, resolves declared required and available optional dependencies, rejects invalid required graphs and establishes dependency load order before selecting the site's closure. Physical site containment wins over a remembered choice. Shared sets otherwise use their dependencies/defaults, and users can choose a site context per project. Unused sets and other sites do not contribute definitions.

The static YAML layer composes typed defaults, per-set values and site values with source history. `settings.yaml` replaces a provider's inline values. It supports dotted/nested maps, scalar/list values, bounded local aliases and static imports in settings files. Set configuration and definition files do not process imports. YAML providers connect dependency names and setting keys to their definitions and offer replacement edits that preserve neighboring syntax and comments. Unsaved and discarded edits invalidate cached results.

The registry bounds discovery to 300 extension roots, 500 set/site directories, 32 import levels, 500 imported settings loads and 20,000 definitions. YAML files are limited to 512 KiB and alias traversal is bounded. Environment placeholders, custom YAML tags, PHP, database templates, conditions and final runtime overrides remain unevaluated. A readonly definition affects TYPO3's backend editor; the source YAML stays editable.

## Verification

Authored JavaScript and generated grammars are checked before packaging. Unit/regression tests cover grammar engines, incremental updates, parser/provider behavior, lifecycle, schema/storage, scope inheritance, migration and packaging. Real-editor integration uses disposable profiles and temporary TYPO3 11–14 Composer/Classic projects. The rendered suite checks computed foregrounds and persisted settings, operates the actual native and visual theme controls, and confirms unrelated languages and native token-color settings remain unchanged. Tests use a fresh configuration snapshot after writes.

The refactored settings and release packaging pass all 272 unit/regression/package-content tests and real-editor integration on minimum VS Code 1.70.0, including JSONC migration, existing destination values and all configuration scopes. The VSCodium 1.143.1 screenshot suite passes 73 scenarios, including all nine README images; the compact 1024 × 800 run passes 67 scenarios. Both color runs check 480 token ranges and 6,724 character foregrounds, including the reduced native menu and visual theme editor. The README, native Settings, preset, customized palette and corrected menu captures have been visually inspected. Packaging and archive verification are recorded in the [development log](development-log.md).

The preceding direct-entry build's 250 regression/package-content tests and 69 screenshot scenarios are historical baseline results. They predate the consolidated storage and do not establish this revision's unit/package correctness.

GitHub Actions runs regression/packaging checks on Node.js 22/24/26, integration on VS Code 1.70.0 and stable, and rendered-color checks on stable. The release is packaged as `typoscript-highlighting-1.8.0.vsix`; local review builds can use `typoscript-highlighting-preview.vsix`. Building a package does not publish a release or upload to an extension registry.

Release image URLs and clickable screenshot/documentation links are pinned to `v1.8.0`. Preview URLs can use a separate screenshot-only GitHub commit before a release tag exists. Both modes avoid mutable paths under `HEAD`, while source Markdown retains relative links. All referenced images and the icon are real PNGs, checked by signature and image decoding. HTTPS sources and ordinary VSCE packaging preserve Marketplace compatibility; current extension Details removes local/data-URI image sources during sanitization.

Independent tests of the final pin load all nine inline README images on VS Code 1.70.0 and VSCodium 1.143.1. All ten screenshot/click destinations return PNG data identical to the local files. The final archive's 19 PNGs decode successfully, and its runtime files match the verified source.
