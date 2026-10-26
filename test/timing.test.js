import test from 'node:test';
import assert from 'node:assert/strict';
import { timedOperation } from '../src/timing.js';

test('timing logs completion and preserves operation results', async () => {
  const logs = [];
  assert.equal(await timedOperation(line => logs.push(line), 'research', async () => 42), 42);
  assert.equal(logs[0], 'research started');
  assert.match(logs[1], /^research finished elapsedMs=\d+$/);
});

test('timing logs failures without leaking error details or swallowing them', async () => {
  const logs = [], error = new Error('private provider data');
  await assert.rejects(timedOperation(line => logs.push(line), 'research', async () => { throw error; }), value => value === error);
  assert.match(logs[1], /^research failed elapsedMs=\d+$/);
  assert.ok(!logs.join(' ').includes('private provider data'));
});
