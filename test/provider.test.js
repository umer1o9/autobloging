import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../src/provider.js';
import { validArticle, website } from './helpers.js';

const env = { GEMINI_API_KEY: 'test-only-key', GEMINI_RESEARCH_MODEL: 'test-research', GEMINI_WRITER_MODEL: 'test-writer', ALLOW_PAID_GENERATION: 'true' };
test('provider remains disabled without explicit configuration', () => { assert.equal(createProvider({}).ready, false); assert.equal(createProvider({ ...env, ALLOW_PAID_GENERATION: 'false' }).ready, false); });
test('research captures and deduplicates grounding sources and flags unavailable usage', async () => {
  const provider = createProvider(env, async (url, options) => {
    assert.ok(url.endsWith('test-research:generateContent')); assert.equal(options.headers['x-goog-api-key'], 'test-only-key');
    assert.deepEqual(JSON.parse(options.body).tools, [{ google_search: {} }]);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Grounded memo' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.org/a', title: 'A' } }, { web: { uri: 'https://example.org/a', title: 'A' } }, { web: { uri: 'javascript:alert(1)', title: 'Bad' } }, { web: { uri: 'https://example.org/b', title: 'B' } }] } }] });
  });
  const research = await provider.research({ title: 'Test topic' }, website(), env.GEMINI_RESEARCH_MODEL);
  assert.equal(research.sources.length, 2); assert.equal(research.usage.usageUnavailable, true); assert.equal(research.usage.costStatus, 'unreconciled');
});
test('website discovery extracts the selected topic from grounded research', async () => {
  let calls = 0;
  const provider = createProvider(env, async (_url, options) => {
    calls++;
    const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    if (calls === 1) {
      assert.match(prompt, /Inspect https:\/\/example.com/);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'SELECTED_TOPIC_JSON: {"title":"How can teams automate publishing?","query":"automate publishing","group":"Automation","brief":"A useful guide."}' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/about', title: 'example.com' } }] } }] });
    }
    assert.match(prompt, /separate evidence-gathering step/); assert.match(prompt, /automate publishing/);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Research memo' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.org/a', title: 'A' } }, { web: { uri: 'https://standards.example/b', title: 'B' } }] } }] });
  });
  const result = await provider.research({ autoDiscover: true, existingTitles: [], themes: [] }, website(), env.GEMINI_RESEARCH_MODEL);
  assert.equal(result.selectedTopic.title, 'How can teams automate publishing?');
  assert.equal(result.sources.length, 2);
  assert.equal(calls, 2); assert.equal(result.usages.length, 2);
});
test('research broadens the query once when the first pass has too few independent sources', async () => {
  let calls = 0;
  const provider = createProvider(env, async (_url, options) => {
    calls++; const prompt = JSON.parse(options.body).contents[0].parts[0].text;
    if (calls === 2) assert.match(prompt, /previous search returned too few usable sources/i);
    const uri = calls === 1 ? 'https://docs.example.org/a' : 'https://standards.example.net/b';
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `Memo ${calls}` }] }, groundingMetadata: { groundingChunks: [{ web: { uri, title: `Source ${calls}` } }] } }] });
  });
  const result = await provider.research({ title: 'Secure SaaS scaling', query: 'secure SaaS scaling' }, website(), env.GEMINI_RESEARCH_MODEL);
  assert.equal(calls, 2); assert.equal(result.sources.length, 2); assert.equal(result.usages.length, 2);
});
test('writer validates JSON and rejects refusal or truncation', async () => {
  for (const finishReason of ['SAFETY', 'MAX_TOKENS']) {
    const provider = createProvider(env, async () => Response.json({ candidates: [{ finishReason, content: { parts: [{ text: '{}' }] } }] }));
    await assert.rejects(() => provider.write({}, website(), {}, [], env.GEMINI_WRITER_MODEL), /refused, truncated/);
  }
  const invalid = createProvider(env, async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }));
  await assert.rejects(() => invalid.write({}, website(), {}, [], env.GEMINI_WRITER_MODEL), /invalid article JSON/);
  const valid = createProvider(env, async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(validArticle()) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 200 } }));
  const result = await valid.write({}, website(), {}, [], env.GEMINI_WRITER_MODEL);
  assert.equal(result.article.slug, validArticle().slug); assert.equal(result.usage.tokens.promptTokenCount, 100);
});
test('writer accepts fenced JSON and repairs malformed JSON once with the repair model', async () => {
  const fenced = createProvider(env, async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: `\`\`\`json\n${JSON.stringify(validArticle())}\n\`\`\`` }] } }] }));
  assert.equal((await fenced.write({}, website(), {}, [], env.GEMINI_WRITER_MODEL)).article.slug, validArticle().slug);
  let calls = 0;
  const repaired = createProvider({ ...env, GEMINI_REPAIR_MODEL: 'test-repair' }, async url => {
    calls++;
    if (calls === 1) return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{ invalid json' }] } }] });
    assert.ok(url.endsWith('test-repair:generateContent'));
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(validArticle()) }] } }] });
  });
  const result = await repaired.write({}, website(), {}, [], env.GEMINI_WRITER_MODEL);
  assert.equal(result.article.slug, validArticle().slug); assert.equal(result.usages.length, 2); assert.equal(calls, 2);
});
test('provider preserves safe Google error details for Activity', async () => {
  const provider = createProvider(env, async () => Response.json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota unavailable. Check plan and billing details.' } }, { status: 429 }));
  await assert.rejects(async () => {
    try { await provider.research({ title: 'Test' }, website(), env.GEMINI_RESEARCH_MODEL); }
    catch (error) {
      assert.equal(error.retryable, true);
      assert.deepEqual(error.providerError, { provider: 'gemini', model: 'test-research', httpStatus: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota unavailable. Check plan and billing details.' });
      throw error;
    }
  }, /Google Gemini HTTP 429 RESOURCE_EXHAUSTED/);
});
