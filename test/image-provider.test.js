import test from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { createImageProvider } from '../src/image-provider.js';

const bytes = Buffer.alloc(160, 7).toString('base64');
const env = { ALLOW_PAID_GENERATION: 'true', GEMINI_API_KEY: 'gemini-test', OPENAI_API_KEY: 'openai-test', APP_ORIGIN: 'http://localhost:3210' };
const removeGenerated = async value => unlink(new URL(`../data/media/${new URL(value.url).pathname.split('/').pop()}`, import.meta.url)).catch(() => {});

test('Gemini and OpenAI image adapters preserve model choices and persist generated media', async t => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return url.includes('googleapis')
      ? Response.json({ interaction: { steps: [{ output: [{ type: 'image', mime_type: 'image/jpeg', data: bytes }] }] } })
      : Response.json({ data: [{ b64_json: bytes }], usage: { input_tokens: 10, output_tokens: 20 } });
  };
  const provider = createImageProvider(env, request);
  const gemini = await provider.generate({ provider: 'gemini', model: 'gemini-3-pro-image', prompt: 'Editorial cover', quality: 'high', aspectRatio: '16:9' });
  const openai = await provider.generate({ provider: 'openai', model: 'gpt-image-2.5-sunburst', prompt: 'Editorial illustration', quality: 'medium', aspectRatio: '3:2' });
  t.after(async () => { await removeGenerated(gemini); await removeGenerated(openai); });
  assert.match(gemini.url, /\/media\/[a-f0-9-]+\.jpg$/); assert.match(openai.url, /\/media\/[a-f0-9-]+\.webp$/);
  assert.equal(calls[0].body.model, 'gemini-3-pro-image'); assert.equal(calls[0].body.response_format.aspect_ratio, '16:9');
  assert.equal(calls[1].body.model, 'gpt-image-2.5-sunburst'); assert.equal(calls[1].body.size, '1536x1024');
});

test('image generation stays disabled until paid generation and a provider key are configured', async () => {
  const provider = createImageProvider({ GEMINI_API_KEY: 'test' }, async () => { throw new Error('must not call'); });
  assert.equal(provider.ready('gemini'), false); assert.equal(provider.ready('openai'), false);
  await assert.rejects(() => provider.generate({ provider: 'gemini', prompt: 'test' }), /not configured/);
});

test('persistent media directory survives provider recreation and rejects traversal', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'autoblog-media-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { ...env, MEDIA_DIRECTORY: directory };
  const provider = createImageProvider(settings, async () => Response.json({ data: [{ b64_json: bytes }] }));
  const image = await provider.generate({ provider: 'openai', model: 'gpt-image-1', prompt: 'Fixture' });
  const filename = new URL(image.url).pathname.split('/').pop();
  const restarted = createImageProvider(settings);
  assert.equal((await restarted.read(filename)).byteLength, 160);
  await assert.rejects(restarted.read('../.env'), /Invalid media filename/);
});
