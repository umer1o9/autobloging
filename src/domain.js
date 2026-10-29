import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { normalizeArticle, validateArticle, httpUrl, emptyArticle, renderArticle } from './content.js';
import { WebsiteKnowledge } from './website-knowledge.js';
import { timedOperation } from './timing.js';

export class AppError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const hash = value => createHash('sha256').update(value).digest('hex');
const requireValue = (condition, message, status = 400) => { if (!condition) throw new AppError(status, message); };
const now = () => new Date().toISOString();
const int = (v, min, max, name) => { requireValue(Number.isInteger(v) && v >= min && v <= max, `${name} must be between ${min} and ${max}.`); return v; };
const money = (v, name) => { requireValue(Number.isFinite(v) && v >= 0 && v <= 100000, `${name} must be a non-negative USD amount.`); return Math.round(v * 100); };
export class Domain {
  constructor(store, provider, imageProvider = { configured: {}, defaults: {}, ready: () => false }) { this.store = store; this.provider = provider; this.imageProvider = imageProvider; this.running = new Set(); this.knowledge = new WebsiteKnowledge(store); }
  async need(kind, workspace, id) { const value = (await this.store.get(kind, workspace, id)); requireValue(value, 'Not found.', 404); return value; }
  safeSite(site) { const { apiKeyHash, ...safe } = site; return { ...safe, hasApiKey: !!apiKeyHash }; }
  async saveSite(workspace, input, id) {
    return (await this.store.transaction(async () => {
      const previous = id ? (await this.need('site', workspace, id)) : {};
      const url = httpUrl(input.url);
      requireValue(typeof input.name === 'string' && input.name.trim().length > 1 && input.name.length <= 100, 'Enter a website name (2–100 characters).');
      requireValue(url, 'Enter a valid website URL.');
      try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format(); } catch { throw new AppError(400, 'Choose a valid IANA timezone.'); }
      requireValue(typeof input.timezone === 'string' && input.timezone.length > 0, 'Timezone is required.');
      const approvedLinks = (Array.isArray(input.approvedLinks) ? input.approvedLinks : []).slice(0, 30).map(l => {
        const link = httpUrl(l.url); requireValue(link && new URL(link).origin === new URL(url).origin, 'Approved links must belong to this website’s origin.');
        return { title: String(l.title || '').slice(0, 200), url: link, service: l.service === true };
      });
      const imageProvider = ['none', 'gemini', 'openai'].includes(input.imageProvider) ? input.imageProvider : (previous.imageGeneration?.provider || 'none');
      const imageModel = String(input.imageModel || previous.imageGeneration?.model || this.imageProvider.defaults?.[imageProvider] || '').trim().slice(0, 150);
      requireValue(!imageModel || /^[a-zA-Z0-9._:-]{3,150}$/.test(imageModel), 'Choose a valid image model ID.');
      const imageQuality = ['low', 'medium', 'high'].includes(input.imageQuality) ? input.imageQuality : (previous.imageGeneration?.quality || 'low');
      const inlineImageCount = int(Number(input.inlineImageCount ?? previous.imageGeneration?.inlineImageCount ?? 2), 0, 4, 'Inline image count');
      const imageStyle = String(input.imageStyle ?? previous.imageGeneration?.style ?? '').trim().slice(0, 2000);
      const site = { ...previous, id: id || randomUUID(), name: input.name.trim(), url, timezone: input.timezone,
        monthlyVolume: int(input.monthlyVolume, 1, 10000, 'Monthly article target'), reviewCapacity: int(input.reviewCapacity, 1, 1000, 'Review capacity'),
        monthlyBudgetCents: money(input.monthlyBudget, 'Monthly budget'), jobBudgetCents: money(input.jobBudget, 'Job allowance'),
        brandVoice: String(input.brandVoice || '').slice(0, 3000), audience: String(input.audience || '').slice(0, 2000),
        approvedLinks, publicationPaused: input.publicationPaused === true, generationPaused: input.generationPaused === true,
        imageGeneration: { provider: imageProvider, model: imageModel, quality: imageQuality, inlineImageCount, style: imageStyle, autoGenerate: imageProvider !== 'none' && (input.autoGenerateImages === undefined ? previous.imageGeneration?.autoGenerate === true : input.autoGenerateImages === true) },
        createdAt: previous.createdAt || now() };
      requireValue(site.jobBudgetCents <= site.monthlyBudgetCents, 'Job allowance cannot exceed the monthly budget.');
      (await this.store.put('site', workspace, site.id, site)); (await this.store.audit(workspace, site.id, id ? 'website.updated' : 'website.created', site.id));
      if (!id || previous.url !== url) await this.knowledge.queue(workspace, site);
      return this.safeSite(site);
    }, workspace));
  }
  async syncWebsites(log) { return this.knowledge.runBatch(log); }
  async queueWebsiteSync(workspace, id) {
    return this.store.transaction(async () => this.knowledge.queue(workspace, await this.need('site', workspace, id)), workspace);
  }
  async configureAutomation(workspace, id, input) {
    return this.store.transaction(async () => {
      const site = await this.need('site', workspace, id);
      requireValue(['review', 'automatic'].includes(input.mode), 'Choose a publishing mode.');
      requireValue(typeof input.enabled === 'boolean', 'Choose start or pause.');
      const themes = [...new Set((Array.isArray(input.themes) ? input.themes : []).map(t => String(t).trim()).filter(Boolean))];
      requireValue(themes.length <= 30 && themes.every(t => t.length >= 3 && t.length <= 120), 'Use up to 30 themes, each 3–120 characters.');
      const jobs = await this.store.list('job', workspace, id);
      site.automation = { ...site.automation, enabled: input.enabled, mode: input.mode, themes,
        acknowledgedFailures: jobs.filter(j => j.status === 'failed').map(j => j.id),
        message: input.enabled ? 'Starting: checking website setup…' : 'Paused. Any paid call already running may finish.', updatedAt: now() };
      await this.store.put('site', workspace, id, site);
      await this.store.audit(workspace, id, input.enabled ? 'automation.started' : 'automation.paused', id);
      return this.safeSite(site);
    }, workspace);
  }
  async prepareAutomaticSite(workspace, site) {
    const origin = new URL(site.url).origin;
    const candidates = [
      ...site.approvedLinks.map(link => ({ ...link, service: link.service || /\/(services?|solutions?|products?)(?:\/|$)/i.test(new URL(link.url).pathname) })),
      { title: `${site.name} home`, url: `${origin}/`, service: false },
      { title: `${site.name} services`, url: `${origin}/#services`, service: true },
      { title: `Contact ${site.name}`, url: `${origin}/#contact`, service: false }
    ];
    site.approvedLinks = [...new Map(candidates.map(link => [link.url, link])).values()].slice(0, 5);
    await this.store.put('site', workspace, site.id, site);
    return site;
  }
  async automate(at = new Date(), options = {}) {
    for (const { workspace, value: candidate } of await this.store.all('site')) {
      if (options.workspace && options.workspace !== workspace) continue;
      if (options.siteId && options.siteId !== candidate.id) continue;
      if (!candidate.automation?.enabled) continue;
      await this.store.transaction(async () => {
        let site = await this.need('site', workspace, candidate.id), config = site.automation;
        if (!config?.enabled) return;
        let message, queuedJob = false;
        try {
          requireValue(!site.publicationPaused && !site.generationPaused, 'Website generation or publication is paused.', 409);
          if (config.mode === 'automatic') site = await this.prepareAutomaticSite(workspace, site);
          const articles = await this.store.list('article', workspace, site.id);
          const jobs = await this.store.list('job', workspace, site.id);
          // A failed paid job needs deliberate acknowledgement; never retry it in a loop.
          requireValue(!jobs.some(j => j.status === 'failed' && !config.acknowledgedFailures?.includes(j.id)), 'A job failed. Inspect Activity, fix the issue, then click Resume.', 409);
          // Only human-approved articles or drafts produced by this automation can advance.
          const ready = articles.filter(a => a.status === 'approved' ||
            (config.mode === 'automatic' && a.status === 'draft' && a.automationGenerated && a.revision === 1));
          for (const article of ready) {
            const report = validateArticle(article.content, site);
            if (!report.valid || report.score < 85) continue;
            const automatic = article.status === 'draft';
            if (automatic) {
              const sources = new Set(article.research?.sources?.map(s => s.url));
              if (sources.size < 2 || article.content.references.some(r => !sources.has(r.url))) continue;
              article.automaticRevision = article.revision;
              article.approvalMethod = 'automated-checks';
            } else if (article.approvedRevision !== article.revision) continue;
            article.status = 'scheduled';
            article.scheduledAt = new Date(at.getTime() + 1000 + articles.indexOf(article) * 1000).toISOString();
            article.automationScheduled = true;
            await this.store.put('article', workspace, site.id, article);
            await this.store.audit(workspace, site.id, automatic ? 'article.automatically_scheduled' : 'article.auto_scheduled_after_review', article.id);
          }
          requireValue(this.provider?.ready, 'Add GEMINI_API_KEY and enable generation in .env, then restart the server.', 503);
          requireValue(!jobs.some(j => ['queued', 'running'].includes(j.status)), 'Research and writing are in progress.', 409);
          requireValue(options.force || !config.nextRunAt || new Date(config.nextRunAt) <= at, `Next article: ${config.nextRunAt}`, 409);
          let topic = (await this.store.list('topic', workspace, site.id)).filter(t => t.status === 'queued' && !t.articleId)
            .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))[0];
          if (!topic) {
            const existing = await this.store.list('topic', workspace, site.id);
            const articleTitles = articles.map(article => article.content?.title).filter(Boolean);
            topic = await this.createTopic(workspace, site.id, {
              title: `Website discovery ${at.toISOString()}`,
              brief: `Inspect ${site.url}, choose a useful non-duplicate audience question, then research it with Google.`,
              group: 'Automatic discovery'
            });
            Object.assign(topic, { autoDiscover: true, themes: config.themes || [], existingTitles: [...existing.map(item => item.title), ...articleTitles] });
            await this.store.put('topic', workspace, site.id, topic);
          }
          const job = await this.startGeneration(workspace, topic.id);
          job.automationGenerated = true; queuedJob = true;
          await this.store.put('job', workspace, site.id, job);
          // Spread the target across a 30-day interval. No catch-up burst after downtime.
          config.nextRunAt = new Date(at.getTime() + 30 * 86400000 / site.monthlyVolume).toISOString();
          message = 'Website analysis and Google research queued → topic selection → writing → checks → ' + (config.mode === 'automatic' ? 'automatic publication.' : 'your approval → automatic publication.');
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          message = error.message;
        }
        if (queuedJob || config.message !== message) {
          config.message = message; config.updatedAt = now();
          await this.store.put('site', workspace, site.id, site);
        }
      }, workspace);
    }
  }
  async runAutomationNow(workspace, id, at = new Date()) {
    const site = await this.need('site', workspace, id);
    requireValue(site.automation?.enabled, 'Start automation before using Run now.', 409);
    const failed = (await this.store.list('job', workspace, id)).filter(job => job.status === 'failed').map(job => job.id);
    if (failed.length) {
      site.automation.acknowledgedFailures = [...new Set([...(site.automation.acknowledgedFailures || []), ...failed])];
      site.automation.message = 'Previous failure acknowledged. Starting a fresh article…';
      site.automation.updatedAt = now();
      await this.store.put('site', workspace, id, site);
      await this.store.audit(workspace, id, 'generation.failures_acknowledged', id);
    }
    await this.automate(at, { workspace, siteId: id, force: true });
    return this.safeSite(await this.need('site', workspace, id));
  }
  async rotateKey(workspace, id) {
    const key = `ab_read_${randomBytes(32).toString('hex')}`;
    (await this.store.transaction(async () => { const site = (await this.need('site', workspace, id)); site.apiKeyHash = hash(key); (await this.store.put('site', workspace, id, site)); (await this.store.audit(workspace, id, 'delivery_key.rotated', id)); }, workspace));
    return { key, siteId: id };
  }
  async createTopic(workspace, siteId, input) {
    (await this.need('site', workspace, siteId));
    requireValue(typeof input.title === 'string' && input.title.trim().length >= 5 && input.title.length <= 200, 'Topic title must contain 5–200 characters.');
    const normalized = input.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return (await this.store.transaction(async () => {
      requireValue(!(await this.store.list('topic', workspace, siteId)).some(t => t.normalized === normalized), 'This topic already exists for this website.', 409);
      const topic = { id: randomUUID(), siteId, title: input.title.trim(), normalized, brief: String(input.brief || '').slice(0, 5000), group: String(input.group || 'General').slice(0, 100), priority: int(input.priority ?? 2, 1, 3, 'Priority'), status: 'queued', createdAt: now() };
      (await this.store.put('topic', workspace, siteId, topic)); (await this.store.audit(workspace, siteId, 'topic.created', topic.id)); return topic;
    }, workspace));
  }
  async createDraft(workspace, topicId) {
    return (await this.store.transaction(async () => {
      const topic = (await this.need('topic', workspace, topicId));
      requireValue(topic.status !== 'generating', 'Generation is still running.', 409);
      if (topic.articleId) return (await this.need('article', workspace, topic.articleId));
      const article = { id: randomUUID(), topicId, siteId: topic.siteId, status: 'draft', revision: 1, approvedRevision: null, scheduledAt: null, createdAt: now(), content: emptyArticle(topic.title), research: null };
      (await this.store.put('article', workspace, topic.siteId, article));
      (await this.store.put('topic', workspace, topic.siteId, { ...topic, articleId: article.id, status: 'review' }));
      (await this.store.audit(workspace, topic.siteId, 'draft.created', article.id)); return article;
    }, workspace));
  }
  async saveArticle(workspace, id, input) {
    return (await this.store.transaction(async () => {
      const article = (await this.need('article', workspace, id));
      requireValue(article.revision === input.revision, 'This article changed. Reload before saving.', 409);
      requireValue(article.status !== 'published', 'Unpublish before editing a live article.', 409);
      const content = normalizeArticle(input.content || {});
      requireValue(!(await this.store.list('article', workspace, article.siteId)).some(a => a.id !== id && a.content.slug && a.content.slug === content.slug), 'Another article already uses this slug.', 409);
      Object.assign(article, { content, revision: article.revision + 1, approvedRevision: null, reviewedBy: null, automaticRevision: null, approvalMethod: null, automationGenerated: false, status: 'draft', scheduledAt: null, rejectionReason: null, updatedAt: now() });
      (await this.store.put('article', workspace, article.siteId, article)); (await this.store.audit(workspace, article.siteId, 'draft.updated', id));
      return (await this.articleDetail(workspace, id));
    }, workspace));
  }
  async articleDetail(workspace, id) {
    const article = (await this.need('article', workspace, id)), site = (await this.need('site', workspace, article.siteId));
    const content = normalizeArticle(article.content);
    return { ...article, content, validation: validateArticle(content, site), html: renderArticle(content) };
  }
  imagePrompt(content, site, target, index, supplied = '') {
    const section = target === 'section' ? content.sections[index] : null;
    const subject = section ? `${content.title}: ${section.heading}` : content.title;
    const planned = supplied || section?.image?.prompt || (target === 'cover' ? content.coverImage?.prompt : '');
    const context = section
      ? [section.heading, ...section.paragraphs.slice(0, 2), ...section.bullets.slice(0, 5)].join(' ')
      : [content.title, content.excerpt, content.directAnswer].join(' ');
    const visualSystem = site.imageGeneration?.style || 'Premium editorial technology illustration. Clean vector forms with subtle dimensional depth, an off-white or softly tinted background, deep charcoal or navy structure, one restrained accent color, generous whitespace, crisp edges, and high contrast.';
    const role = target === 'cover'
      ? 'Create a landscape 16:9 cover image with one strong focal idea. It must remain clear as a small blog thumbnail. Use a concrete visual metaphor and leave calm negative space. Do not put the article title in the image.'
      : 'Create a landscape 3:2 explanatory visual for this section. Prefer a simple process diagram, decision map, comparison, checklist, or concrete conceptual illustration when that helps the reader. If labels are essential, use no more than five short labels and spell them exactly.';
    const request = String(planned || `Create an original editorial visual for: ${subject}`).slice(0, 3000);
    return `${request}\n\nARTICLE CONTEXT\n${context.slice(0, 2400)}\n\nVISUAL ROLE\n${role}\n\nCONSISTENT WEBSITE VISUAL SYSTEM\nWebsite: ${site.name}. Audience: ${site.audience}. Editorial voice: ${site.brandVoice}. Art direction: ${visualSystem}\n\nQUALITY RULES\nMake every visible element explain the subject. Keep the composition uncluttered and publication-ready. Use a consistent palette and visual language across the article. Create original artwork; do not imitate another publisher or living artist. Avoid generic robot heads, glowing brains, handshakes, random circuit boards, stock-photo people, decorative filler, logos, watermarks, fake product interfaces, fabricated screenshots, fake statistics, and unsupported claims. Avoid text unless the explanatory format requires the short labels specified above.`;
  }
  imageSectionIndexes(content, limit) {
    return content.sections.map((section, index) => {
      const heading = section.heading.toLowerCase(), prompt = String(section.image?.prompt || '').toLowerCase();
      let score = 0;
      if (/(how|process|workflow|architecture|lifecycle|steps?|choose|decision|compar|framework|model|types?|checklist|roadmap|sequence)/.test(heading)) score += 4;
      if (/(diagram|flow|decision|compar|timeline|checklist|architecture|map|sequence|stages?)/.test(prompt)) score += 3;
      if (section.bullets.length >= 3) score += 2;
      if (section.paragraphs.length >= 2) score += 1;
      return { index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(item => item.index).sort((a, b) => a - b);
  }
  async createImage(content, site, target, index, suppliedPrompt = '') {
    const settings = site.imageGeneration || {};
    requireValue(['gemini', 'openai'].includes(settings.provider), 'Choose Gemini or OpenAI in Website settings before generating images.');
    requireValue(this.imageProvider.ready(settings.provider), `${settings.provider === 'openai' ? 'OpenAI' : 'Gemini'} image generation is not configured on this server.`, 503);
    const prompt = this.imagePrompt(content, site, target, index, suppliedPrompt);
    const generated = await this.imageProvider.generate({ provider: settings.provider, model: settings.model, quality: settings.quality, aspectRatio: target === 'cover' ? '16:9' : '3:2', prompt });
    const planned = target === 'cover' ? content.coverImage : content.sections[index].image;
    const alt = planned?.alt || (target === 'cover' ? `Cover illustration for ${content.title}` : `Illustration for ${content.sections[index].heading}`);
    return { image: { url: generated.url, alt, caption: planned?.caption || '', prompt, provider: settings.provider, model: settings.model, generatedAt: now() }, usage: generated.usage };
  }
  async generateArticleImage(workspace, id, input) {
    const article = await this.need('article', workspace, id), site = await this.need('site', workspace, article.siteId);
    requireValue(article.status !== 'published', 'Unpublish before changing images on a live article.', 409);
    requireValue(article.revision === input.revision, 'This article changed. Reload before generating an image.', 409);
    const target = input.target === 'section' ? 'section' : 'cover';
    const index = target === 'section' ? int(Number(input.sectionIndex), 0, Math.max(0, article.content.sections.length - 1), 'Section index') : 0;
    const generated = await this.createImage(article.content, site, target, index, String(input.prompt || ''));
    return this.store.transaction(async () => {
      const current = await this.need('article', workspace, id);
      requireValue(current.revision === input.revision, 'This article changed while the image was generated. Reload before trying again.', 409);
      if (target === 'cover') current.content.coverImage = generated.image; else current.content.sections[index].image = generated.image;
      Object.assign(current, { revision: current.revision + 1, approvedRevision: null, reviewedBy: null, automaticRevision: null, approvalMethod: null, automationGenerated: false, status: 'draft', scheduledAt: null, updatedAt: now() });
      await this.store.put('article', workspace, current.siteId, current); await this.store.audit(workspace, current.siteId, 'article.image_generated', id);
      return this.articleDetail(workspace, id);
    }, workspace);
  }
  async transition(workspace, id, action, input, actor) {
    return (await this.store.transaction(async () => {
      const article = (await this.need('article', workspace, id)), site = (await this.need('site', workspace, article.siteId));
      requireValue(article.revision === input.revision, 'Article changed; reload and review the current revision.', 409);
      if (action === 'approve') {
        requireValue(['draft', 'rejected'].includes(article.status), 'Only a draft can be approved.', 409);
        const report = validateArticle(article.content, site);
        requireValue(report.valid && report.score >= 85, report.errors.join(' ') || 'Quality score is below 85.');
        requireValue(input.evidenceReviewed === true, 'Confirm you reviewed factual claims against their sources.');
        Object.assign(article, { status: 'approved', approvedRevision: article.revision, reviewedBy: actor, reviewedAt: now(), rejectionReason: null });
      } else if (action === 'reject') {
        requireValue(article.status !== 'published', 'Unpublish before rejecting a live article.', 409);
        requireValue(typeof input.reason === 'string' && input.reason.trim().length >= 5, 'Provide a rejection reason.');
        Object.assign(article, { status: 'rejected', approvedRevision: null, scheduledAt: null, rejectionReason: input.reason.slice(0, 2000) });
      } else if (action === 'schedule') {
        requireValue(['approved', 'scheduled'].includes(article.status) && article.approvedRevision === article.revision, 'Approve the current revision first.', 409);
        const time = new Date(input.scheduledAt);
        requireValue(Number.isFinite(time.getTime()) && time.getTime() > Date.now(), 'Schedule a valid time in the future.');
        const scheduledAt = time.toISOString();
        requireValue(!(await this.store.list('article', workspace, article.siteId)).some(a => a.id !== id && a.status === 'scheduled' && a.scheduledAt === scheduledAt), 'This website already has an article in that slot.', 409);
        Object.assign(article, { status: 'scheduled', scheduledAt });
      } else if (action === 'unpublish') {
        requireValue(article.status === 'published', 'Article is not published.', 409);
        Object.assign(article, { status: 'draft', approvedRevision: null, automaticRevision: null, automationGenerated: false, scheduledAt: null, publishedAt: null });
      } else throw new AppError(400, 'Unknown action.');
      (await this.store.put('article', workspace, article.siteId, article)); (await this.store.audit(workspace, article.siteId, `article.${action}`, id)); return article;
    }, workspace));
  }
  async publishDue(at = new Date()) {
    let count = 0;
    for (const { workspace, value: candidate } of await this.store.dueArticles(at.toISOString())) {
      count += await this.store.transaction(async () => {
        const article = await this.need('article', workspace, candidate.id);
        if (article.status !== 'scheduled' || !article.scheduledAt || new Date(article.scheduledAt) > at) return 0;
        const site = await this.need('site', workspace, article.siteId);
        const validation = validateArticle(article.content, site);
        if (site.publicationPaused || !(article.approvedRevision === article.revision || (site.automation?.enabled && site.automation.mode === 'automatic' && article.automaticRevision === article.revision)) || (article.automationScheduled && !site.automation?.enabled) || !validation.valid || validation.score < 85) return 0;
        await this.store.put('article', workspace, article.siteId, { ...article, status: 'published', publishedAt: at.toISOString() });
        await this.store.audit(workspace, article.siteId, 'article.published', article.id);
        return 1;
      }, workspace);
    }
    return { published: count };
  }
  async delivered(siteId, key, slug, pagination = {}) {
    requireValue(typeof key === 'string' && key.length > 20, 'Valid website delivery key required.', 401);
    const record = await this.store.findDeliverySite(siteId, hash(key));
    requireValue(record, 'Valid website delivery key required.', 401);
    const result = await this.store.published(record.workspace, siteId, { ...pagination, slug });
    const project = a => { const content = normalizeArticle(a.content); return { id: a.id, ...content, references: content.references.map(({ title, url }) => ({ title, url })), publishedAt: a.publishedAt, updatedAt: a.updatedAt || a.publishedAt, html: renderArticle(content) }; };
    if (slug) { requireValue(result, 'Article not found.', 404); return project(result); }
    return { articles: result.items.map(project), total: result.total, offset: result.offset, limit: result.limit };
  }
  async reserved(workspace, siteId) { return this.store.reserved(workspace, siteId, now().slice(0, 7)); }
  async startGeneration(workspace, topicId) {
    requireValue(this.provider?.ready, 'AI is not configured. Configure the server provider settings, or create a draft manually.', 503);
    const job = (await this.store.transaction(async () => {
      const topic = (await this.need('topic', workspace, topicId)), site = (await this.need('site', workspace, topic.siteId));
      requireValue(!site.generationPaused, 'Generation is paused for this website.', 409);
      requireValue(site.approvedLinks.length >= 3 && site.approvedLinks.some(l => l.service), 'The website needs at least three safe internal links, including a service link, before paid generation.');
      requireValue(!topic.articleId && topic.status !== 'generating', 'This topic already has a draft or an active job.', 409);
      requireValue(site.jobBudgetCents > 0 && (await this.reserved(workspace, site.id)) + site.jobBudgetCents <= site.monthlyBudgetCents, 'Not enough unreserved monthly budget.', 409);
      const monthJobs = (await this.store.list('job', workspace, site.id)).filter(j => j.createdAt.startsWith(now().slice(0, 7)));
      requireValue(new Set(monthJobs.map(j => j.topicId)).size < site.monthlyVolume || monthJobs.some(j => j.topicId === topic.id), 'Monthly generation target reached.', 409);
      const pendingArticles = (await this.store.list('article', workspace, site.id)).filter(a => ['draft', 'rejected'].includes(a.status) && (site.automation?.mode !== 'automatic' || a.automationGenerated));
      requireValue(pendingArticles.length + (await this.store.list('job', workspace, site.id)).filter(j => ['queued', 'running'].includes(j.status)).length < site.reviewCapacity, 'Review queue is at capacity.', 409);
      const previous = (await this.store.list('job', workspace, site.id)).find(j => j.topicId === topicId && j.research);
      const job = { id: randomUUID(), siteId: site.id, topicId, status: 'queued', stage: 'queued', attempts: 0, createdAt: now(), reservedCents: site.jobBudgetCents, costStatus: 'unreconciled', research: previous?.research || null, usage: [], settings: { site: this.safeSite(site), models: this.provider.models, promptVersion: '3', schemaVersion: '1', maxWritingPasses: 3, maxJobAttempts: 3 } };
      (await this.store.put('job', workspace, site.id, job)); (await this.store.put('topic', workspace, site.id, { ...topic, status: 'generating' }));
      (await this.store.audit(workspace, site.id, 'generation.queued', job.id)); return job;
    }, workspace));
    return job;
  }
  async runJob(workspace, id, { deadlineAt = Infinity } = {}) {
    if (this.running.has(id)) return;
    this.running.add(id);
    let job;
    const ensureTime = duration => {
      if (Date.now() + duration >= deadlineAt) throw Object.assign(new Error('Worker time budget reached. Progress saved for the next cron run.'), { safe: true, workerYield: true });
    };
    const time = (label, operation) => timedOperation(message => console.log(`[worker] ${now()} job=${id} ${message}`), label, operation);
    try {
      const claimStarted = Date.now();
      console.log(`[worker] ${now()} job=${id} before claiming job`);
      job = (await this.store.transaction(async () => { const j = (await this.need('job', workspace, id)); if (j.status !== 'queued') return null; const currentSite = await this.need('site', workspace, j.siteId); if (currentSite.generationPaused || (j.automationGenerated && !currentSite.automation?.enabled)) return null; j.status = 'running'; j.attempts = (j.attempts || 0) + 1; (await this.store.put('job', workspace, j.siteId, j)); return j; }, workspace));
      console.log(`[worker] ${now()} job=${id} after claiming job claimed=${!!job} elapsedMs=${Date.now() - claimStarted}`);
      if (!job) return;
      let topic = (await this.need('topic', workspace, job.topicId)); const site = { ...job.settings.site };
      const checkpoint = async patch => { Object.assign(job, patch); (await this.store.put('job', workspace, job.siteId, job)); };
      const knowledge = job.websiteKnowledge || await this.knowledge.context(workspace, site.id, `${topic.title} ${topic.brief || ''} ${site.audience || ''}`);
      site.knowledgeContext = knowledge.passages.map(passage => `URL: ${passage.url}\nTitle: ${passage.title}\nFetched: ${passage.fetchedAt}\n${passage.text}`).join('\n\n---\n\n');
      if (!job.websiteKnowledge && knowledge.passages.length) await checkpoint({ websiteKnowledge: knowledge });
      if (!job.research) {
        ensureTime(6 * 60000);
        (await checkpoint({ stage: 'research' }));
        const research = await time('AI research', () => this.provider.research(topic, site, job.settings.models.research));
        const researchUsage = (research.usages?.length ? research.usages : [research.usage]).filter(Boolean);
        (await checkpoint({ research, usage: [...job.usage, ...researchUsage.map((usage, index) => ({ stage: researchUsage.length > 1 ? `research ${index + 1}` : 'research', ...usage }))] }));
        if (topic.autoDiscover) {
          requireValue(research.selectedTopic, 'Website topic discovery returned an invalid topic. The job stopped before writing.');
          const normalized = research.selectedTopic.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
          const topics = await this.store.list('topic', workspace, site.id);
          requireValue(!topics.some(item => item.id !== topic.id && item.normalized === normalized), 'Website research selected a duplicate topic. The job stopped before writing.');
          topic = { ...topic, ...research.selectedTopic, normalized, discoveredAt: now() };
          await this.store.put('topic', workspace, site.id, topic);
          await this.store.audit(workspace, site.id, 'topic.discovered', topic.id);
          const specific = await this.knowledge.context(workspace, site.id, `${topic.title} ${topic.brief || ''}`);
          site.knowledgeContext = specific.passages.map(passage => `URL: ${passage.url}\nTitle: ${passage.title}\nFetched: ${passage.fetchedAt}\n${passage.text}`).join('\n\n---\n\n');
          await checkpoint({ websiteKnowledge: specific });
        }
      }
      requireValue(job.research.sources.length >= 2, 'Research returned fewer than two usable sources. Revise the topic and retry.');
      let content = job.candidate, validation = job.validation;
      const maxWritingPasses = Math.max(1, Math.min(3, Number(job.settings.maxWritingPasses) || 3));
      const previousPass = job.writingPass || (validation ? 1 : 0);
      const writingPasses = validation?.valid ? [] : Array.from({ length: Math.max(0, maxWritingPasses - previousPass) }, (_, index) => previousPass + index + 1);
      for (const pass of writingPasses) {
        ensureTime(4 * 60000);
        (await checkpoint({ stage: `writing ${pass}`, writingPass: pass }));
        const writingModel = pass === 1 ? job.settings.models.writing : (job.settings.models.repair || job.settings.models.writing);
        let result;
        const recordWritingCalls = async details => {
          const usages = (details.usages?.length ? details.usages : [details.usage]).filter(Boolean);
          await checkpoint({ usage: [...job.usage, ...usages.map((usage, index) => ({ ...usage, stage: `writing ${pass} call ${index + 1}` }))],
            providerDiagnostics: [...(job.providerDiagnostics || []), ...(details.diagnostics || []).map(diagnostic => ({ ...diagnostic, stage: `writing ${pass}` }))] });
        };
        try {
          result = await time(`AI writing pass=${pass}`, () => this.provider.write(topic, site, job.research, validation?.errors || [], writingModel, content));
        } catch (error) {
          await recordWritingCalls(error);
          error.callsRecorded = true;
          if (!error.formatFailure || pass === maxWritingPasses) throw error;
          validation = { valid: false, errors: ['The previous response was empty, truncated, or invalid JSON. Return a complete valid article JSON object matching the schema.'] };
          await checkpoint({ validation, lastWritingError: error.message });
          continue;
        }
        await recordWritingCalls(result);
        content = normalizeArticle(result.article);
        const sourceUrls = new Set(job.research.sources.map(s => s.url));
        validation = validateArticle(content, site);
        if (content.references.some(r => !sourceUrls.has(r.url))) validation.errors.push('Writer references must match captured research sources.');
        validation.valid = validation.errors.length === 0;
        (await checkpoint({ candidate: content, validation }));
        if (validation.valid) break;
      }
      requireValue(validation?.valid, `Draft failed validation after ${maxWritingPasses} writing attempts. Inspect the job validation details; no article was approved.`);
      if (site.imageGeneration?.autoGenerate && site.imageGeneration.provider !== 'none') {
        await checkpoint({ stage: 'images' });
        if (!content.coverImage?.url) { ensureTime(3 * 60000); const cover = await time('AI cover image', () => this.createImage(content, site, 'cover', 0)); content.coverImage = cover.image; await checkpoint({ candidate: content, usage: [...job.usage, { stage: 'cover image', ...cover.usage }] }); }
        const count = Math.min(site.imageGeneration.inlineImageCount || 0, content.sections.length);
        for (const index of this.imageSectionIndexes(content, count)) if (!content.sections[index].image?.url) { ensureTime(3 * 60000); const result = await time(`AI section image index=${index}`, () => this.createImage(content, site, 'section', index)); content.sections[index].image = result.image; await checkpoint({ candidate: content, usage: [...job.usage, { stage: `section image ${index + 1}`, ...result.usage }] }); }
      }
      (await this.store.transaction(async () => {
        const currentTopic = (await this.need('topic', workspace, topic.id));
        requireValue(!currentTopic.articleId, 'Topic already has an article.', 409);
        requireValue(!(await this.store.list('article', workspace, site.id)).some(a => a.content.slug === content.slug), 'Generated slug already exists.');
        const article = { id: randomUUID(), topicId: topic.id, siteId: site.id, status: 'draft', revision: 1, approvedRevision: null, scheduledAt: null, createdAt: now(), automationGenerated: job.automationGenerated === true, content, research: job.research };
        (await this.store.put('article', workspace, site.id, article));
        (await this.store.put('topic', workspace, site.id, { ...currentTopic, status: 'review', articleId: article.id }));
        (await checkpoint({ status: 'completed', stage: 'review', articleId: article.id, completedAt: now() }));
        (await this.store.audit(workspace, site.id, 'generation.completed', id));
      }, workspace));
    } catch (error) {
      if (job) {
        (await this.store.transaction(async () => {
          const currentSite = await this.need('site', workspace, job.siteId);
          const automatic = job.automationGenerated && currentSite.automation?.enabled && currentSite.automation?.mode === 'automatic';
          const retry = error.workerYield || (automatic && error.retryable && job.attempts < (job.settings.maxJobAttempts || 3));
          const safeMessage = error instanceof AppError || error.safe ? error.message : 'Generation failed. Check provider configuration and retry.';
          if (!error.callsRecorded) {
            job.usage = [...job.usage, ...(error.usages || []).map((usage, index) => ({ ...usage, stage: `${job.stage} call ${index + 1}` }))];
            job.providerDiagnostics = [...(job.providerDiagnostics || []), ...(error.diagnostics || []).map(diagnostic => ({ ...diagnostic, stage: job.stage }))];
          }
          const retryDelay = Math.min(15 * 60000 * Math.max(1, 2 ** (job.attempts - 1)), 3600000);
          const retryAt = retry && !error.workerYield ? new Date(Date.now() + retryDelay).toISOString() : null;
          (await this.store.put('job', workspace, job.siteId, { ...job,
            status: retry ? 'queued' : 'failed',
            stage: error.workerYield ? 'waiting for next worker pass' : retry ? `waiting to retry ${job.stage}` : `${job.stage} failed`,
            attempts: error.workerYield ? Math.max(0, job.attempts - 1) : job.attempts,
            error: error.workerYield ? null : safeMessage, providerError: error.providerError || null, retryAt,
            ...(retry ? {} : { completedAt: now() }) }));
          const topic = (await this.need('topic', workspace, job.topicId));
          (await this.store.put('topic', workspace, job.siteId, { ...topic, status: retry ? 'generating' : 'failed' }));
          (await this.store.audit(workspace, job.siteId, retry ? 'generation.retry_queued' : 'generation.failed', id));
        }, workspace));
      }
    } finally { this.running.delete(id); }
  }
  async recoverInterrupted() {
    for (const { workspace, value: job } of (await this.store.all('job'))) if (job.status === 'running') {
      (await this.store.put('job', workspace, job.siteId, { ...job, status: 'failed', error: 'Server restarted during a paid call. Check provider billing before retrying; completed research is retained.' }));
      const topic = (await this.need('topic', workspace, job.topicId)); (await this.store.put('topic', workspace, job.siteId, { ...topic, status: 'failed' }));
    }
  }
}
