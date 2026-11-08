const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ReadmeProcessor } = require('@vscode/vsce/out/package');
const { packageOptions } = require('../scripts/package');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const screenshots = [...new Set([...readme.matchAll(/\]\((images\/[^)]+\.png)\)/g)].map((match) => match[1]))];
const documentation = ['README.md', 'CHANGELOG.md', 'SECURITY.md', 'docs/user-guide.md', 'docs/development.md', 'docs/project-review.md'];

test('maintained documentation links resolve to repository files and real headings', () => {
  const headings = (text) => new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) => match[1].toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')));
  for (const filename of documentation) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    for (const [, link] of source.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(link)) continue;
      const [relative, fragment] = link.split('#');
      const target = path.resolve(root, path.dirname(filename), decodeURIComponent(relative || path.basename(filename)));
      assert.ok(target.startsWith(root + path.sep), `${filename}: link must stay in the repository: ${link}`);
      assert.ok(fs.statSync(target).isFile(), `${filename}: missing ${link}`);
      if (fragment && target.endsWith('.md')) assert.ok(headings(fs.readFileSync(target, 'utf8')).has(fragment), `${filename}: missing heading ${link}`);
    }
  }
});

test('README installation matches the manifest release version', () => {
  const manifest = require('../package.json');
  assert.ok(readme.includes(`${manifest.name}-${manifest.version}.vsix`));
  assert.ok(readme.includes(`/releases/tag/v${manifest.version}`));
});

test('documentation screenshots and the linked menu capture are valid PNGs', () => {
  assert.ok(screenshots.length > 0, 'the package README includes a real visual preview');
  const images = new Set();
  for (const filename of documentation) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    for (const [, image] of source.matchAll(/\]\(([^)]+\.png)\)/g)) {
      if (!/^[a-z]+:/i.test(image)) images.add(path.resolve(root, path.dirname(filename), image));
    }
  }
  for (const filename of images) {
    const bytes = fs.readFileSync(filename);
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
