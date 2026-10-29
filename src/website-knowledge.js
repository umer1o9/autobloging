import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { crawlUrl, fetchWebsite, CRAWLER_AGENT } from './website-fetch.js';
import { parsePage, retrieve } from './website-index.js';
const stamp = () => new Date().toISOString();
const active = state => ['queued','running'].includes(state?.status);
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const candidate = url => !/\.(?:pdf|jpg|jpeg|png|gif|webp|svg|css|js|zip|mp4|mp3|woff2?|ico|xml)(?:\?|$)/i.test(url) && !/\/(?:wp-admin|admin|login|logout|sign-in|sign-out|cart|checkout|account)(?:\/|\?|$)/i.test(new URL(url).pathname);
export function knowledgeSummary(state) {
  if (!state) return { status: 'not_synced', pageCount: 0 };
  return { status: state.status, runId: state.runId, pageCount: state.pageCount || 0, indexedPages: state.indexedPages || 0, processed: state.visited?.length || 0, pending: state.frontier?.length || 0, maxPages: state.maxPages, requestedAt: state.requestedAt, updatedAt: state.updatedAt, lastSyncedAt: state.lastSyncedAt, error: state.error || null, warning: state.warning || null, errors: [...(state.errors || []), ...(state.aliases || [])].slice(-20), activeRunId: state.activeRunId, indexType: 'Local hashed text vectors (4096 dimensions); no paid embedding calls' };
}
export class WebsiteKnowledge {
  constructor(store, fetcher = fetchWebsite) { this.store = store; this.fetch = fetcher; this.busy = false; }
  async queue(workspace, site) {
    const url = crawlUrl(site.url);
    if (!url) throw error('Use a public HTTP(S) website URL on port 80 or 443.');
    const previous = await this.store.getKnowledge(workspace, site.id);
    if (active(previous) && previous.url === url) return knowledgeSummary(previous);
    const state = { runId: randomUUID(), url, status: 'queued', maxPages: 200, requestedAt: stamp(), updatedAt: stamp(), frontier: [url], visited: [], seen: [url], errors: [], pageCount: 0, bytes: 0,
      activeRunId: previous?.url === url ? previous.activeRunId : null, indexedPages: previous?.url === url ? previous.indexedPages : 0, lastSyncedAt: previous?.url === url ? previous.lastSyncedAt : null };
    await this.store.putKnowledge(workspace, site.id, state);
    return knowledgeSummary(state);
  }
  async view(workspace, site) {
    const state = await this.store.getKnowledge(workspace, site);
    const pages = await this.store.knowledgePages(workspace, site, state?.activeRunId);
    return { knowledge: knowledgeSummary(state), pages: pages.map(({ url, title, description, fetchedAt, headings, textLength }) => ({ url, title, description, fetchedAt, headings, textLength })) };
  }
  async document(workspace, site, url) {
    const state = await this.store.getKnowledge(workspace, site);
    const pages = await this.store.knowledgePages(workspace, site, state?.activeRunId);
    const selected = url ? pages.filter(page => page.url === url) : pages;
    if (!selected.length) throw error('No saved pages found. Complete a website sync first.', 404);
    return selected.map(page => `${page.markdown}\n\n## Images\n${(page.images || []).map(image => `- ${image.alt}: ${image.url}`).join('\n')}\n\n## Structured data\n\n\`\`\`json\n${JSON.stringify(page.structuredData, null, 2)}\n\`\`\``).join('\n\n---\n\n');
  }
  async context(workspace, site, query) {
    const state = await this.store.getKnowledge(workspace, site);
    const pages = await this.store.knowledgePages(workspace, site, state?.activeRunId);
    return { runId: state?.activeRunId || null, passages: retrieve(pages, query) };
  }
  async runBatch(log = console.log) {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const { workspace, site, value: state } of await this.store.pendingKnowledge()) {
        // Global worker lock is held by both cron and the embedded worker.
        if (!this.store.workerActive) throw new Error('Website sync worker lock was lost.');
        try { await this.crawl(workspace, site, state, log); }
        catch (cause) {
          if (!this.store.workerActive) { log(`[website-sync] site=${site} paused after worker lock loss; the next worker can resume.`); return; }
          state.status = 'failed'; state.error = cause.message.slice(0,500); state.updatedAt = stamp();
          await this.store.progressKnowledge(workspace, site, state.runId, state);
          log(`[website-sync] site=${site} failed: ${state.error}`);
        }
      }
    } finally { this.busy = false; }
  }
  async crawl(workspace, site, state, log) {
    const until = Date.now() + 60000, origin = new URL(state.url).origin;
    const checkpoint = async () => { if (!this.store.workerActive) throw error('Worker lock lost. Progress will resume on the next worker.'); state.updatedAt = stamp(); if (!await this.store.progressKnowledge(workspace, site, state.runId, state)) throw error('Sync was superseded by a newer request.'); };
    const enqueue = value => {
      const url = crawlUrl(value, state.url);
      if (!url || !candidate(url) || state.seen.includes(url)) return;
      if (state.seen.length >= 2000 || (state.discoveredBytes || 0) + url.length > 500000) { state.discoveryLimited = true; return; }
      state.discoveredBytes = (state.discoveredBytes || 0) + url.length;
      state.seen.push(url); state.frontier.push(url);
    };
    state.status = 'running'; await checkpoint();
    if (state.robots === undefined) {
      const response = await this.fetch(`${origin}/robots.txt`, origin);
      if (response.status === 404) state.robots = '';
      else if (response.status === 401 || response.status === 403) throw error('robots.txt denied access. The website was not crawled.');
      else if (response.status !== 200) throw error(`robots.txt returned HTTP ${response.status}. Resync when the site is available.`);
      else state.robots = response.body.toString('utf8');
      state.sitemaps = [...new Set([`${origin}/sitemap.xml`, ...state.robots.split('\n').filter(line => /^sitemap:/i.test(line)).map(line => line.slice(line.indexOf(':')+1).trim())])].map(url => crawlUrl(url, state.url)).filter(Boolean).slice(0,5);
      state.mapsVisited = [];
      await checkpoint();
    }
    const robots = robotsParser(`${origin}/robots.txt`, state.robots);
    const allowed = url => robots.isAllowed(url, CRAWLER_AGENT) !== false;
    const delay = Math.max(500, (robots.getCrawlDelay(CRAWLER_AGENT) || 0) * 1000);
    // Sitemap indexes are bounded and resumable, just like page discovery.
    while (state.sitemaps.length && state.mapsVisited.length < 5 && Date.now() < until - 16000) {
      if ((state.nextFetchAt || 0) > until - 16000) break;
      const url = state.sitemaps.shift();
      if (state.mapsVisited.includes(url)) continue;
      state.mapsVisited.push(url);
      if (!allowed(url)) continue;
      await this.wait(state, delay);
      try {
        const response = await this.fetch(url, origin, { allowed });
        if (response.status === 200) {
          const $ = load(response.body.toString('utf8'), { xmlMode: true });
          $('url > loc').each((_, node) => enqueue($(node).text().trim()));
          $('sitemap > loc').each((_,node) => { const next = crawlUrl($(node).text().trim(), state.url); if (next && state.sitemaps.length < 5 && !state.mapsVisited.includes(next)) state.sitemaps.push(next); });
        }
      } catch { state.errors.push({ url, error: 'Sitemap unavailable; continuing with website links.' }); }
      await checkpoint();
    }
    let count = 0;
    while (state.frontier.length && state.pageCount < state.maxPages && state.visited.length < 600 && state.bytes < 12000000 && count < 10 && Date.now() < until - 16000) {
      if (!this.store.workerActive) throw error('Worker lock lost. Resync to continue.');
      if ((state.nextFetchAt || 0) > until - 16000) break;
      const url = state.frontier[0];
      if (state.visited.includes(url)) { state.frontier.shift(); continue; }
      if (allowed(url)) {
        await this.wait(state, delay);
        try {
          const response = await this.fetch(url, origin, { allowed });
          if (response.status !== 200) throw error(`HTTP ${response.status}`);
          if (!/text\/html|application\/xhtml\+xml/.test(response.type)) throw error('Not an HTML page.');
          const page = parsePage(response.body, response.url);
          if (/\bnoindex\b/i.test(`${page.robots} ${response.headers['x-robots-tag'] || ''}`)) throw error('Excluded by noindex.');
          if (page.canonical && page.canonical !== page.url) {
            enqueue(page.canonical);
            state.aliases = [...(state.aliases || []), { url, error: `Canonical alias of ${page.canonical}; using the canonical page instead.` }].slice(-100);
          } else if (state.contentHashes?.[page.contentHash]) {
            state.aliases = [...(state.aliases || []), { url, error: `Duplicate content of ${state.contentHashes[page.contentHash]}; not indexed twice.` }].slice(-100);
          } else {
            for (const link of page.links) enqueue(link.url);
            if (page.textLength < 80) throw error('Too little readable text; this page may require JavaScript.');
            if (!state.savedUrls?.includes(page.url)) {
              await this.store.putPage(workspace, site, state.runId, page);
              state.savedUrls = [...(state.savedUrls || []), page.url]; state.pageCount++; state.bytes += Buffer.byteLength(page.markdown);
              state.contentHashes = { ...(state.contentHashes || {}), [page.contentHash]: page.url };
            }
          }
        } catch (cause) { state.errors.push({ url, error: cause.message.slice(0,300) }); }
      } else state.errors.push({ url, error: 'Excluded by robots.txt.' });
      state.frontier.shift(); state.visited.push(url); count++;
      state.errors = state.errors.slice(-100);
      await checkpoint();
    }
    if (!state.frontier.length || state.pageCount >= state.maxPages || state.visited.length >= 600 || state.bytes >= 12000000) {
      if (!state.pageCount) throw error('No readable public HTML pages were saved. Check the URL, robots policy and page errors.');
      state.status = state.frontier.length || state.sitemaps.length || state.discoveryLimited || state.errors.length ? 'partial' : 'completed';
      state.warning = state.frontier.length || state.sitemaps.length || state.discoveryLimited ? 'Crawl limit reached. Some URLs remain unprocessed.' : state.errors.length ? 'Some URLs were excluded or failed. Inspect page errors for coverage.' : null;
      state.activeRunId = state.runId; state.indexedPages = state.pageCount; state.lastSyncedAt = stamp();
      await checkpoint();
      await this.store.cleanKnowledgePages(workspace, site, state.runId);
    }
    log(`[website-sync] site=${site} status=${state.status} saved=${state.pageCount} visited=${state.visited.length} pending=${state.frontier.length}`);
  }
  async wait(state, delay) {
    const remaining = (state.nextFetchAt || 0) - Date.now();
    if (remaining > 60000 || delay > 60000) throw error('Website asks for a crawl delay over 60 seconds. Use a crawler configured for that policy.');
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    state.nextFetchAt = Date.now() + delay;
  }
}
