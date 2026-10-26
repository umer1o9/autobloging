import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = new URL('../scripts/worker-once.js', import.meta.url);
function invoke(path) {
  // No database or provider credentials: these tests cannot run paid jobs.
  return spawnSync(process.execPath, [path], { env: {}, encoding: 'utf8', timeout: 10000 });
}
function assertMarkers(result) {
  assert.equal(result.status, 1);
  assert.ok(result.stdout.startsWith('[worker] started\n'));
  assert.ok(result.stdout.endsWith('[worker] finished\n'));
  assert.match(result.stdout, /exitCode=1/);
}

test('cron prints both markers and a useful error when environment is missing', () => {
  const result = invoke(fileURLToPath(script));
  assertMarkers(result);
  assert.match(result.stdout, /DATABASE_URL_MISSING/);
});

test('cron prints both markers even when deployment dependencies cannot load', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'autoblog-worker-cli-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'worker.mjs');
  await writeFile(path, await readFile(script));
  const result = invoke(path);
  assertMarkers(result);
  assert.match(result.stdout, /failed during loading dependencies \(ERR_MODULE_NOT_FOUND\)/);
});
