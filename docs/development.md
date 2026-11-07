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
| `npm test` | Run version, lifecycle, incremental tokenization, structure, project imports, site-set graph, typed settings, theme storage/migration, palette, manifest and package regression tests. |
| `npm run test:integration` | Launch a separate editor and test the extension in temporary TYPO3 projects. |
| `npm run test:colors` | Verify rendered syntax colors and operate the visual Theme Settings page in an isolated editor. |
| `npm run test:readme` | Verify all README images in extension Details using an extracted release or preview VSIX. |
| `npm run build:grammars` | Regenerate both TextMate grammars. |
| `npm run package` | Run checks and regression tests, then build the versioned VSIX with links pinned to its release tag. |
| `npm run package:preview` | Run the same checks and build a local preview with pinned README screenshot URLs. |

## Editor integration tests

The integration runner creates temporary TYPO3 11, 12, 13 and 14 Composer projects and an isolated editor profile. It tests project detection, Composer watcher updates, folder settings, manual language selection, comment toggling, color settings/reset, the direct Theme Settings command, its compatibility alias and explicit version settings. Additional fixtures exercise real Classic symlinks, automatic target switches, manifest-free EXT imports, configured Composer paths, core/lock conflicts, enclosing installation selection, YAML definitions/hover/completion and unsaved YAML edits. A completion record written by the extension host prevents a CLI wrapper from producing a false successful run.

`typoscriptHighlighting.configureColors` is the primary **TypoScript Highlighting: Theme Settings** command and opens the visual page directly. Its `extension/context` contribution is limited to this installed extension and placed in `2_configure@0`, before the built-in Settings item. The menu supplies an extension ID to the command handler; it must not be treated as a color category. `typoscriptHighlighting.editCustomTheme` remains an internal alias for older category links and is hidden from the Command Palette.

The normal `@ext:stefan-sofka.typoscript-highlighting` Settings page contains five registered settings: Theme, Custom Theme, Diagnostics, Formatting and TYPO3 Version. Theme remains an enum; Custom Theme is a nested data object with an **Open Theme Settings** link and JSON access. Nine individual hex settings and the older skin, palette and Comment Rules controls are no longer contributed. The built-in Settings renderer and menu item are not overridden.

Custom Theme uses the JSON Schema type array `["object"]` so both current editors and the declared minimum editor present compact **Edit in settings.json** access. Its member schema still validates the stored data. TYPO3 Version is an ordinary visible optional setting; it is no longer tagged as an advanced setting.

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

The color suite reads computed foreground RGB values through a localhost debug connection and checks persisted theme settings. It opens the visual Theme Settings page and verifies its five preset choices, always-visible preset color fields, one-color customization, draft retention across preset changes, validation and explicit saving. Native Settings checks cover the reduced page, Theme selection and the link to the visual editor; color editing takes place in that editor. Storage and migration checks exercise JSON values through the editor API rather than looking for the removed native hex fields.

The suite also covers fresh-install automatic colors, all five themes, live Light/Dark changes, custom-theme persistence, all nine categories, literal comment markers, nested constants, CRLF TSconfig, settings precedence, grammar changes, document edits, legacy colors, hex and color-input editing and theme resets. Legacy theme baseline checks retain the native Editor theme compatibility value; modern Theme choices additionally verify that presets ignore stored custom colors and Custom restores them. Reset checks compare non-whitespace characters with that baseline. The suite also verifies that native token-color settings and unrelated languages remain unchanged.

Reports default to `.vscode-test/color-results.json`. Failed runs attempt to save a screenshot beside the report.

