import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Domain } from '../src/domain.js';
import { publishLinkedIn, uploadLinkedInCover } from '../src/linkedin.js';
import { SocialPublishing } from '../src/social.js';
import { createSocialProvider } from '../src/social-provider.js';
import { testDatabase } from './mysql-helper.js';
import { validArticle, website } from './helpers.js';

test('social jobs wait for the public blog, publish once per destination, and preserve independent outcomes', async t => {
  const { store } = await testDatabase(t);
  const workspace = 'social-workspace';
  await store.createWorkspace(workspace, 'Social test');
  const domain = new Domain(store, { ready: false });
  const site = await domain.saveSite(workspace, website());
  const sent = [];
  let live = false;
  const destinations = ['facebook', 'linkedin', 'instagram', 'reddit', 'youtube', 'tiktok'];
  const provider = createSocialProvider({ FACEBOOK_PAGE_CONNECTIONS: JSON.stringify({ [site.id]: { pageId: '123', accessToken: 'page-token' } }) }, async (url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer page-token');
    if (request.method === 'GET') return Response.json({ id: '123', name: 'Test Page' });
    assert.match(url, /\/123\/feed$/);
    sent.push(Object.fromEntries(request.body));
    return Response.json({ id: '123_456' });
  });
  const content = validArticle({ coverImage: { url: 'https://example.org/cover.webp', alt: 'Publishing workflow' } });
  domain.social = new SocialPublishing(store, { provider, fetch: async () => ({ status: 200, type: 'text/html', body: `<h1>${live ? content.title : 'Blog home'}</h1>` }) });
  await assert.rejects(domain.social.configure(workspace, site, { platforms: ['facebook'], path: '//example.org/{slug}' }), { status: 400 });
  await domain.social.configure(workspace, site, { platforms: destinations, path: '/blog/{slug}.html', subreddit: 'permitted_sub', enabled: true });
  const view = async () => (await domain.social.view(workspace, await domain.need('site', workspace, site.id))).posts;
  const byPlatform = async () => Object.fromEntries((await view()).map(post => [post.platform, post]));
  const topic = await domain.createTopic(workspace, site.id, { title: content.title });
  const draft = await domain.createDraft(workspace, topic.id);
  const article = await domain.saveArticle(workspace, draft.id, { revision: draft.revision, content });
  assert.equal((await view()).length, 6);
  assert.ok((await view()).every(p => p.status === 'draft' && !('profileFingerprint' in p)));
  const { linkedin } = await byPlatform();
  assert.match(linkedin.text, /^How does a reviewed publishing workflow work\?\n\n/);
  assert.match(linkedin.text, /• What should reviewers check\?/);
  assert.match(linkedin.text, /Who reviews\?\n\nRead the full article\nhttps:\/\/example\.com\/blog\//);
  assert.match(linkedin.text, /#PublishingWorkflow\b/);
  assert.equal(linkedin.mediaUrl, content.coverImage.url);
  const ytDraft = (await byPlatform()).youtube;
  await assert.rejects(domain.social.edit(workspace, 'other-site', ytDraft.id, { text: 'Video description' }), { status: 404 });
  await domain.social.edit(workspace, site.id, ytDraft.id, { text: 'Video description', mediaUrl: 'https://example.org/article.mp4' });
  assert.equal(await store.acquireWorker(), true);
  await domain.social.run();
  assert.equal(sent.length, 0);
  await domain.transition(workspace, article.id, 'approve', { revision: article.revision, evidenceReviewed: true }, 'editor');
  const due = new Date(Date.now() + 100000);
  await domain.transition(workspace, article.id, 'schedule', { revision: article.revision, scheduledAt: due.toISOString() }, 'editor');
  assert.deepEqual(await domain.publishDue(due), { published: 1 });
  await domain.social.run();
  assert.equal(sent.length, 0);
  live = true;
  // Make the queued requests due without waiting for the backoff interval.
  for (const post of await view()) {
    if (post.status !== 'queued') continue;
    const [row] = await store.query('SELECT payload FROM social_posts WHERE id=?', [post.id]);
    const full = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    await domain.social.save(workspace, { ...full, nextAt: new Date(0).toISOString() });
  }
  await domain.social.run();
  await domain.social.run();
  await domain.social.run();
  const posts = await byPlatform();
  assert.equal(posts.facebook.status, 'published');
  for (const platform of destinations.filter(value => value !== 'facebook')) assert.equal(posts[platform].status, 'manual');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].link, 'https://example.com/blog/reviewed-publishing-workflow.html');
  assert.match(sent[0].message, /reviewed publishing workflow/);
  await assert.rejects(domain.social.edit(workspace, site.id, posts.instagram.id, { text: 'Instagram caption', queue: true }), { status: 409 });
  await domain.transition(workspace, article.id, 'unpublish', { revision: article.revision }, 'editor');
  await domain.social.run();
  assert.equal((await byPlatform()).instagram.status, 'cancelled');
  assert.equal(sent.length, 1);
});

test('LinkedIn uses clickable article cards for profiles and Pages', async () => {
  const cover = await sharp({ create: { width: 24, height: 12, channels: 3, background: 'teal' } }).webp().toBuffer();
  const account = { memberId: 'member-1', token: 'test-token', pageAccess: true };
  const download = async (url, origin) => {
    assert.equal(url, 'https://cdn.example.com/cover.webp');
    assert.equal(origin, 'https://cdn.example.com');
    return { status: 200, type: 'image/webp', body: cover };
  };
  const uploadUrl = 'https://www.linkedin.com/dms-uploads/example';
  const pageImage = 'urn:li:image:image1';
  for (const destination of ['', 'urn:li:organization:123']) {
    const post = { destination, mediaUrl: 'https://cdn.example.com/cover.webp', title: 'Cover test', previewDescription: 'A short description', text: 'Read https://example.com/blog/cover', articleUrl: 'https://example.com/blog/cover' };
    const calls = [];
    const request = async (url, options) => {
      calls.push(url);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      if (url.endsWith('=initializeUpload')) {
        assert.equal(JSON.parse(options.body).initializeUploadRequest.owner, destination);
        return Response.json({ value: { image: pageImage, uploadUrl } });
      }
      if (url === uploadUrl) {
        assert.equal(options.method, 'PUT');
        assert.equal(options.redirect, 'error');
        assert.equal((await sharp(options.body).metadata()).format, 'jpeg');
        return new Response(null, { status: 201 });
      }
      const body = JSON.parse(options.body);
      if (destination) assert.deepEqual(body.content.article, { source: post.articleUrl, title: post.title, description: post.previewDescription, thumbnail: pageImage });
      else {
        const share = body.specificContent['com.linkedin.ugc.ShareContent'];
        assert.equal(share.shareMediaCategory, 'ARTICLE');
        assert.deepEqual(share.media, [{
          status: 'READY', originalUrl: post.articleUrl, title: { text: post.title },
          description: { text: post.previewDescription }
        }]);
        assert.equal(share.shareCommentary.text, post.text);
      }
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:ugcPost:123' } });
    };
    const coverId = destination ? await uploadLinkedInCover(account, post, download, request) : 'urn:li:digitalmediaAsset:legacy';
    assert.equal((await publishLinkedIn(account, { ...post, coverId }, request)).id, 'urn:li:ugcPost:123');
    assert.equal(calls.length, destination ? 3 : 1);
  }
});
