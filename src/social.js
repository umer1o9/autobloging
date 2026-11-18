import { linkedinConnection, linkedinFingerprint, publishLinkedIn } from './linkedin.js';
import { randomUUID } from 'node:crypto';
import { load } from 'cheerio';
import { createSocialProvider } from './social-provider.js';
import { fetchWebsite } from './website-fetch.js';
import { httpUrl } from './content.js';

const platforms = ['facebook', 'instagram', 'linkedin', 'reddit', 'tiktok', 'youtube'];
const time = () => new Date().toISOString();
const after = ms => new Date(Date.now() + ms).toISOString();
const parse = payload => typeof payload === 'string' ? JSON.parse(payload) : payload;
const problem = (status, message) => Object.assign(new Error(message), { status });
const plain = value => String(value || '').replace(/\s+/g, ' ').trim();
const clip = (value, limit) => Array.from(value).slice(0, limit).join('');
const httpsUrl = value => { const url = httpUrl(value); return url?.startsWith('https://') ? url : ''; };

export class SocialPublishing {
  constructor(store, { provider = createSocialProvider(), fetch = fetchWebsite } = {}) {
    this.store = store;
    this.provider = provider;
    this.fetch = fetch;
  }

  facebookCredentials(site) {
    return site?.facebookConnection ? { token: site.facebookConnection, app: site.facebookApp } : null;
  }

  fingerprint(site, platform) {
    return platform === 'linkedin' ? linkedinFingerprint(linkedinConnection(site)) : this.provider.fingerprint(site.id, this.facebookCredentials(site));
  }

  supports(platform) {
    return platform === 'linkedin' || this.provider.supports(platform);
  }

  async view(workspace, site) {
    const rows = await this.store.query('SELECT payload FROM social_posts WHERE workspace_id=? AND site_id=? ORDER BY next_at DESC,id DESC LIMIT 100', [workspace, site.id]);
    return { settings: {
      enabled: site.social?.enabled === true,
      platforms: site.social?.platforms || [],
      path: site.social?.path || '',
      subreddit: site.social?.subreddit || '',
      flairId: site.social?.flairId || ''
    }, providerConfigured: !!this.provider.fingerprint(site.id, this.facebookCredentials(site)), posts: rows.map(({ payload }) => {
      const { profileFingerprint, ...post } = parse(payload);
      return post;
    }) };
  }

  async connectedAccounts(site) {
    if (!this.provider.fingerprint(site.id, this.facebookCredentials(site))) throw problem(409, 'Configure this website’s Facebook Page connection first.');
    try { return (await this.provider.accounts(site.id, this.facebookCredentials(site))).filter(platform => platforms.includes(platform)); }
    catch { throw problem(502, 'Could not verify this Facebook Page. Check the Page ID and access token.'); }
  }

