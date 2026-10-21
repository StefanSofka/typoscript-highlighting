# TypoScript Extension Project Review

## Version 1.6.0: site sets and typed settings

`lib/site-sets.js` builds a registry from available extension directories and detected Composer/Classic site roots. It resolves dependencies by declared set name, rejects duplicate/invalid required graphs, tolerates absent optional dependencies and orders the full registry before selecting a site's dependency closure. Its ordering follows TYPO3's dependency service, including deterministic optional-cycle handling. Selected sets and local site files contribute implicit TypoScript/TSconfig sources without mixing the two language contexts.

`lib/site-settings.js` parses typed defaults, scalar/list values, enum metadata, readonly flags and source locations. Bounded local aliases and static YAML imports are supported; definition files and set configurations reject imports. Each provider applies defaults and then its own values in set load order, with site values last. A separate `settings.yaml` replaces inline settings. Invalid typed values receive warnings and fall back to a preceding valid candidate; enum warnings remain advisory. The hover describes static source selection, without executing TYPO3 or resolving environment placeholders and database overrides.

`lib/site-set-features.js` supplies YAML dependency/setting definition, reference, link, hover and completion providers. Replacement ranges include existing name/value suffixes; name completion preserves neighboring syntax and values, and value completion preserves trailing comments. `lib/site-context.js` exposes automatic or persisted per-project site context and a load-order inspector. Physical site containment takes precedence over a saved selection; shared sets otherwise retain their own defaults and dependencies.

The existing project watcher invalidates YAML changes and discarded edits. Additional bounded watchers cover discovered extension/site roots and imported resources outside the workspace, including symlinked Classic extensions. Registry discovery batches at most 16 reads, visits at most 300 extension roots and 500 set/site directories, limits import depth to 32 and imported settings loads to 500, and retains at most 20,000 source definitions. Each YAML file is limited to 512 KiB and alias traversal is bounded. Cancellation and diagnostic generations prevent stale requests from replacing current results.

