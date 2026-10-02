const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'typoscript-integration-'));
  try {
    await Promise.all(['old', 'new'].map((name) => fs.mkdir(path.join(temporary, name))));
    const workspace = path.join(temporary, 'test.code-workspace');
    await fs.writeFile(workspace, JSON.stringify({ folders: [{ path: 'old' }, { path: 'new' }] }));
    await runTests({
      extensionDevelopmentPath: process.env.TYPOSCRIPT_EXTENSION_PATH || path.resolve(__dirname, '..'),
      extensionTestsPath: path.resolve(__dirname, '..', 'test', 'integration', 'index.js'),
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH || undefined,
      launchArgs: [
        workspace,
        '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
        '--user-data-dir', path.join(temporary, 'profile'),
        '--extensions-dir', path.join(temporary, 'extensions'),
        ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
      ],
      extensionTestsEnv: { TYPOSCRIPT_TEST_DIRECTORY: temporary }
    });
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
