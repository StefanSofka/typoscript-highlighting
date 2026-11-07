const path = require('node:path');
const { parseArgs } = require('node:util');
const manifest = require('../package.json');

// Preview assets remain available before a new release tag has been pushed.
const SCREENSHOT_REVISION = '62cf62942f07d01adf5fd71cb4073a0c143322f8';
const REPOSITORY = manifest.repository.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

function packageOptions({ preview = false, out } = {}) {
  const root = path.resolve(__dirname, '..');
  const revision = preview ? SCREENSHOT_REVISION : `v${manifest.version}`;
  const filename = `${manifest.name}-${preview ? 'preview' : manifest.version}.vsix`;
  return { cwd: root, packagePath: out ? path.resolve(out) : path.join(root, filename),
    baseImagesUrl: `https://raw.githubusercontent.com/${REPOSITORY}/${revision}/`,
    baseContentUrl: `https://github.com/${REPOSITORY}/blob/${revision}/` };
}

if (require.main === module) {
  const { values } = parseArgs({ options: { preview: { type: 'boolean' }, out: { type: 'string' } } });
  require('@vscode/vsce').createVSIX(packageOptions(values)).catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { packageOptions };