| Environment variable | Purpose |
| --- | --- |
| `VSCODE_EXECUTABLE_PATH` | Select an installed editor executable. |
| `VSCODE_VERSION` | Download a particular VS Code build, such as `1.70.0`, when no executable is supplied. |
| `TYPOSCRIPT_COLOR_REPORT` | Choose the rendered-color JSON report path. |
| `TYPOSCRIPT_EXTENSION_PATH` | Load an extracted VSIX's extension directory to test packaged runtime files. |
| `TYPOSCRIPT_VERIFY_PREVIEW_README` | With an extracted release or preview VSIX, check that all pinned HTTPS screenshots decode in extension Details. |
| `TYPOSCRIPT_SCREENSHOT_DIR` | Capture the visual Theme Settings page, reduced native Settings page, extension menu, project outline, Classic/Composer detection, YAML navigation, site-set load order and typed settings screenshots during the color suite. |
| `TYPOSCRIPT_TEST_VIEWPORT` | Set a compact color-test viewport such as `1024x800`; screenshot mode uses its fixed larger viewport. |

To verify the declared minimum and regenerate documentation screenshots:

```bash
VSCODE_VERSION=1.70.0 npm run test:integration
VSCODE_EXECUTABLE_PATH=/opt/vscodium-bin/codium TYPOSCRIPT_SCREENSHOT_DIR=images/screenshots npm run test:colors
```

Screenshot runs use a fixed 1600 × 1100 viewport. Theme Settings and native Settings captures use an isolated editor profile; they do not alter personal editor settings. The color runner makes this extension available in that disposable profile's installed list so the real extension Manage menu can be exercised. Inspect the PNGs before committing documentation changes.

