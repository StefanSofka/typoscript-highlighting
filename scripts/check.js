const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) check(filename);
    else if (entry.name.endsWith('.js')) execFileSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
  }
}
execFileSync(process.execPath, ['--check', 'extension.js'], { stdio: 'inherit' });
for (const directory of ['lib', 'media', 'scripts', 'test']) check(directory);
execFileSync(process.execPath, ['scripts/build-grammars.js', '--check'], { stdio: 'inherit' });
console.log('JavaScript syntax and generated grammars verified.');
