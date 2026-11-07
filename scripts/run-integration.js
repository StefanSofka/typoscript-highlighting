const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const net = require('node:net');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const renderedColors = process.argv.includes('--colors');
  const readmeOnly = process.argv.includes('--readme');
  const rendered = renderedColors || readmeOnly;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'typoscript-integration-'));
  try {
    const projects = ['v11', 'v12', 'v13', 'v14'];
    await Promise.all(projects.map((name) => fs.mkdir(path.join(temporary, name))));
    const workspace = path.join(temporary, 'test.code-workspace');
    await require('../test/integration/settings-fixture').prepare(temporary, workspace, projects);
    const extensionPath = path.resolve(process.env.TYPOSCRIPT_EXTENSION_PATH || path.join(__dirname, '..'));
    if (rendered) {
      // Development extensions are absent from the workbench's installed list.
      // Add this extension only to the disposable profile to test its Manage menu.
      const manifest = JSON.parse(await fs.readFile(path.join(extensionPath, 'package.json'), 'utf8'));
      const extensionDirectory = path.join(temporary, 'extensions');
      await fs.mkdir(extensionDirectory);
      await fs.symlink(extensionPath, path.join(extensionDirectory, `${manifest.publisher}.${manifest.name}-${manifest.version}`), process.platform === 'win32' ? 'junction' : 'dir');
    }
    let port;
    if (rendered) {
      const server = net.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
      await new Promise((resolve) => server.close(resolve));
    }
    const editor = runTests({
      extensionDevelopmentPath: extensionPath,
      extensionTestsPath: path.resolve(__dirname, '..', 'test', 'integration', readmeOnly ? 'readme.js' : renderedColors ? 'colors.js' : 'index.js'),
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
      version: process.env.VSCODE_VERSION || undefined,
      launchArgs: [
        workspace,
        ...(rendered ? [`--remote-debugging-port=${port}`] : []),
        '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        '--user-data-dir', path.join(temporary, 'profile'),
        '--extensions-dir', path.join(temporary, 'extensions'),
        ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
      ],
      extensionTestsEnv: { TYPOSCRIPT_TEST_DIRECTORY: temporary }
    });
    if (rendered) {
      const { runColorProbe } = require('./color-probe');
      const reportFile = process.env.TYPOSCRIPT_COLOR_REPORT || path.resolve(__dirname, '..', '.vscode-test', readmeOnly ? 'readme-results.json' : 'color-results.json');
      const results = await Promise.allSettled([editor, runColorProbe(temporary, port, reportFile)]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    } else {
      await editor;
      const result = JSON.parse(await fs.readFile(path.join(temporary, 'integration-result.json'), 'utf8'));
      if (!result.passed) throw new Error('The extension host did not complete the integration suite. Use the editor binary rather than a CLI wrapper.');
      console.log(`Verified extension-host completion in editor ${result.editorVersion}.`);
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
