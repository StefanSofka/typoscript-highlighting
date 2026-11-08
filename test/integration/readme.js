const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function run() {
  const directory = process.env.TYPOSCRIPT_TEST_DIRECTORY;
  const extension = vscode.extensions.getExtension('stefan-sofka.typoscript-highlighting');
  const readme = await fs.readFile(path.join(extension.extensionPath, 'readme.md'), 'utf8');
  const expectedImages = [...readme.matchAll(/!\[[^\]]*\]\(https:\/\/raw\.githubusercontent\.com\//g)].length;
  assert.ok(expectedImages > 0, 'set TYPOSCRIPT_EXTENSION_PATH to an extracted release or preview VSIX with pinned README images');
  const state = path.join(directory, 'color-state.json');
  const ack = path.join(directory, 'color-ack.json');
  async function stage(data) {
    await fs.writeFile(`${state}.tmp`, JSON.stringify(data));
    await fs.rename(`${state}.tmp`, state);
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      try {
        const result = JSON.parse(await fs.readFile(ack, 'utf8'));
        if (result.id === data.id) {
          assert.ok(!result.error, result.error);
          return;
        }
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`README probe timed out: ${data.name}`);
  }
  // Newer workbenches finish populating the installed-extension list after
  // starting the development host. Retry only this initial discovery race.
  const discoveryDeadline = Date.now() + 10000;
  while (true) {
    try { await vscode.commands.executeCommand('_extensions.manage', extension.id); break; }
    catch (error) {
      if (!/^Extension '.+' not found\.$/.test(error.message) || Date.now() >= discoveryDeadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await stage({ id: 1, name: 'all README screenshots load in extension Details', action: 'extension-readme',
    expectedImages, screenshot: 'readme-preview.png', editorScreenshot: true });
  await stage({ id: 2, name: 'complete', editorVersion: vscode.version, extensionVersion: extension.packageJSON.version });
  console.log(`PASS: all ${expectedImages} README screenshots loaded in editor ${vscode.version}`);
}

module.exports = { run };
