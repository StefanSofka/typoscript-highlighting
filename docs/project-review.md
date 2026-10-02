# TypoScript Extension Project Review

This document describes the extension's architecture and tracks the findings from the initial review. Version 1.0.4 repairs the identified runtime, grammar, configuration, and packaging defects and adds automated regression and editor integration tests.

The initial inspection used commit `6572d0d`, version 1.0.3, on October 2, 2026. The repository began on December 13, 2024; its January 27, 2026 update introduced version-aware comment handling. Verification records are in the [development log](development-log.md).

## Architecture

| File or directory | Responsibility |
| --- | --- |
| `package.json` | Language registration, resource-scoped settings, activation and development commands |
| `extension.js` | Editor entry point and diagnostic output channel |
| `lib/controller.js` | Document updates, manual selections, settings, watchers and lifecycle handling |
| `lib/version.js` | Composer parsing, conservative version constraints, asynchronous reads and directory cache |
| `scripts/build-grammars.js` | Shared source for the two generated TextMate grammars |
| `syntaxes/` | Generated v11 and v12+ grammar definitions |
| `language-configuration.json` | Modern comment toggling, brackets, indentation and folding |
| `language-configuration-v11.json` | Legacy editing configuration using line comments |
| `test/` | Runtime, grammar, configuration, packaging and editor integration tests |
| `scripts/run-integration.js` | Isolated editor test runner |
| `.vscode/launch.json` | Extension Development Host launch configuration |
| `.vscodeignore` | Explicit package-content allowlist |
| `.github/workflows/test.yml` | Regression checks, packaging and editor tests |
| `README.md` | User instructions and development workflow |
| `images/` and `LICENSE` | Original images and MIT license |

The extension uses CommonJS JavaScript and generated JSON grammars, with no runtime npm dependencies or compilation step. It supplies TextMate scopes; themes determine the colors. It is a syntax highlighter with basic editing support, rather than a full TypoScript parser or language server. See the [VS Code syntax highlighting guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide).

## Language registration

Files ending in `.typoscript` and `.tsconfig` enter the `typoscript` mode. The controller then selects `typoscript-v11` or `typoscript-v12` according to the document's settings and detected version.

The generic and v12 modes use the same modern grammar at `source.typoscript`. The legacy grammar uses `source.typoscript.v11`, preventing different grammar files from overwriting each other in the editor's scope registry. Both preserve shared token scope suffixes for theme compatibility.

The grammars cover assignments, multiline values, object paths with hyphens and escaped dots, copy and reference operators, value modifiers, blocks, constants, quoted imports, legacy includes, conditions and version-specific comments. Conditions protect quoted strings and nested brackets. Single-line constructs recover at line boundaries; multiline values and block comments intentionally maintain state across lines.

## Version detection and document updates

Detection starts at each document's directory and searches ancestors for the nearest TYPO3 Composer project. This supports nested projects, mixed-version workspaces and Sitepackage subdirectories. A usable installed lockfile version wins over manifest requirements. An ambiguous TYPO3 project stops the search and uses the documented fallback instead of borrowing an ancestor's version.

Common Composer constraint forms are classified only when they establish a supported comment-rule family. A supported v11-only range selects v11. A supported range entirely at v12 or newer selects modern rules. Unknown, unsupported or mixed-family ranges fall back to v12. This is deliberately a conservative classifier, not a replacement for Composer dependency resolution. See [Composer versions and constraints](https://getcomposer.org/doc/articles/versions.md).

Reads use `workspace.fs`, including remote resources, and cached directory promises avoid repeated reads. Composer creation, modification and deletion invalidate the cache and refresh open documents, including files found above the workspace root. Settings are resolved against each document URI. Unrelated language modes are left alone.

Explicit version settings override automatic detection. In automatic mode, a manually selected version mode is preserved for the open document; choosing the generic TypoScript mode resumes detection. Extension-generated close/open events are distinguished from manual language changes. Per-document update queues discard stale detection results. Closed documents and disposed controllers are not updated, and rejected language changes are reported through the output channel.

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

Regression tests use the actual TextMate/Oniguruma engines and carry parser state between lines. Runtime tests use a small editor API double, including close/open events during language switching. Integration tests run in a separate real editor process, exercising mixed projects, watchers, resource settings, manual language changes and comment toggling. Package checks reject development files and missing runtime resources.

The current feature set remains syntax highlighting and basic editing. Completion, semantic validation, formatting, snippets and an outline would be separate future work. The v12+ label identifies the modern syntax family; it is not a guarantee that every version-specific TYPO3 feature has been exhaustively validated. Marketplace and Open VSX publication are outside this repair.
