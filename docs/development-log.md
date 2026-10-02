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

## Recording future work

Add a dated entry with the starting revision, concrete task, decisions, changed behavior, checks and remaining issues. Refer to the finding IDs where useful. Update the project review when architecture or supported behavior changes, and distinguish proposed changes from implemented and verified results.
