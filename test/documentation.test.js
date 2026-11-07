const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ReadmeProcessor } = require('@vscode/vsce/out/package');
const { packageOptions } = require('../scripts/package');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const screenshots = [...new Set([...readme.matchAll(/\]\((images\/[^)]+\.png)\)/g)].map((match) => match[1]))];

test('every README screenshot and linked menu capture exists as a PNG in the extension', () => {
  assert.ok(screenshots.length >= 10, 'cover inline images and the linked extension menu');
  for (const filename of screenshots) {
    const bytes = fs.readFileSync(path.join(root, filename));
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), filename);
    assert.ok(bytes.readUInt32BE(16) >= 128 && bytes.readUInt32BE(20) >= 128, filename);
  }
});

for (const preview of [false, true]) test(`VSCE ${preview ? 'preview' : 'release'} packaging pins images and clickable screenshots to the same revision`, async () => {
  const manifest = require('../package.json');
  const options = packageOptions({ preview });
  const imageBase = new URL(options.baseImagesUrl);
  const contentBase = new URL(options.baseContentUrl);
  assert.equal(imageBase.protocol, 'https:');
  assert.equal(imageBase.hostname, 'raw.githubusercontent.com');
  const revision = imageBase.pathname.split('/').at(-2);
  if (preview) assert.match(revision, /^[0-9a-f]{40}$/, 'the preview must not rely on a mutable HEAD or branch');
  else assert.equal(revision, `v${manifest.version}`, 'release assets must resolve against their own release tag');
  assert.equal(path.basename(options.packagePath), `${manifest.name}-${preview ? 'preview' : manifest.version}.vsix`);
  assert.ok(contentBase.pathname.endsWith(`/blob/${revision}/`));
  const processor = new ReadmeProcessor(manifest, options);
  const result = await processor.onFile({ path: 'extension/README.md', contents: Buffer.from(readme) });
  const packaged = result.contents.toString();
  for (const filename of screenshots) {
    assert.ok(packaged.includes(`](${new URL(filename, contentBase).href})`), `clickable screenshot: ${filename}`);
    if (readme.includes(`](${filename})]`)) {
      assert.ok(packaged.includes(`](${new URL(filename, imageBase).href})`), `inline image: ${filename}`);
    }
  }
  assert.ok(!packaged.includes('/raw/HEAD/'));
  assert.ok(!packaged.includes('data:image/'));
  assert.ok(packaged.includes('[Install](#installation)'), 'local anchors must remain local');
});
