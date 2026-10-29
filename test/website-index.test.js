import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, crawlUrl, fetchWebsite } from '../src/website-fetch.js';
import { parsePage, retrieve } from '../src/website-index.js';

test('crawler rejects local/reserved IPv4, IPv6 and mapped addresses before requesting a page', async () => {
  for (const address of ['127.0.0.1','10.1.2.3','169.254.169.254','192.168.1.1','172.16.2.3','0.0.0.0','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) {
    assert.equal(publicAddress(address), false, address);
    await assert.rejects(fetchWebsite('https://example.com/', 'https://example.com', { resolve: async () => [{ address, family: address.includes(':') ? 6 : 4 }] }), /private, local or reserved/);
  }
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
});
test('URL discovery stays on the connected origin, rejects credentials and normalizes tracking', () => {
  assert.equal(crawlUrl('/about?utm_source=test&b=2&a=1#team','https://example.com/'), 'https://example.com/about?a=1&b=2');
  for (const value of [undefined,'','https://other.com/','http://example.com/','javascript:alert(1)','https://example.com:8080/','https://u:p@example.com/']) assert.equal(crawlUrl(value,'https://example.com/'), null, String(value));
});
test('HTML extraction preserves page details and Markdown, strips executable/form content and builds retrievable chunks', () => {
  const page = parsePage(Buffer.from(`<html><head><title>Webhook integration</title><meta name="description" content="Reliable webhook delivery"><link rel="canonical" href="/services/webhooks"><script type="application/ld+json">{"@type":"Service","name":"Webhook integrations"}</script></head><body><nav>Navigation noise</nav><main><h1>Webhook delivery</h1><p>${'Reliable webhook integration and event delivery. '.repeat(12)}</p><h2>Retry policy</h2><ul><li>Backoff and monitoring</li></ul><a href="/contact?utm_source=a">Talk to us</a><a href="https://other.com/">External</a><img src="/diagram.webp" alt="Delivery flow"><script>secretScript()</script><form><input value="private">Private form fields</form></main></body></html>`), 'https://example.com/services', '2026-10-29T10:00:00.000Z');
  assert.equal(page.title, 'Webhook integration');
  assert.equal(page.canonical, 'https://example.com/services/webhooks');
  assert.equal(page.links.length, 1);
  assert.equal(page.links[0].url, 'https://example.com/contact');
  assert.equal(page.images[0].url, 'https://example.com/diagram.webp');
  assert.equal(page.structuredData[0]['@type'], 'Service');
  assert.match(page.markdown, /## Retry policy/);
  assert.doesNotMatch(page.markdown, /secretScript|Private form fields|Navigation noise/);
  const unrelated = parsePage(`<title>Cooking</title><main><p>${'Pasta and tomato recipes. '.repeat(15)}</p></main>`, 'https://example.com/cooking');
  const results = retrieve([unrelated,page], 'webhook delivery retry integration', 2500);
  assert.equal(results[0].url, page.url);
  assert.ok(results.reduce((size,result) => size+result.text.length+300,0) <= 2500);
});
