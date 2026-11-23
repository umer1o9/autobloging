import { linkedinConnection, linkedinFingerprint, linkedinDestinations, linkedinTargetSelected, publishLinkedIn, uploadLinkedInCover } from './linkedin.js';
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

function linkedinCaption(content, articleUrl) {
  const unique = lines => [...new Map(lines.filter(Boolean).map(line => [line.toLowerCase(), line])).values()];
  const questions = unique((content.faqs || []).map(item => plain(item.question))).slice(0, 2)
    .map(question => clip(question, 149).replace(/[.!?…]+$/, '') + '?');
  const title = plain(content.title);
  const lead = title.endsWith('?') ? title : questions.shift() || title;
  const summary = clip(plain(content.excerpt || content.directAnswer || content.metaDescription), 400);
  const keyword = plain(content.primaryKeyword);
  const keywordLine = keyword && ![lead, title, summary].join(' ').toLowerCase().includes(keyword.toLowerCase())
    ? 'This guide covers ' + clip(keyword, 100) + '.' : '';
  const takeaways = unique((content.sections || []).map(section => plain(section.heading))).slice(0, 3)
    .map(heading => '• ' + clip(heading, 110));
  const tags = unique([keyword, ...(content.tags || []), content.category].map(tag =>
    (plain(tag).match(/[\p{L}\p{N}]+/gu) || []).map(word => word[0].toUpperCase() + word.slice(1)).join('')
  ).filter(tag => tag.length <= 48 && /\p{L}/u.test(tag))).slice(0, 5).map(tag => '#' + tag);
  return [
    lead,
    [lead !== title ? title : '', summary, keywordLine].filter(Boolean).join('\n'),
    takeaways.length ? ['In the guide', ...takeaways].join('\n') : '',
    questions.find(question => question.toLowerCase() !== lead.toLowerCase()) || 'What has worked for your team?',
    'Read the full article\n' + articleUrl,
    tags.join(' ')
  ].filter(Boolean).join('\n\n');
}

export class SocialPublishing {
  constructor(store, { provider = createSocialProvider(), fetch = fetchWebsite } = {}) {
    this.store = store;
    this.provider = provider;
    this.fetch = fetch;
  }

  facebookCredentials(site) {
    return site?.facebookConnection ? { token: site.facebookConnection, app: site.facebookApp } : null;
  }

  fingerprint(site, platform, destination = '') {
    return platform === 'linkedin' ? linkedinFingerprint(linkedinConnection(site), destination) : this.provider.fingerprint(site.id, this.facebookCredentials(site));
  }

  supports(platform) {
    return platform === 'linkedin' || this.provider.supports(platform);
  }

  async publishedLinkedInArticleIds(workspace) {
    const rows = await this.store.query(
      "SELECT DISTINCT article_id AS articleId FROM social_posts WHERE workspace_id=? AND platform='linkedin' AND status='published'",
      [workspace]
    );
    return new Set(rows.map(({ articleId }) => articleId));
  }

