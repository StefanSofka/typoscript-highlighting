# Architecture

[README](../README.md) · [Development](development.md) · [Security](../SECURITY.md)

This is the current design reference. User-facing behavior is documented in the [user guide](user-guide.md); release-specific evidence belongs in the [development log](development-log.md).

## Modules

| Boundary | Modules and responsibility |
| --- | --- |
| Activation | `extension.js` creates the output channel, awaits settings migration and owns subscriptions. |
| Installation | `version.js` discovers Composer/Classic context; `controller.js` serializes detection and language changes; `editor.js` exposes status and commands. |
| Syntax | `language.js` owns language IDs; `parser.js` builds structural nodes; `tokenizer.js` maps grammar scopes to color ranges. |
| Project sources | `project.js` discovers extension roots and imports; `paths.js` shares URI containment and literal filename wildcard matching. |
| Site configuration | `site-sets.js` discovers providers, orders dependencies and composes settings; `site-settings.js` parses YAML and validates types. |
| Providers | `features.js` implements TypoScript services; `site-set-features.js` handles YAML services; `site-context.js` exposes context selection. |
| Color resolution | `settings.js` owns category/scope metadata and the storage adapter; `palette.js` resolves precedence; `skins.js` defines presets. |
| Theme editor | `color-settings.js` owns destination, validation and writes; `color-settings-view.js` supplies HTML/CSP; `media/` owns the draft and preview. |
| Decorations | `colors.js` owns visible-editor jobs, token caches and decoration lifetimes. |
| Build | `scripts/build-grammars.js` generates grammars; `scripts/package.js` builds a VSIX; `.vscodeignore` is the package allowlist. |

All runtime modules are CommonJS JavaScript. The four direct runtime dependencies are TextMate, Oniguruma/WASM, YAML and JSONC parsers. Their required distributions and licenses are packaged; development dependencies are excluded.

## Settings and migration

The public configuration surface is defined in `package.json` and documented in the [settings reference](../README.md#settings-reference). `customTheme` is a resource-scoped object with default `{}`:

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

The example illustrates storage, not a complete saved palette. The visual editor validates and saves all nine categories together. Optional `legacy` data preserves `skin`, `darkColors`, `lightColors`, `customColors` and `commentRules` compatibility.

`getSettings` reads fresh configuration snapshots, maps former internal paths to grouped data, and falls back to unmigrated legacy values. Category metadata, layer order and migration destinations have one source in `settings.js`.

Migration runs before controllers initialize and again for added folders. Each scope is independent. Existing destination members win; save the complete replacement before deleting any old key. A failed write retains the source. JSONC folder reads accept comments, trailing commas and a BOM, but malformed or non-object settings prevent migration of that scope.

### Theme editor invariants

The host captures the destination from the active resource. Explicit project theme data takes precedence over the default User destination. Reopening an existing panel reveals it rather than creating a second session.

The frontend holds Custom drafts separately from displayed presets. Preset selection writes only Theme; Custom Save first updates the complete palette atomically, preserving compatibility data, then selects Custom. Both actions share one serialized host queue. Responses include request IDs; controls are disabled while pending. The host validates messages independently of frontend validation.

The nested Custom Theme schema uses `["object"]` for compact JSON access on minimum and current editors. The stable `configureColors` command opens the visual editor from the Command Palette and extension menu. `editCustomTheme` is an internal compatibility alias.

## Document and asynchronous state

Generic `typoscript` documents switch to `typoscript-v11` or `typoscript-v12`. The generic/v12 modes share the modern grammar; v11 has a separate scope. The controller distinguishes its own language switches from manual pins, remembers automatic/manual choices, and checks job identity before applying asynchronous results.

Detection keeps project, webroot, vendor and core roots together. Source priority is implemented in `version.js`; version PHP is lexed as text. Filesystem events, focus, re-detection and a bounded core-file check invalidate cached results. Detection probes conventional paths at each ancestor rather than recursively searching parent trees.

Decoration caches use URI, document version and language. Text edits invalidate pending work before the 75 ms debounce. Incremental tokenization reuses a prefix and stops when the suffix's grammar state converges. Jobs check document, editor, language, visibility and lifetime after engine loading.

Project source caches are invalidated by edits and filesystem events. Cancellation never caches a partial result as a complete shared result. Diagnostics also check job identity and document version before publication. Disposal releases timers, watchers, listeners, decoration types and tokenizer registries.

## Static configuration

The structural parser records values without evaluating them. Completion, navigation and migration hints use those nodes; formatting changes indentation only when the document is structurally complete.

The set registry validates required dependencies, adds optional edges without introducing cycles, orders the full registry, then selects the relevant site's closure. Physical site containment wins over saved context. A shared set without a selected site uses its own dependencies/defaults.

Each set supplies typed defaults followed by its values, then the site supplies its values. A provider's `settings.yaml` replaces inline values. Source history and selected static values are retained separately. YAML parsing limits aliases and recursion, rejects malformed documents and avoids constructing user-controlled regular expressions for filename globs.

Operational bounds and static-analysis limits are listed once in the [user guide](user-guide.md#analysis-limits). Filesystem and webview boundaries are described in the [security policy](../SECURITY.md#security-model).

## Verification and packaging

See [Development](development.md#verification) for commands and the CI matrix. Unit tests cover behavior and failure cases; real-editor tests verify provider results, configuration persistence, actual menu entry points and rendered colors in disposable profiles.

Release README images and document links are pinned to `v<manifest version>`. Preview mode uses an immutable screenshot commit. Source Markdown keeps relative links. The package allowlist, image formats and Markdown rewriting are tested. Historical test totals are retained in the development log rather than used as current pass criteria.
