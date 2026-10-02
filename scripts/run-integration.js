const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const net = require('node:net');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const renderedColors = process.argv.includes('--colors');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'typoscript-integration-'));
  try {
    const projects = ['v11', 'v12', 'v13', 'v14'];
    await Promise.all(projects.map((name) => fs.mkdir(path.join(temporary, name))));
    const workspace = path.join(temporary, 'test.code-workspace');
    await fs.writeFile(workspace, JSON.stringify({ folders: projects.map((name) => ({ path: name })) }));
    let port;
    if (renderedColors) {
      const server = net.createServer();
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
      await new Promise((resolve) => server.close(resolve));
    }
    const editor = runTests({
      extensionDevelopmentPath: process.env.TYPOSCRIPT_EXTENSION_PATH || path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, '..', 'test', 'integration', renderedColors ? 'colors.js' : 'index.js'),
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
      launchArgs: [
        workspace,
        ...(renderedColors ? [`--remote-debugging-port=${port}`] : []),
        '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        '--user-data-dir', path.join(temporary, 'profile'),
        '--extensions-dir', path.join(temporary, 'extensions'),
        ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
      ],
      extensionTestsEnv: { TYPOSCRIPT_TEST_DIRECTORY: temporary }
    });
    if (renderedColors) {
      const { runColorProbe } = require('./color-probe');
      const reportFile = process.env.TYPOSCRIPT_COLOR_REPORT || path.resolve(__dirname, '..', '.vscode-test', 'color-results.json');
      const results = await Promise.allSettled([editor, runColorProbe(temporary, port, reportFile)]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    } else await editor;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
