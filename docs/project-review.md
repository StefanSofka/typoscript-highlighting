# TypoScript Extension Project Review

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

The extension uses CommonJS JavaScript and generated JSON grammars, with no compilation step. It supplies TextMate scopes; themes determine the default colors. Optional category colors use `vscode-textmate` and `vscode-oniguruma` as the only runtime npm dependencies. These engines are loaded lazily when a visible document has an explicit color. It is a syntax highlighter with basic editing support, rather than a full TypoScript parser or language server. See the [VS Code syntax highlighting guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide).

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

Only the two token engines' runtime JavaScript, package manifests, Oniguruma WASM, and license/notice files are allowlisted into the VSIX. The local picker JavaScript and CSS are also packaged and verified. Packaging tests reject other dependency files and development tools.

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

The current feature set remains syntax highlighting and basic editing. Completion, semantic validation, formatting, snippets and an outline would be separate future work. The v12+ label identifies the modern syntax family shared by TYPO3 12, 13, and 14. Comment handling has been checked against the official documentation and both core tokenizers at pinned TYPO3 13.4 and 14.3 revisions; this verification covers comments and version selection rather than every version-specific TYPO3 feature. Marketplace and Open VSX publication are outside this repair.
