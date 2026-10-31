import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('source check finds nested syntax errors without running application code', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'iksha-source-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'nested'));
  writeFileSync(join(directory, 'nested', 'valid.js'), 'throw new Error("must not run");');
  const check = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./check-source.js', import.meta.url)), directory],
      { encoding: 'utf8' },
    );
  assert.equal(check().status, 0);
  writeFileSync(join(directory, 'nested', 'invalid.js'), 'const = ;');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SyntaxError/);
});