For previous editor versions, scenario counts and audit results, see the [release verification log](development-log.md#version-130-release-color-audit-on-october-2-2026).

## Theme storage and compatibility migration

`typoscriptHighlighting.customTheme` is a registered, resource-scoped object with an empty-object default. It stores custom category colors together, rather than contributing each color as a separate setting:

```json
{
  "typoscriptHighlighting.theme": "custom",
  "typoscriptHighlighting.customTheme": {
    "colors": {
      "comments": "#7FB069",
      "objectPaths": "#88C0D0"
    }
  }
}
```

This example shows the storage shape. The visual editor validates and saves all nine color categories together. The keys are `comments`, `objectPaths`, `values`, `operators`, `constants`, `conditions`, `imports`, `functions` and `punctuation`. Preset selection changes only `theme`; it does not overwrite the custom data. Saving a Custom draft performs two settings writes: one atomic object update for the entire palette, preserving other Custom Theme data, followed by `theme: "custom"`.

The same object may contain `legacy` data migrated from earlier versions: `skin`, `darkColors`, `lightColors`, `customColors` and `commentRules`. These are compatibility records, not additional user-interface choices. The resolver preserves old skin, palette, explicit-empty and version-override behavior until the user makes a modern Theme or TYPO3 Version choice.

On activation, migration examines configured User, Workspace and open Folder scopes. Adding a workspace folder queues the same migration for newly available settings; refresh and idle checks await that queue. Nine old `colors.*` entries move into `customTheme.colors`; the five older compatibility settings move into `customTheme.legacy`. Merge each scope independently and preserve existing destination members. Save the replacement successfully before removing the old keys. A failed write must leave the original settings available and report the error. Migration must not select a Theme, flatten inherited scope values or open and rewrite other workspaces.

`lib/settings.js` supplies the `getSettings` adapter used by the runtime and the shared category metadata, scope order and legacy-path mapping. It maps the former internal setting paths onto the consolidated object and retains raw legacy values as a fallback if migration could not complete. `lib/settings-migration.js` uses the same mapping; activation awaits its `migrateSettings` function before creating the controllers. Folder migration reads `.vscode/settings.json` with `jsonc-parser` because the removed configuration keys no longer have registered resource-scope metadata. The parser accepts JSON comments, trailing commas and a UTF-8 BOM, and rejects malformed input before saving. Writes still use the editor configuration API.

`lib/palette.js` resolves presets, custom drafts and legacy palettes through one scope lookup. `lib/color-settings-view.js` contains the webview HTML/CSP; `lib/color-settings.js` owns commands, destination selection, message validation and one shared save queue. Destination selection includes migrated Dark/Light/custom project palettes as well as modern theme data.

Keep regression coverage for the five-entry manifest, the new object schema and category validation, migration conflicts and failures, scope preservation, explicit empty values, old version overrides and visual-editor saves. Real-editor tests must read configuration afresh after writes; a `WorkspaceConfiguration` object is a snapshot.

## Edit grammars and debug

Both grammar JSON files are generated from `scripts/build-grammars.js`. Edit that source and run `npm run build:grammars`. The `check` command detects outdated generated files.

Press **F5** with the included **Run TypoScript Extension** launch configuration to inspect the extension manually. Use **Developer: Inspect Editor Tokens and Scopes** to inspect highlighting, and the **TypoScript Highlighting** output channel to check update errors.

When reinstalling a local preview VSIX with an unchanged version, run **Developer: Reload Window** and reopen **Theme Settings** so retained webviews and the extension host load the new files.

## Build and inspect a VSIX

```bash
npm run package
npx --no-install vsce ls --tree
```

The current source builds **typoscript-highlighting-1.8.0.vsix**, including the simplified Theme Settings editor, consolidated storage and automatic settings migration. Install the resulting file with **Extensions: Install from VSIX…**, or run one of:

```bash
codium --install-extension typoscript-highlighting-1.8.0.vsix
code --install-extension typoscript-highlighting-1.8.0.vsix
```

GitHub release downloads and extension registries are published separately; their available version can differ from the source version.

`scripts/package.js` pins release README images to `raw.githubusercontent.com` at `v<package version>` and clickable screenshot/documentation links to the same tag on GitHub. Push the verified source and tag before distributing the release. Source Markdown stays relative for GitHub and local preview. New screenshot files must be committed with the release; package URLs must not use a mutable `HEAD`.

To review a future change before its release tag exists, build a clearly named local preview:

```bash
npm run package:preview
```

Preview mode pins image and content links to a separately published screenshot-only commit. Update its `SCREENSHOT_REVISION` when preview screenshots change. Inspect the native Settings, preset, customized-theme and menu captures together with the VSIX before releasing. Current extension Details sanitizes local and data-URI image sources, so embedding images in the README cannot make that view work offline.

To verify an extracted package's actual Details rendering alongside theme interaction, set `TYPOSCRIPT_EXTENSION_PATH` to its `extension` directory and `TYPOSCRIPT_VERIFY_PREVIEW_README=1` when running `npm run test:colors`. Screenshot mode also captures `readme-preview.png`. The test checks every inline screenshot's pinned HTTPS source and decoded dimensions; documentation regression checks cover all ten local image files and both release/preview image and click destinations.

For an independent README check, run `npm run test:readme` with the same extracted `TYPOSCRIPT_EXTENSION_PATH`. It also supports `VSCODE_VERSION=1.70.0`, an installed editor path, screenshot capture and a separate report through `TYPOSCRIPT_COLOR_REPORT`.

The package includes runtime modules, visual theme-editor assets, language configurations, grammars, images and documentation. The runtime token engines include Oniguruma's WASM binary and license notices. The Node distribution and ISC license of the static YAML parser are included too. `jsonc-parser` 3.3.1 is a direct runtime dependency for legacy settings migration; its UMD JavaScript, manifest and MIT license are allowlisted into the package. `.vscodeignore` excludes development tools and tests. Building a VSIX does not publish it to an extension registry.

The manifest test checks the icon's PNG signature, image header and minimum dimensions; a `.png` filename alone does not establish the image format. When replacing an icon, also decode the image from the final VSIX to verify the packaged asset.

Use real PNGs for the icon and documentation screenshots. README image URLs must resolve over HTTPS, and user-provided SVGs are restricted by the [Marketplace publishing rules](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publishing-extensions). Both package modes use ordinary PNG URLs and standard VSCE validation.

GitHub Actions runs regression checks and packaging on Node.js 22, 24 and 26, integration on VS Code 1.70.0 and stable, and rendered-color checks on stable. The color job uploads its JSON report and any failure screenshot.

See the [project review](project-review.md) for architecture and resolved findings, and the [development log](development-log.md) for investigation records.