  async view(workspace, site) {
    const rows = await this.store.query('SELECT payload FROM social_posts WHERE workspace_id=? AND site_id=? ORDER BY next_at DESC,id DESC LIMIT 100', [workspace, site.id]);
    return { settings: {
      enabled: site.social?.enabled === true,
      platforms: site.social?.platforms || [],
      linkedinDestinations: linkedinDestinations(site),
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
    const destinations = input.linkedinDestinations ?? linkedinDestinations(site);
    if (!Array.isArray(destinations) || destinations.length > 101 || destinations.some(id => typeof id !== 'string' || (id !== 'profile' && !site.linkedinPages?.some(page => page.id === id)))) throw problem(400, 'Choose LinkedIn destinations from the available profile and Pages.');
    const selectedLinkedIn = [...new Set(destinations)];
    if (selected.includes('linkedin') && !selectedLinkedIn.length) throw problem(400, 'Select at least one LinkedIn profile or Page.');
    if (selected.includes('linkedin') && selectedLinkedIn.some(id => id !== 'profile') && !linkedinConnection(site)?.pageAccess) throw problem(409, 'Connect LinkedIn with approved Page permissions first.');
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
      if (selected.includes('linkedin') && selectedLinkedIn.some(id => id !== 'profile' && !current.linkedinPages?.some(page => page.id === id))) throw problem(409, 'LinkedIn Pages changed. Reload the destination list.');
      current.social = { enabled, platforms: selected, linkedinDestinations: selectedLinkedIn, path, subreddit, flairId };
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
      linkedin: [linkedinCaption(article.content, articleUrl)],
      reddit: [clip(summary, 700), `Source and full article: ${articleUrl}`],
      tiktok: [clip(summary, 140), `Full article on ${new URL(site.url).hostname}.`],
      youtube: [clip(summary, 700), `Read the full article: ${articleUrl}`]
    };
    const destinations = settings.platforms.flatMap(platform => platform === 'linkedin' ? linkedinDestinations(site).map(id => ({ platform, destination: id === 'profile' ? '' : id })) : [{ platform, destination: '' }]);
    for (const { platform, destination } of destinations) {
      const [row] = await this.store.query('SELECT payload FROM social_posts WHERE article_id=? AND platform=? AND destination=?', [article.id, platform, destination]);
      const previous = row && parse(row.payload);
      if (previous && (!['draft', 'cancelled'].includes(previous.status) || previous.providerId)) continue;
      const release = publish && settings.enabled && this.supports(platform) && (platform !== 'linkedin' || !!site.linkedinConnection);
      const edited = previous?.edited === true && previous.revision === article.revision && previous.articleUrl === articleUrl;
      const post = {
        id: previous?.id || randomUUID(), siteId: site.id, articleId: article.id, platform, destination, destinationName: platform === 'linkedin' ? (destination ? site.linkedinPages?.find(page => page.id === destination)?.name || destination : linkedinConnection(site)?.name || 'Personal profile') : '', title, articleUrl,
        text: edited ? previous.text : hooks[platform].filter(Boolean).join('\n\n'),
        ...(platform === 'linkedin' ? { previewDescription: clip(summary, 256) } : {}),
        edited,
        mediaUrl: edited ? previous.mediaUrl : (['instagram', 'tiktok', 'linkedin'].includes(platform) ? httpsUrl(article.content.coverImage?.url) : ''),
        status: release ? 'queued' : publish && (!this.supports(platform) || (platform === 'linkedin' && !site.linkedinConnection)) ? 'manual' : 'draft', nextAt: time(), attempts: 0,
        revision: article.revision,
        profileFingerprint: release ? this.fingerprint(site, platform, destination) : null,
        subreddit: settings.subreddit, flairId: settings.flairId
      };
      if (previous) await this.save(workspace, post);
      else await this.store.query('INSERT INTO social_posts (id,workspace_id,site_id,article_id,platform,destination,status,next_at,payload) VALUES (?,?,?,?,?,?,?,?,?)',
        [post.id, workspace, site.id, article.id, platform, destination, post.status, post.nextAt, JSON.stringify(post)]);
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
      const mediaUrl = input.mediaUrl === undefined && post.platform === 'linkedin' && !post.destination
        ? post.mediaUrl || '' : httpsUrl(String(input.mediaUrl || '').trim());
      if (input.mediaUrl && !mediaUrl) throw problem(400, 'Use a public HTTPS media URL.');
      Object.assign(post, { text, mediaUrl, edited: true });
      if (input.queue === true) {
        const article = await this.store.get('article', workspace, post.articleId);
        const site = await this.store.get('site', workspace, siteId);
        const fingerprint = this.fingerprint(site, post.platform, post.destination);
        if (article?.status !== 'published' || post.revision !== article.revision || !site.social?.enabled || (!site.social.platforms.includes(post.platform) || (post.platform === 'linkedin' && !linkedinTargetSelected(site, post))) || !fingerprint) {
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
      const fingerprint = site && this.fingerprint(site, post.platform, post.destination);
      if (submitted) return await update('uncertain', { error: 'Check the original provider’s post history.' });
      if (article?.status !== 'published' || article.revision !== post.revision || !site?.social?.enabled || (!site.social.platforms.includes(post.platform) || (post.platform === 'linkedin' && !linkedinTargetSelected(site, post)))) {
        return await update('cancelled', { error: 'The article or destination is no longer enabled for this post.' });
      }
      if (!this.supports(post.platform) || !fingerprint || post.profileFingerprint !== fingerprint) return await update('needs_attention', { error: 'The social account connection changed or expired. Review the post before sending.' });
      let live = false;
      let mediaUrl = post.mediaUrl;
      let previewDescription = post.previewDescription;
      try {
        const page = await this.fetch(post.articleUrl, new URL(site.url).origin, { timeout: 6000, maxBytes: 1048576 });
        if (page.status === 200 && /html/.test(page.type)) {
          const html = load(page.body);
          const title = plain(post.title).toLowerCase();
          live = html('h1').toArray().some(element => plain(html(element).text()).toLowerCase() === title);
          if (live && post.platform === 'linkedin') {
            const previewImage = html('meta[property="og:image"]').first().attr('content');
            if (!mediaUrl && !post.destination && previewImage) {
              mediaUrl = httpsUrl(URL.parse(previewImage, page.url || post.articleUrl)?.href);
            }
            previewDescription ||= clip(plain(html('meta[property="og:description"]').first().attr('content')), 256);
          }
        }
      } catch { /* The receiving website may still be deploying the article. */ }
      if (!live) {
        const attempts = post.attempts + 1;
        return await update(attempts < 12 ? 'queued' : 'needs_attention', { attempts, nextAt: after(5 * 60000), error: 'Waiting for the article URL to return a page with the article title as its main heading.' });
      }
      if (!this.store.workerActive) return;
      const linkedIn = post.platform === 'linkedin' ? linkedinConnection(site) : null;
      const coverId = linkedIn && mediaUrl ? await uploadLinkedInCover(linkedIn, { ...post, mediaUrl }, this.fetch) : '';
      if (!this.store.workerActive) return;
      const claimed = await this.store.transaction(async () => {
        const [row] = await this.store.query('SELECT payload FROM social_posts WHERE workspace_id=? AND id=?', [workspace, post.id]);
        const latest = row && parse(row.payload);
        const activeSite = await this.store.get('site', workspace, post.siteId);
        const activeArticle = await this.store.get('article', workspace, post.articleId);
        if (!latest || latest.status !== 'queued' || latest.nextAt !== post.nextAt || !activeSite?.social?.enabled || (!activeSite.social.platforms.includes(post.platform) || (post.platform === 'linkedin' && !linkedinTargetSelected(activeSite, post))) || activeArticle?.status !== 'published' || activeArticle.revision !== post.revision) return false;
        if (this.fingerprint(activeSite, post.platform, post.destination) !== fingerprint) return false;
        return update('sending', { nextAt: after(120000), error: null });
      }, workspace);
      if (!claimed) return;
      if (!this.store.workerActive) return await update('queued', { nextAt: time() });
      submitted = true;
      const result = post.platform === 'linkedin'
        ? await publishLinkedIn(linkedIn, { ...post, coverId, previewDescription })
        : await this.provider.publish(post.siteId, { post: post.text, platforms: [post.platform], articleUrl: post.articleUrl }, this.facebookCredentials(site));
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
