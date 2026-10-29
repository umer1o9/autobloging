import test from 'node:test';
import assert from 'node:assert/strict';
import { renderArticle } from '../src/content.js';

test('cover is prioritized and summary and FAQs stay visible even for a one-section article', () => {
  const html = renderArticle({ coverImage: { url: 'https://example.com/cover.webp', alt: 'Cover' }, visualSummary: { title: 'Process overview', steps: [{ title: 'Plan', description: 'Define scope' }] }, sections: [{ heading: 'Only section', paragraphs: ['Body'], image: { url: 'https://example.com/inline.webp' } }], faqs: [{ question: 'How?', answer: 'Start here.' }] });
  assert.match(html, /class="autoblog-article"/);
  assert.match(html, /loading="eager" fetchpriority="high"/);
  assert.match(html, /inline.webp"[^>]*loading="lazy"/);
  assert.equal((html.match(/class="visual-summary"/g) || []).length, 1);
  assert.ok(html.indexOf('class="visual-summary"') < html.indexOf('class="article-toc"'));
  assert.match(html, /<details open><summary>How\?<\/summary><p>Start here\./);
});

test('contextual website links escape labels and URLs, avoid partial words and link each resource once', () => {
  const html = renderArticle({ internalLinks: [{ title: 'SEO (content)', url: 'https://example.com/seo?a=1&b=2' }, { title: 'Home', url: 'https://example.com/' }, { title: '<script>', url: 'https://example.com/safe' }, { title: 'Unsafe', url: 'javascript:alert(1)' }], sections: [{ paragraphs: ['Homework is useful. Try SEO (content) today. SEO (content) again. <script> Unsafe'], bullets: ['Go Home now.'] }] });
  assert.equal((html.match(/class="article-internal-link"/g) || []).length, 3);
  assert.match(html, /href="https:\/\/example.com\/seo\?a=1&amp;b=2">SEO \(content\)<\/a>/);
  assert.match(html, /Homework is useful/);
  assert.match(html, />Home<\/a>/);
  assert.doesNotMatch(html, /<script>|javascript:/);
  assert.match(html, /class="related-resources"/);
});
