# TypoScript Highlighting

Welcome to the **TypoScript Highlighting** extension for Visual Studio Code! This extension provides syntax highlighting specifically designed for TypoScript files, a configuration language used in TYPO3 CMS. Enhance your coding experience with better readability and clear structure.

---

## Features

- Syntax highlighting for `.typoscript` and `.tsconfig` files.
- Clear separation of variables, paths, operators, and comments for better clarity.
- Supports additional constructs like `@import`, nested configurations, and more.
- Lightweight and fast.

---

## Installation

1. Open Visual Studio Code.
2. Navigate to the Extensions Marketplace (`Ctrl+Shift+X`).
3. Search for "TypoScript Highlighting".
4. Click **Install**.

---

## How to Use

1. Open any file with the `.typoscript` or `.tsconfig` extension.
2. Syntax highlighting will be automatically applied.
3. Enjoy a cleaner and more structured view of your TypoScript code.

---

## Screenshots

### Example of Syntax Highlighting:

```typoscript
###############
# DEVELOPMENT #
###############
[applicationContext == "Development"]
	config {
		compressCss = 0
		concatenateCss = 0
		compressJs = 0
		concatenateJs = 0
		contentObjectExceptionHandler = 0
	}
[end]

@import 'EXT:package/Configuration/TypoScript/setup.typoscript'
```

---

## Contributing

We welcome contributions to improve this extension! To contribute:

1. Fork the repository on GitHub.
2. Clone the forked repository.
3. Make your changes and create a pull request.

---

## Feedback and Support

If you encounter any issues or have suggestions for improvements, please create an issue on [GitHub](https://github.com/StefanSofka/typoscript-highlighting.git).

---

## License

This project is licensed under the [MIT License](LICENSE).
