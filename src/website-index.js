import { load, loadBuffer } from 'cheerio';
import { createHash } from 'node:crypto';
import { crawlUrl } from './website-fetch.js';
const tidy = value => String(value || '').replace(/\s+/g, ' ').trim();
const stops = new Set('the and for with that this from your you are our have will was not can into how what when where which their they its www https com'.split(' '));
export function vector(text) {
  const result = {};
  for (const token of String(text).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []) {
    if (stops.has(token)) continue;
    const feature = createHash('sha256').update(token).digest().readUInt16BE(0) % 4096;
    result[feature] = (result[feature] || 0) + 1;
  }
  for (const key of Object.keys(result)) result[key] = 1 + Math.log(result[key]);
  const norm = Math.hypot(...Object.values(result));
  for (const key of Object.keys(result)) result[key] /= norm;
  return result;
}
export function retrieve(pages, query, maxChars = 12000) {
  const q = vector(query), ranked = [];
  for (const page of pages) for (const chunk of page.chunks || []) {
    const score = Object.entries(q).reduce((sum, [key, value]) => sum + value * (chunk.vector[key] || 0), 0);
    ranked.push({ url: page.url, title: page.title, fetchedAt: page.fetchedAt, text: chunk.text, score });
  }
  ranked.sort((a,b) => b.score - a.score || a.url.localeCompare(b.url));
  const selected = [], counts = new Map(); let used = 0;
  for (const entry of ranked) {
    if (selected.length >= 8) break;
    if ((counts.get(entry.url) || 0) >= 2 || (entry.score <= 0 && selected.length >= 2)) continue;
    const text = entry.text.slice(0, maxChars - used - 300);
    if (text.length < 100) break;
    selected.push({ ...entry, text, score: Number(entry.score.toFixed(4)) }); used += text.length + 300;
    counts.set(entry.url, (counts.get(entry.url) || 0) + 1);
  }
  return selected;
}
export function parsePage(body, url, fetchedAt = new Date().toISOString()) {
  const $ = Buffer.isBuffer(body) ? loadBuffer(body) : load(body);
  const title = tidy($('title').first().text()).slice(0,300), description = tidy($('meta[name="description"]').attr('content')).slice(0,2000);
  const robots = tidy($('meta[name="robots"]').attr('content'));
  const canonical = crawlUrl($('link[rel="canonical"]').attr('href'), url);
  const links = [], seen = new Set();
  $('a[href]').each((_, node) => { const href = crawlUrl($(node).attr('href'), url); if (href && !seen.has(href) && links.length < 500) { links.push({ url: href, title: tidy($(node).text()).slice(0,200) }); seen.add(href); } });
  const images = $('img[src]').toArray().slice(0,50).map(node => ({ url: (() => { try { const value = new URL($(node).attr('src'), url); return /^https?:$/.test(value.protocol) ? value.href : ''; } catch { return ''; } })(), alt: tidy($(node).attr('alt')).slice(0,300) }));
  const structuredData = $('script[type="application/ld+json"]').toArray().slice(0,8).map(node => { try { const text = $(node).text(); return text.length < 15000 ? JSON.parse(text) : null; } catch { return null; } }).filter(Boolean);
  $('script,style,noscript,template,iframe,form,svg,[hidden],[aria-hidden="true"]').remove();
  const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  const headings = root.find('h1,h2,h3,h4').toArray().map(node => ({ level: Number(node.tagName[1]), text: tidy($(node).text()).slice(0,500) })).filter(heading => heading.text).slice(0,100);
  const blocks = [];
  root.find('h1,h2,h3,h4,h5,h6,p,li,pre,tr,blockquote').each((_,node) => {
    if ($(node).parents('li,pre,blockquote').length) return;
    const text = tidy($(node).text()); if (!text) return;
    blocks.push(/^h[1-6]$/.test(node.tagName) ? `${'#'.repeat(Number(node.tagName[1]))} ${text}` : node.tagName === 'li' ? `- ${text}` : text);
  });
  const fullText = blocks.join('\n\n') || tidy(root.text());
  const text = fullText.slice(0,60000);
  const markdown = `# ${title || url}\n\nURL: ${url}\nFetched: ${fetchedAt}\nCanonical: ${canonical || ''}\nDescription: ${description}\n\n${text}\n\n## Website links\n\n${links.map(link => `- ${link.title || link.url}: ${link.url}`).join('\n')}`;
  const chunks = [];
  for (let offset = 0; offset < text.length && chunks.length < 40; offset += 1600) {
    const part = text.slice(offset, offset + 2000);
    chunks.push({ text: part, vector: vector(`${title} ${description} ${part}`) });
  }
  return { url, title, description, canonical, robots, headings, links, images, structuredData, markdown, chunks, fetchedAt, contentHash: createHash('sha256').update(`${title}\n${description}\n${text}`).digest('hex'), textLength: text.length, truncated: fullText.length > text.length };
}
