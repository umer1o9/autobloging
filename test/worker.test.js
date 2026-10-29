import test from 'node:test';
import assert from 'node:assert/strict';
import { runWorkerOnce } from '../src/worker.js';

function fixture(owner = true) {
  const calls = [];
  const store = {
    workerActive: owner,
    assertSchema: async () => calls.push('schema'),
    acquireWorker: async () => { calls.push('lock'); return owner; },
    cleanSessions: async () => calls.push('sessions'),
    queuedJobs: async limit => {
      assert.equal(limit, 1);
      calls.push('queue');
      return [{ workspace: 'workspace', value: { id: 'job-1' } }];
    },
    get: async () => ({ status: 'completed', stage: 'review' })
  };
  const domain = Object.fromEntries(['recoverInterrupted', 'syncWebsites', 'automate', 'publishDue'].map(name => [name, async () => calls.push(name)]));
  domain.runJob = async (workspace, id) => { assert.equal(workspace, 'workspace'); assert.equal(id, 'job-1'); calls.push('run'); };
  return { store, domain, calls };
}

test('cron skips all recovery and paid work when another worker owns the lock', async () => {
  const { store, domain, calls } = fixture(false);
  assert.deepEqual(await runWorkerOnce(store, domain, () => {}), { skipped: true, processed: 0 });
  assert.deepEqual(calls, ['schema', 'lock']);
});

test('cron performs a bounded pass then schedules and publishes completed work', async () => {
  const { store, domain, calls } = fixture();
  assert.deepEqual(await runWorkerOnce(store, domain, () => {}), { skipped: false, processed: 1 });
  assert.deepEqual(calls, ['schema', 'lock', 'recoverInterrupted', 'syncWebsites', 'automate', 'publishDue', 'sessions', 'queue', 'run', 'automate', 'publishDue']);
});

test('cron refuses to dispatch paid work after losing its worker connection', async () => {
  const { store, domain, calls } = fixture();
  store.queuedJobs = async () => { store.workerActive = false; return [{ workspace: 'workspace', value: { id: 'job-1' } }]; };
  await assert.rejects(runWorkerOnce(store, domain, () => {}), /lock was lost/);
  assert.ok(!calls.includes('run'));
});
