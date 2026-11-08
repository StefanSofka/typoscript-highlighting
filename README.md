# TypoScript Highlighting

TypoScript and TSconfig support for **Visual Studio Code and VSCodium**, targeting TYPO3 11–14.

- Automatic Composer and Classic installation detection, including active core symlinks.
- Syntax highlighting, outline, folding, imports, constant navigation and contextual completion.
- Site-set dependencies, typed YAML settings and static value history.
- Automatic Light/Dark colors, five presets and a visual editor for nine syntax colors.
- Diagnostics, legacy import quick fixes and optional indentation formatting.

[Install](#installation) · [Get started](#quick-start) · [User guide](docs/user-guide.md) · [Settings](#settings-reference) · [Troubleshooting](docs/user-guide.md#troubleshooting)

[![The visual Theme Settings editor in VSCodium.](images/screenshots/custom-theme.png)](images/screenshots/custom-theme.png)

## Installation

Download **typoscript-highlighting-1.8.1.vsix** from [GitHub release 1.8.1](https://github.com/StefanSofka/typoscript-highlighting/releases/tag/v1.8.1), then run **Extensions: Install from VSIX…** in the Command Palette. From a terminal:

```bash
codium --install-extension typoscript-highlighting-1.8.1.vsix
# Visual Studio Code:
code --install-extension typoscript-highlighting-1.8.1.vsix
```

Requires a VS Code-compatible editor with API version **1.70 or newer**. No separate Node.js, PHP or Composer installation is required.

The extension is also listed on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=stefan-sofka.typoscript-highlighting) and [Open VSX](https://open-vsx.org/extension/stefan-sofka/typoscript-highlighting). Registry publication is separate from GitHub releases; check the version shown by your registry.

## Quick start

1. Open your TYPO3 project or Sitepackage folder.
2. Open a `.typoscript` or `.tsconfig` file. Highlighting starts automatically.
3. Check the **TYPO3 version indicator** in the status bar. Click it to inspect the detected version and source.
4. Ctrl+click an import, use **Go to Definition**, open **Outline**, or invoke completion with **Ctrl+Space**. On macOS, use Cmd+click for links.
5. Run **TypoScript Highlighting: Theme Settings** to choose a preset or edit your colors. Editing updates the preview; **Save custom theme** applies the draft.

[![Project outline, import links and detection information.](images/screenshots/project-navigation.png)](images/screenshots/project-navigation.png)

For projects with several sites, the **Site** or **Set** status indicator selects the navigation context. The [user guide](docs/user-guide.md) explains import paths, site sets, detection overrides, themes and troubleshooting.

## Settings reference

Search Settings for `@ext:stefan-sofka.typoscript-highlighting`. All five settings support User, Workspace and Folder scopes.

| Setting | Default | Purpose |
| --- | --- | --- |
| `typoscriptHighlighting.theme` | `auto` | `auto`, `dark`, `light`, `nord`, `monokai`, `solarized` or `custom`. |
| `typoscriptHighlighting.customTheme` | `{}` | Saved custom colors and migrated compatibility data. Use **Open Theme Settings** to edit colors. |
| `typoscriptHighlighting.diagnostics.enabled` | `true` | Structural, import, migration and site-set YAML diagnostics. |
| `typoscriptHighlighting.formatting.enabled` | `false` | Conservative indentation formatting for structurally complete documents. |
| `typoscriptHighlighting.typo3Version` | `auto` | Optional `v11`, `v12`, `v13` or `v14` target override. |

Existing settings migrate at their original scopes. See [themes and migration](docs/user-guide.md#themes-and-custom-colors) for compatibility behavior.

## Scope and limitations

The extension analyzes files available to the editor. PHP, Composer, TypoScript conditions, environment placeholders and database templates are not executed. Definitions and selected YAML values describe static sources rather than TYPO3's final runtime configuration.

See the [analysis limits](docs/user-guide.md#analysis-limits) and [security policy](SECURITY.md) for details.

## Documentation and contributing

| Document | Use it for |
| --- | --- |
| [User guide](docs/user-guide.md) | Features, examples and troubleshooting |
| [Development](docs/development.md) | Setup, tests, packaging and release steps |
| [Architecture](docs/project-review.md) | Module boundaries, state and migration invariants |
| [Changelog](CHANGELOG.md) | Release changes |
| [Development log](docs/development-log.md) | Historical investigations and verification evidence |
| [Security](SECURITY.md) | Security model and private vulnerability reports |

Bug reports and contributions are welcome on [GitHub](https://github.com/StefanSofka/typoscript-highlighting/issues). Include a minimal example, editor/TYPO3 versions and relevant settings; remove credentials and private project data.

## License

[MIT](LICENSE) © Stefan Sofka.
