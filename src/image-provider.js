import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

export const IMAGE_MODELS = {
  gemini: [
    { id: 'gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite — cheapest' },
    { id: 'gemini-nano-banana-2.1', label: 'Nano Banana 2.1 — balanced' },
    { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2 — previous balanced' },
    { id: 'gemini-3-pro-image', label: 'Nano Banana Pro — premium' },
    { id: 'gemini-2.5-flash-image', label: 'Nano Banana — legacy' }
  ],
  openai: [
    { id: 'gpt-image-2.5-flare', label: 'GPT-Image 2.5 Flare — fast' },
    { id: 'gpt-image-2.5-flare-2026-09-08', label: 'GPT-Image 2.5 Flare · 2026-09-08 snapshot' },
    { id: 'gpt-image-2.5-sunburst', label: 'GPT-Image 2.5 Sunburst — premium' },
    { id: 'gpt-image-2.5-sunburst-2026-09-08', label: 'GPT-Image 2.5 Sunburst · 2026-09-08 snapshot' },
    { id: 'gpt-image-2', label: 'GPT-Image 2' },
    { id: 'gpt-image-2-2026-04-21', label: 'GPT-Image 2 · 2026-04-21 snapshot' },
    { id: 'gpt-image-1.5', label: 'GPT-Image 1.5 — retiring' },
    { id: 'gpt-image-1-mini', label: 'GPT-Image 1 Mini — retiring' },
    { id: 'gpt-image-1', label: 'GPT-Image 1 — retiring' },
    { id: 'chatgpt-image-latest', label: 'ChatGPT Image Latest — retiring' }
  ]
};

const defaultMediaDir = fileURLToPath(new URL('../data/media/', import.meta.url));
const cleanModel = value => String(value || '').trim().slice(0, 150);
const safeError = (message, details = {}) => Object.assign(new Error(message), { safe: true, ...details });
const errorDetails = async (response, provider, model) => {
  let data = {};
  try { data = JSON.parse(await response.text()); } catch { /* Provider bodies are not persisted verbatim. */ }
  const status = String(data?.error?.status || data?.error?.type || '').replace(/[^A-Z0-9_-]/gi, '').slice(0, 80);
  const message = String(data?.error?.message || 'Check model access, credentials, quota, and provider availability.').replace(/\s+/g, ' ').trim().slice(0, 700);
  return safeError(`${provider === 'gemini' ? 'Google Gemini' : 'OpenAI'} image API HTTP ${response.status}${status ? ` ${status}` : ''}: ${message}`, {
    retryable: response.status === 429 || response.status >= 500,
    providerError: { provider, model, httpStatus: response.status, status: status || null, message }
  });
};
function findGeminiImage(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.data === 'string' && /^image\//.test(value.mime_type || value.mimeType || '') && value.data.length > 100) return { data: value.data, mime: value.mime_type || value.mimeType };
  for (const child of Array.isArray(value) ? value : Object.values(value)) { const found = findGeminiImage(child); if (found) return found; }
  return null;
}
function decoded(data, mime) {
  const buffer = Buffer.from(data, 'base64');
  if (!buffer.length || buffer.length > 25 * 1024 * 1024) throw safeError('Image provider returned an empty or oversized image.');
  return { buffer, mime: ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'image/png' };
}

export function createImageProvider(env = process.env, request = fetch) {
  const mediaDir = env.MEDIA_DIRECTORY ? resolve(env.MEDIA_DIRECTORY) : defaultMediaDir;
  const configured = {
    gemini: env.ALLOW_PAID_GENERATION === 'true' && !!env.GEMINI_API_KEY,
    openai: env.ALLOW_PAID_GENERATION === 'true' && !!env.OPENAI_API_KEY
  };
  const defaults = { gemini: env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image', openai: env.OPENAI_IMAGE_MODEL || 'gpt-image-2.5-flare' };
  async function gemini(prompt, model, options) {
    const response = await request('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ model, input: prompt, response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: options.aspectRatio, image_size: options.quality === 'high' ? '2K' : '1K' } })
    });
    if (!response.ok) throw await errorDetails(response, 'gemini', model);
    const data = await response.json(), image = findGeminiImage(data);
    if (!image) throw safeError('Google Gemini returned no usable image.', { providerError: { provider: 'gemini', model } });
    return { ...decoded(image.data, image.mime), usage: { provider: 'gemini', model, usageUnavailable: true, costStatus: 'unreconciled', recordedAt: new Date().toISOString() } };
  }
  async function openai(prompt, model, options) {
    const modern = /^gpt-image-(?:2|2\.5)/.test(model);
    const response = await request('https://api.openai.com/v1/images/generations', {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, prompt, n: 1, size: options.aspectRatio === '16:9' && modern ? '1536x864' : options.aspectRatio === '1:1' ? '1024x1024' : '1536x1024', quality: options.quality, output_format: 'webp' })
    });
    if (!response.ok) throw await errorDetails(response, 'openai', model);
    const data = await response.json(), encoded = data.data?.[0]?.b64_json;
    if (!encoded) throw safeError('OpenAI returned no usable image.', { providerError: { provider: 'openai', model } });
    return { ...decoded(encoded, 'image/webp'), usage: { provider: 'openai', model, tokens: data.usage || null, usageUnavailable: !data.usage, costStatus: 'unreconciled', recordedAt: new Date().toISOString() } };
  }
  return {
    configured, defaults, models: IMAGE_MODELS,
    ready(provider) { return configured[provider] === true; },
    async generate({ provider, model, prompt, quality = 'low', aspectRatio = '16:9' }) {
      if (!['gemini', 'openai'].includes(provider) || !configured[provider]) throw safeError(`${provider === 'openai' ? 'OpenAI' : 'Gemini'} image generation is not configured.`);
      model = cleanModel(model || defaults[provider]);
      if (!/^[a-zA-Z0-9._:-]{3,150}$/.test(model)) throw safeError('Choose a valid image model ID.');
      if (!['low', 'medium', 'high'].includes(quality)) quality = 'low';
      const result = provider === 'gemini' ? await gemini(prompt, model, { quality, aspectRatio }) : await openai(prompt, model, { quality, aspectRatio });
      const extension = result.mime === 'image/jpeg' ? 'jpg' : result.mime.split('/')[1];
      await mkdir(mediaDir, { recursive: true });
      const filename = `${randomUUID()}.${extension}`;
      await writeFile(join(mediaDir, filename), result.buffer, { flag: 'wx' });
      return { url: new URL(`/media/${filename}`, env.APP_ORIGIN || 'http://127.0.0.1:3210').href, usage: result.usage };
    },
    async read(filename) {
      if (!/^[a-f0-9-]+\.(png|jpg|jpeg|webp)$/.test(filename)) throw safeError('Invalid media filename.');
      return readFile(join(mediaDir, filename));
    }
  };
}