The architecture was checked against the [TYPO3 site-set documentation](https://docs.typo3.org/m/typo3/reference-coreapi/13.4/en-us/ApiOverview/SiteHandling/SiteSets.html), [setting definitions](https://docs.typo3.org/m/typo3/reference-coreapi/13.4/en-us/ApiOverview/SiteHandling/SiteSettingDefinitions.html), and the core's [SetRegistry](https://github.com/TYPO3/typo3/blob/13.4/typo3/sysext/core/Classes/Site/Set/SetRegistry.php), [DependencyOrderingService](https://github.com/TYPO3/typo3/blob/13.4/typo3/sysext/core/Classes/Service/DependencyOrderingService.php) and [SiteSettingsFactory](https://github.com/TYPO3/typo3/blob/13.4/typo3/sysext/core/Classes/Site/SiteSettingsFactory.php). The earlier release sections below describe their original scope.

## Version 1.5.0: automatic installation context

`lib/version.js` discovers Composer and Classic cores, keeps project/webroot/vendor/core paths together, and prefers the installed core over installed package metadata, lockfiles and manifest ranges. Core PHP is lexed for a literal class constant without execution. Classic symlinks and copied cores work; inactive archives are ignored. Sitepackage compatibility manifests yield to enclosing installations. Root markers stop incomplete nested sites from borrowing parent versions.

The controller retains this context even when syntax is overridden, shares exact project watchers, and releases dependencies on close. A three-second check reads only the active core version per project, recovering symlink switches that VS Code's file service may omit. Window focus refreshes metadata. Source inspection and conflicts lead the status-bar command; manual version choices are an optional submenu.

`lib/project.js` uses detected paths for Composer and manifest-free Classic EXT imports. `lib/site-settings.js` uses the packaged YAML parser to inspect scalar site settings and set defaults with source ranges, including unsaved edits. Shared YAML lookups batch at most 16 operations, inspect at most 300 locations and 500 files, and retain at most 20,000 scalar definitions. Aliases, tags, imports, database configuration and runtime override order are not evaluated. `lib/catalog.js` supplies a bounded core/property completion catalogue and advisory version migration hints; unknown/custom objects remain valid.

The earlier release sections below provide historical context.

## Version 1.4.0: project editing and settings

The extension now includes a structural parser and editor providers alongside the TextMate grammars. `lib/parser.js` analyzes objects, conditions, literal values, comments, imports and constant references without evaluating TYPO3. `lib/project.js` resolves relative/EXT imports, discovers extension Composer metadata, follows import graphs with cycle protection, and searches project references. `lib/features.js` exposes outline, folding, links, completion, definitions, references, hover, diagnostics, quick fixes and opt-in indentation formatting. `lib/snippets.js` separates setup and TSconfig suggestions.

`lib/language.js` centralizes language IDs and target-version compatibility. `lib/editor.js` supplies the source-aware version indicator and an explicit command to copy generic language options into a shared override. Separate grammar IDs remain necessary for mixed legacy/modern TextMate projects; the extension does not silently rewrite user editor settings.

The controller remembers whether a document's language was automatic or manually pinned in workspace storage, including when a forced version temporarily changes the applied grammar. Directory dependencies release Composer watchers as documents close. Version results retain installed versions, Composer constraints and source URIs; ambiguous lock versions retain their actual source rather than naming an absent manifest.

Color tokenization reuses unchanged line states and stops when a changed region converges with the cached suffix. `lib/palette.js` centralizes categories, scope origins and theme palette inheritance. The picker supports explicit theme reset, removal of local overrides, bulk operations, bounded dialog undo, remembered User/Workspace/Folder destinations, optional dark/light palettes, a preview and contrast feedback. User settings are the first-use destination. Existing hex and legacy custom settings remain compatible.

Project discovery is bounded: up to 1,000 extension manifests, 200 conventional constants files, 300 imported sources and 1,000 project reference candidates per lookup. Imported vendor sources remain available; the broad reference scan excludes vendor and generated directories. Cancellation and document versions prevent obsolete diagnostics. Runtime values, database templates and site-settings YAML are not evaluated.

The sections below document the architecture and release history through 1.3.1. Current usage and configuration are in the README.

This document describes the extension's architecture and tracks the findings from the initial review. Version 1.0.4 repairs the identified runtime, grammar, configuration, and packaging defects and adds automated regression and editor integration tests.

Version 1.1.0 also fixes empty block comments (`/**/`), explicitly verifies the shared modern comment mode for TYPO3 13.4 and 14.3, and adds optional category colors with System Default as the default. The follow-up results are recorded in the [development log](development-log.md#issue-1-follow-up-on-october-2-2026).

Version 1.2.0 adds named dropdowns for all nine color categories, an optional custom-hex object, and explicit TYPO3 13/14 Comment Rules choices. The modern language mode and automatic detection remain shared.

Version 1.3.0 replaces the color dropdowns with direct hex fields and a linked spectrum view. Existing color settings and explicit TYPO3 13/14 Comment Rules remain compatible.

The initial inspection used commit `6572d0d`, version 1.0.3, on October 2, 2026. The repository began on December 13, 2024; its January 27, 2026 update introduced version-aware comment handling. Verification records are in the [development log](development-log.md).

## Architecture

| File or directory | Responsibility |
| --- | --- |
| `package.json` | Language registration, resource-scoped settings, activation and development commands |
| `extension.js` | Editor entry point and diagnostic output channel |
| `lib/controller.js` | Document updates, manual selections, settings, watchers and lifecycle handling |
| `lib/version.js` | Composer parsing, conservative version constraints, asynchronous reads and directory cache |
| `lib/project.js` | Installation-scoped imports, extension discovery and TypoScript/TSconfig source searches |
| `lib/site-sets.js` | Site-set registry, dependency load order, static settings composition and site context |
| `lib/site-settings.js` | YAML syntax, typed setting definitions, imports and value validation |
| `lib/site-set-features.js` | YAML dependency/setting navigation, hover, links and completion |
| `lib/site-context.js` | Site-context status, persisted selection and load-order inspector |
| `lib/colors.js` | Optional per-resource foreground colors, editor decorations, caching and lifecycle handling |
| `lib/color-settings.js` | Spectrum command, scoped settings, serialized writes and webview lifecycle |
| `media/` | Local spectrum picker controls, hex validation and editor-themed styles |
| `lib/tokenizer.js` | Lazy TextMate/Oniguruma initialization and grammar-based syntax categories |
| `scripts/build-grammars.js` | Shared source for the two generated TextMate grammars |
| `syntaxes/` | Generated v11 and v12+ grammar definitions |
| `language-configuration.json` | Modern comment toggling, brackets, indentation and folding |
| `language-configuration-v11.json` | Legacy editing configuration using line comments |
| `test/` | Runtime, grammar, configuration, packaging and editor integration tests |
| `scripts/run-integration.js` | Isolated editor and rendered-color test runner |
| `scripts/color-probe.js` | Foreground RGB checks and real spectrum-view interaction over a localhost debug connection |
| `.vscode/launch.json` | Extension Development Host launch configuration |
| `.vscodeignore` | Explicit package-content allowlist |
| `.github/workflows/test.yml` | Regression checks, packaging and editor tests |
| `README.md` | User instructions and development workflow |
| `images/` and `LICENSE` | Original images and MIT license |

The extension uses CommonJS JavaScript and generated JSON grammars, with no compilation step. It supplies TextMate scopes; themes determine the default colors. Optional category colors use `vscode-textmate` and `vscode-oniguruma` as runtime npm dependencies; static site-settings parsing additionally uses `yaml`. These engines are loaded lazily when a visible document has an explicit color. It is a syntax highlighter with basic editing support, rather than a full TypoScript parser or language server. See the [VS Code syntax highlighting guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide).

## Language registration

Files ending in `.typoscript` and `.tsconfig` enter the `typoscript` mode. The controller then selects `typoscript-v11` or `typoscript-v12` according to the document's settings and detected version.

The generic and v12 modes use the same modern grammar at `source.typoscript`. The legacy grammar uses `source.typoscript.v11`, preventing different grammar files from overwriting each other in the editor's scope registry. Both preserve shared token scope suffixes for theme compatibility.

The grammars cover assignments, multiline values, object paths with hyphens and escaped dots, copy and reference operators, value modifiers, blocks, constants, quoted imports, legacy includes, conditions and version-specific comments. Conditions protect quoted strings and nested brackets. Single-line constructs recover at line boundaries; multiline values and block comments intentionally maintain state across lines.

The documentation-comment opener excludes `/**/`, letting the ordinary block-comment rule recognize its complete closing delimiter. Modern mode closes this empty comment immediately. Legacy mode retains its requirement that a closing delimiter start a trimmed line. Ordinary documentation comments keep their dedicated scope, and comment markers inside assignment values remain literal.

## Version detection and document updates

Detection starts at each document's directory and searches ancestors for the nearest TYPO3 Composer project. This supports nested projects, mixed-version workspaces and Sitepackage subdirectories. A usable installed lockfile version wins over manifest requirements. An ambiguous TYPO3 project stops the search and uses the documented fallback instead of borrowing an ancestor's version.

Common Composer constraint forms are classified only when they establish a supported comment-rule family. A supported v11-only range selects v11. A supported range entirely at v12 or newer selects modern rules. Unknown, unsupported or mixed-family ranges fall back to v12. This is deliberately a conservative classifier, not a replacement for Composer dependency resolution. See [Composer versions and constraints](https://getcomposer.org/doc/articles/versions.md).

Reads use `workspace.fs`, including remote resources, and cached directory promises avoid repeated reads. Composer creation, modification and deletion invalidate the cache and refresh open documents, including files found above the workspace root. Settings are resolved against each document URI. Unrelated language modes are left alone.

Explicit `v11`, `v12`, `v13`, and `v14` settings override automatic detection. The three modern choices deliberately map to the same `typoscript-v12` language mode. In automatic mode, a manually selected version mode is preserved for the open document; choosing the generic TypoScript mode resumes detection. Extension-generated close/open events are distinguished from manual language changes. Per-document update queues discard stale detection results. Closed documents and disposed controllers are not updated, and rejected language changes are reported through the output channel.

## Optional category colors

Nine resource-scoped `typoscriptHighlighting.colors.*` settings accept direct six-digit hex colors. Every default is an empty string, meaning System Default: the active editor theme supplies the foreground without extension decorations. Each setting links to the spectrum view, also opened through the Configure Colors command. The view provides saturation/brightness and hue controls, hex input, per-category reset, and User/Workspace/Folder scope selection. Invalid input is not saved; settings writes are serialized to preserve fast changes to different categories.

The view resolves scope inheritance through configuration inspection. A System Default action writes an explicit empty value to mask inherited extension color overrides. Existing 1.2.0 `custom` selections still resolve the matching legacy custom-color object; picker edits replace them with direct hex values. Settings changes refresh both the color decorations and the open picker. The panel is created only when requested, reused while open, and releases message listeners when closed. Local resource roots and a restrictive content security policy limit its assets to the packaged picker files.

Explicit colors use foreground-only editor decorations over ranges produced by the same modern/legacy grammars that the editor uses. The most specific recognized scope determines the category, preserving distinct constants inside values and recognized imports inside v11 comments. The extension reads its own settings and never writes native theme or token-color settings.

Token ranges are cached by document URI, version, and language mode. Edits are debounced for 75 ms and carry grammar state across lines when retokenized. Async initialization results are discarded if settings, document contents, language, visibility, or controller lifetime have changed. Closed documents release cached ranges. Disposal releases event listeners, timers, decoration types, and the TextMate registry.

The token engines' runtime JavaScript, manifests, Oniguruma WASM, license/notice files and the YAML parser's Node distribution and license are allowlisted into the VSIX. The local picker JavaScript and CSS are also packaged and verified. Packaging tests reject other dependency files and development tools.

## Findings resolved in version 1.0.4

These IDs refer to defects observed in the original 1.0.3 source, not current outstanding bugs.

| ID | Original finding | Resolution and regression coverage |
| --- | --- | --- |
| B01 | Double-escaped version regex caused automatic detection to fail | Strict installed-version parsing and conservative constraint classification; version and controller tests |
| B02 | Different grammars shared the same registered root scope | Dedicated v11 scope; both language modes loaded into one TextMate registry in tests |
| B03 | Referenced language configuration was missing | Modern and legacy configurations; manifest checks and real editor comment toggling |
| B04 | Standard multiline values were not recognized; `= (` opened a multiline string | Separate multiline syntax; stateful tests protect literal comments, imports and conditions inside values |
| B05 | `=<` was split into `=` and a string beginning with `<` | Complete reference operator matched before ordinary assignment |
| B06 | Copy, modification and block syntax lacked dedicated tokens | Dedicated operator, function, path and punctuation scopes |
| B07 | Inline comments after deletion were classified as strings | Deletion tail and version-specific comments receive comment scopes |
| B08 | Hyphenated and escaped object paths were not recognized | Expanded path rules and regression examples |
| B09 | Conditions stopped at the first inner closing bracket | Quoted strings and nested brackets protect the outer condition |
| B10 | Specific end-condition rule was unreachable | Dedicated case-insensitive END, GLOBAL and ELSE rules preceding general conditions |
| B11 | Production dependency on the packager bloated the VSIX | All tools moved to development dependencies; allowlisted package content and package regression test |
| B12 | Old packaging dependencies crashed under Node.js 26 | Updated packager and dependency graph; CLI startup and complete packaging verified |
| B13 | Manifest and lockfile versions differed | Both synchronized to 1.0.4 and checked by tests |

The repair also addresses the structural issues identified during the review: per-document detection, resource settings, ancestor discovery, Composer file watching, manual mode preservation, asynchronous cached reads and rejected language changes. All repository documentation and authored code are now in English.

## Verification and future scope

Regression tests use the actual TextMate/Oniguruma engines and carry parser state between lines. Runtime tests use a small editor API double, including close/open events during language switching. Integration tests run in a separate real editor process, exercising mixed projects, watchers, resource settings, manual language changes and comment toggling. Package checks reject development files and missing runtime resources. The rendered-color suite additionally checks the visible result, compares full theme resets with baseline character colors, and validates persisted settings after picker writes. Its 37 scenarios cover 265 token ranges and 5,416 character foreground checks per run.

The integration workspace now contains TYPO3 11/12/13/14 Composer projects. TYPO3 13 and 14 are checked with both Composer file types and both recognized package names in controller tests, plus explicit `auto`, `v11`, `v13`, and `v14` settings in the editor. Composer watcher tests wait for an observed registration event before the version-changing write. This removes the startup race observed in VS Code 1.140.0 without changing runtime detection.

The release audit passes on VS Code 1.140.0 and VSCodium 1.135.06055 with bracket-pair colorization enabled, all four TYPO3 branches, LF/CRLF files, all nine categories, scope precedence, grammar changes, multiline edits, legacy/custom/shared colors, dark/light themes, spectrum/hex/keyboard input, reset and unrelated documents. The native token-color configuration is unchanged. A small picker correction keeps System Default enabled for invalid hex drafts and prevents a loading-time control from accessing an uninitialized category. The rendered suite is now part of CI, with JSON reports and failure screenshots uploaded as artifacts.

The initial audit covered syntax highlighting and basic editing. Later releases added source navigation, completion, diagnostics, optional formatting, snippets and outline providers, as described above. The v12+ label identifies the modern syntax family shared by TYPO3 12, 13, and 14. Comment handling has been checked against the official documentation and both core tokenizers at pinned TYPO3 13.4 and 14.3 revisions; this verification covers comments and version selection rather than every version-specific TYPO3 feature. Marketplace and Open VSX publication are outside this repair.
