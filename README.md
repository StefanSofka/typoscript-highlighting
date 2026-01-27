# TypoScript Highlighting

Welcome to the **TypoScript Highlighting** extension for Visual Studio Code! This extension provides syntax highlighting specifically designed for TypoScript files, a configuration language used in TYPO3 CMS. Enhance your coding experience with better readability and clear structure.

## Table of Contents
- [Features](#features)
- [Installation](#installation)
  - [Manual Installation](#manual-installation)
- [How to Use](#how-to-use)
- [TYPO3 Version Detection (Comments)](#typo3-version-detection-comments)
- [Screenshots](#screenshots)
- [Contributing](#contributing)
- [Feedback and Support](#feedback-and-support)
- [License](#license)

---

## Features
- **Syntax highlighting** for `.typoscript` and `.tsconfig`
- **Clear separation** of variables, paths, operators, and comments
- **Support** for additional constructs like `@import` and nested configurations
- **Lightweight and fast** with no unnecessary overhead

---

## Installation

1. Open Visual Studio Code.
2. Navigate to the Extensions Marketplace (`Ctrl+Shift+X`).
3. Search for "**TypoScript Highlighting**".
4. Click **Install**.

### Manual Installation

#### 1. Build VS Code package `.vsix` file
```bash
npx @vscode/vsce package
```

#### 2. Install created `.vsix` file
```bash
vscodium --install-extension typoscript-highlighting-*.vsix
```

---

## How to Use

1. Open any file with the `.typoscript` or `.tsconfig` extension.
2. Syntax highlighting will be automatically applied.
3. Enjoy a cleaner and more structured view of your TypoScript code.

---

## TYPO3 Version Detection (Comments)

The extension can switch TypoScript comment rules based on the detected TYPO3 version.

- `auto` (default): Detects the version from `composer.lock` (preferred) or `composer.json`.
- `v11`: Forces TYPO3 v11.x comment rules.
- `v12`: Forces TYPO3 v12+ comment rules (covers 12, 13, 14).

Setting key: `typoscriptHighlighting.commentRules`

Example:
```json
{
  "typoscriptHighlighting.commentRules": "auto"
}
```

Detection details:
- `composer.lock` is used when present because it reflects the resolved TYPO3 version.
- `composer.json` is used as a fallback when no lockfile exists.

---

## Screenshots

### Example of Syntax Highlighting:
<img src="images/example.png" alt="Preview of TypoScript Syntax Highlighting" width="450px" />

---

## Contributing

We welcome contributions to improve this extension! To contribute:

1. *Fork* the repository on GitHub.
2. *Clone* the forked repository.
3. Make your changes and create a *pull request*.

---

## Feedback and Support

If you encounter any issues or have suggestions for improvements, please create an issue on [GitHub](https://github.com/StefanSofka/typoscript-highlighting.git).

---

## License

This project is licensed under the [MIT License](LICENSE).
