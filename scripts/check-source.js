import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Syntax checking must not import entry points: imports can start polling or write data.
const directories = process.argv.slice(2);
if (!directories.length) directories.push('src', 'scripts');
let failures = 0;
let checked = 0;
function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'data', '.git'].includes(entry.name)) checkDirectory(filename);
    } else if (entry.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
      checked += 1;
      if (result.status !== 0) {
        failures += 1;
        process.stderr.write(
          result.stderr || result.error?.message || `Could not check ${filename}\n`,
        );
      }
    }
  }
}
for (const directory of directories) checkDirectory(resolve(directory));
console.log(`Syntax checked ${checked} JavaScript files; ${failures} failures.`);
process.exitCode = failures ? 1 : 0;
