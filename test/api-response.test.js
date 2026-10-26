import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const apiSource = source.slice(source.indexOf('async function api('), source.indexOf('\nfunction toast('));
function client(response) {
  return runInNewContext(`${apiSource}\napi`, { fetch: async () => response });
}

test('empty hosting errors report endpoint, status and request ID', async () => {
  const api = client({ status: 502, ok: false, headers: new Headers({ 'x-request-id': 'trace-123' }), json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } });
  await assert.rejects(api('/api/articles/example'), error => {
    assert.match(error.message, /HTTP 502/);
    assert.match(error.message, /trace-123/);
    assert.match(error.message, /\/api\/articles\/example/);
    return true;
  });
});

test('truncated successful responses also produce a useful error without a request ID', async () => {
  const api = client({ status: 200, ok: true, headers: new Headers(), json: async () => { throw new SyntaxError('Truncated'); } });
  await assert.rejects(api('/api/dashboard'), /empty or invalid response.*HTTP 200/);
});

test('valid API failures preserve the server error message', async () => {
  const api = client({ ok: false, json: async () => ({ error: 'Session expired. Sign in again.' }) });
  await assert.rejects(api('/api/dashboard'), /Session expired/);
});