  async configure(workspace, site, input) {
    const selected = Array.isArray(input.platforms) ? [...new Set(input.platforms)] : [];
    if (selected.some(platform => !platforms.includes(platform))) throw problem(400, 'Choose supported social destinations.');
    const path = String(input.path || '').trim();
    if ((path || selected.length) && (!/^\/[a-zA-Z0-9/_-]*\{slug\}[a-zA-Z0-9/_.-]*$/.test(path) || path.startsWith('//') || path.length > 180)) {
      throw problem(400, 'Enter a public article path such as /blog/{slug} or /blog/{slug}.html.');
    }
    const subreddit = String(input.subreddit || '').trim().replace(/^\/?r\//i, '');
    const flairId = String(input.flairId || '').trim();
    if (selected.includes('reddit') && !/^[a-zA-Z0-9_]{2,21}$/.test(subreddit)) throw problem(400, 'Enter a subreddit that permits automated posts.');
    if (flairId && !/^[\w-]{1,100}$/.test(flairId)) throw problem(400, 'Enter a valid Reddit flair ID.');
    const enabled = input.enabled === true;
    const automatic = selected.filter(platform => this.supports(platform) && (platform !== 'linkedin' || linkedinConnection(site)));
    if (enabled && !automatic.length) throw problem(400, 'Select Facebook or LinkedIn to enable automatic publishing.');
    if (enabled) {
      if (automatic.includes('linkedin') && !linkedinConnection(site)) throw problem(409, 'Connect your LinkedIn profile first.');
      if (automatic.includes('facebook')) await this.connectedAccounts(site);
    }
    await this.store.transaction(async () => {
      const current = await this.store.get('site', workspace, site.id);
      current.social = { enabled, platforms: selected, path, subreddit, flairId };
      await this.store.put('site', workspace, site.id, current);
      await this.store.audit(workspace, site.id, 'social.settings_updated', site.id);
    }, workspace);
  }

  async save(workspace, post) {
    await this.store.query('UPDATE social_posts SET status=?,next_at=?,payload=? WHERE workspace_id=? AND id=?',
      [post.status, post.nextAt, JSON.stringify(post), workspace, post.id]);
  }

  async cancelQueued(workspace, articleId) {
    const rows = await this.store.query("SELECT payload FROM social_posts WHERE workspace_id=? AND article_id=? AND status IN ('queued','needs_attention','manual')", [workspace, articleId]);
    for (const row of rows) await this.save(workspace, { ...parse(row.payload), status: 'cancelled', error: 'The article was unpublished.' });
  }

  async prepare(workspace, site, article, publish = false) {
    const settings = site.social;
    if (!settings?.platforms?.length || !article.content.slug) return;
    const articleUrl = new URL(settings.path.replace('{slug}', encodeURIComponent(article.content.slug)), site.url).href;
    const title = plain(article.content.title);
    const summary = plain(article.content.excerpt || article.content.directAnswer);
    const hooks = {
      facebook: [title, clip(summary, 360), `Read the article: ${articleUrl}`],
      instagram: [title, clip(summary, 550), `Full article on ${new URL(site.url).hostname}.`],
      linkedin: [title, clip(summary, 650), `Read the full article: ${articleUrl}`],
      reddit: [clip(summary, 700), `Source and full article: ${articleUrl}`],
      tiktok: [clip(summary, 140), `Full article on ${new URL(site.url).hostname}.`],
      youtube: [clip(summary, 700), `Read the full article: ${articleUrl}`]
    };
    for (const platform of settings.platforms) {
      const [row] = await this.store.query('SELECT payload FROM social_posts WHERE article_id=? AND platform=?', [article.id, platform]);
      const previous = row && parse(row.payload);
      if (previous && (!['draft', 'cancelled'].includes(previous.status) || previous.providerId)) continue;
      const release = publish && settings.enabled && this.supports(platform) && (platform !== 'linkedin' || !!site.linkedinConnection);
      const edited = previous?.edited === true && previous.revision === article.revision && previous.articleUrl === articleUrl;
      const post = {
        id: previous?.id || randomUUID(), siteId: site.id, articleId: article.id, platform, title, articleUrl,
        text: edited ? previous.text : hooks[platform].filter(Boolean).join('\n\n'),
        edited,
        mediaUrl: edited ? previous.mediaUrl : (['instagram', 'tiktok'].includes(platform) ? httpsUrl(article.content.coverImage?.url) : ''),
        status: release ? 'queued' : publish && (!this.supports(platform) || (platform === 'linkedin' && !site.linkedinConnection)) ? 'manual' : 'draft', nextAt: time(), attempts: 0,
        revision: article.revision,
        profileFingerprint: release ? this.fingerprint(site, platform) : null,
        subreddit: settings.subreddit, flairId: settings.flairId
      };
      if (previous) await this.save(workspace, post);
      else await this.store.query('INSERT INTO social_posts (id,workspace_id,site_id,article_id,platform,status,next_at,payload) VALUES (?,?,?,?,?,?,?,?)',
        [post.id, workspace, site.id, article.id, platform, post.status, post.nextAt, JSON.stringify(post)]);
    }
  }

  async edit(workspace, siteId, id, input) {
    await this.store.transaction(async () => {
      const [row] = await this.store.query('SELECT payload FROM social_posts WHERE id=? AND workspace_id=? AND site_id=?', [id, workspace, siteId]);
      if (!row) throw problem(404, 'Social post not found.');
      const post = parse(row.payload);
      if (!['draft', 'needs_attention', 'manual'].includes(post.status)) throw problem(409, 'This social post cannot be edited in its current state.');
      const text = String(input.text || '').trim();
      const max = post.platform === 'tiktok' ? 220 : 2000;
      if (!text || Array.from(text).length > max) throw problem(400, `Use between 1 and ${max} characters.`);
      const mediaUrl = httpsUrl(String(input.mediaUrl || '').trim());
      if (input.mediaUrl && !mediaUrl) throw problem(400, 'Use a public HTTPS media URL.');
      Object.assign(post, { text, mediaUrl, edited: true });
      if (input.queue === true) {
        const article = await this.store.get('article', workspace, post.articleId);
        const site = await this.store.get('site', workspace, siteId);
        const fingerprint = this.fingerprint(site, post.platform);
        if (article?.status !== 'published' || post.revision !== article.revision || !site.social?.enabled || !site.social.platforms.includes(post.platform) || !fingerprint) {
          throw problem(409, 'Publish the current article and enable its connected social destination first.');
        }
        if (!this.supports(post.platform)) throw problem(409, 'Copy this draft and publish it on the social platform.');
        if (post.providerId) throw problem(409, 'Check the submitted post in the social platform before sending it again.');
        Object.assign(post, { status: 'queued', nextAt: time(), error: null, attempts: 0, profileFingerprint: fingerprint });
      }
      await this.save(workspace, post);
    }, workspace);
  }

  async run() {
    if (!this.store.workerActive) return;
    // A stopped worker may have sent a request before it saved the response.
    // Quarantine stale sends instead of risking a second public post.
    const rows = await this.store.query("SELECT workspace_id,payload FROM social_posts WHERE status IN ('queued','pending','sending') AND next_at<=? ORDER BY next_at,id LIMIT 3", [time()]);
    for (const row of rows) {
      if (!this.store.workerActive) break;
      await this.process(row.workspace_id, parse(row.payload));
    }
  }

  async process(workspace, candidate) {
    const post = await this.store.transaction(async () => {
      const [row] = await this.store.query('SELECT payload FROM social_posts WHERE workspace_id=? AND id=?', [workspace, candidate.id]);
      const current = row && parse(row.payload);
      if (!current || current.status !== candidate.status || current.nextAt !== candidate.nextAt) return null;
      if (current.status === 'sending') {
        await this.save(workspace, { ...current, status: 'uncertain', error: 'A previous send was interrupted. Check the social platform history.' });
        return null;
      }
      return current;
    }, workspace);
    if (!post) return;
    let submitted = post.status === 'pending';
    let expectedStatus = post.status;
    let expectedAt = post.nextAt;
    const update = async (status, fields = {}) => {
      const next = { ...post, ...fields, status };
      const result = await this.store.query('UPDATE social_posts SET status=?,next_at=?,payload=? WHERE workspace_id=? AND id=? AND status=? AND next_at=?',
        [status, next.nextAt, JSON.stringify(next), workspace, post.id, expectedStatus, expectedAt]);
      if (!result.affectedRows) return false;
      expectedStatus = status;
      expectedAt = next.nextAt;
      return true;
    };
    try {
      const site = await this.store.get('site', workspace, post.siteId);
      const article = await this.store.get('article', workspace, post.articleId);
      const fingerprint = site && this.fingerprint(site, post.platform);
      if (submitted) return await update('uncertain', { error: 'Check the original provider’s post history.' });
      if (article?.status !== 'published' || article.revision !== post.revision || !site?.social?.enabled || !site.social.platforms.includes(post.platform)) {
        return await update('cancelled', { error: 'The article or destination is no longer enabled for this post.' });
      }
      if (!this.supports(post.platform) || !fingerprint || post.profileFingerprint !== fingerprint) return await update('needs_attention', { error: 'The social account connection changed or expired. Review the post before sending.' });
      let live = false;
      try {
        const page = await this.fetch(post.articleUrl, new URL(site.url).origin, { timeout: 6000, maxBytes: 1048576 });
        if (page.status === 200 && /html/.test(page.type)) {
          const html = load(page.body);
          const title = plain(post.title).toLowerCase();
          live = html('h1').toArray().some(element => plain(html(element).text()).toLowerCase() === title);
        }
      } catch { /* The receiving website may still be deploying the article. */ }
      if (!live) {
        const attempts = post.attempts + 1;
        return await update(attempts < 12 ? 'queued' : 'needs_attention', { attempts, nextAt: after(5 * 60000), error: 'Waiting for the article URL to return a page with the article title as its main heading.' });
      }
      if (!this.store.workerActive) return;
      const claimed = await this.store.transaction(async () => {
        const [row] = await this.store.query('SELECT payload FROM social_posts WHERE workspace_id=? AND id=?', [workspace, post.id]);
        const latest = row && parse(row.payload);
        const activeSite = await this.store.get('site', workspace, post.siteId);
        const activeArticle = await this.store.get('article', workspace, post.articleId);
        if (!latest || latest.status !== 'queued' || latest.nextAt !== post.nextAt || !activeSite?.social?.enabled || !activeSite.social.platforms.includes(post.platform) || activeArticle?.status !== 'published' || activeArticle.revision !== post.revision) return false;
        if (this.fingerprint(activeSite, post.platform) !== fingerprint) return false;
        return update('sending', { nextAt: after(120000), error: null });
      }, workspace);
      if (!claimed) return;
      if (!this.store.workerActive) return await update('queued', { nextAt: time() });
      submitted = true;
      const result = post.platform === 'linkedin' ? await publishLinkedIn(linkedinConnection(site), post) : await this.provider.publish(post.siteId, { post: post.text, platforms: [post.platform], articleUrl: post.articleUrl }, this.facebookCredentials(site));
      const detail = result.postIds?.find(item => item.platform === post.platform);
      const providerId = typeof result.id === 'string' ? result.id : post.providerId;
      if (detail?.status === 'success' && detail.id && !['pending', 'failed'].includes(detail.id)) {
        return await update('published', { providerId, postUrl: httpsUrl(detail.postUrl), error: null });
      }
      return await update('uncertain', { providerId, error: 'The platform did not confirm publication. Check the account before sending again.' });
    } catch (error) {
      if (error.retryable) return await update(post.attempts < 12 ? post.status : (post.providerId ? 'uncertain' : 'needs_attention'), { attempts: post.attempts + 1, nextAt: after(5 * 60000), error: error.message });
      if (error.setup || error.rejected) return await update(post.providerId ? 'uncertain' : 'needs_attention', { error: error.message });
      if (!submitted) throw error;
      return await update('uncertain', { error: 'Could not confirm the request. Check the social platform history before sending again.' });
    }
  }
}
