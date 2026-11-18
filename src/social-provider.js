import { facebookLogin, facebookAppEnvironment } from './facebook-login.js';
import { createHash } from 'node:crypto';

export function createSocialProvider(env = process.env, request = fetch) {
  let pages;
  try { pages = JSON.parse(env.FACEBOOK_PAGE_CONNECTIONS || '{}'); } catch { pages = {}; }
  const version = env.FACEBOOK_GRAPH_VERSION || 'v27.0';
  const connection = (siteId, encrypted) => {
    if (encrypted) {
      const credentials = facebookAppEnvironment(encrypted.app, env);
      const origin = encrypted.app?.origin || env.APP_ORIGIN || 'http://localhost:3210';
      return facebookLogin(origin, credentials, request).open(encrypted.token);
    }
    const page = Object.hasOwn(pages || {}, siteId) ? pages[siteId] : null;
    if (!/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(page?.pageId) ||
        typeof page?.accessToken !== 'string' || !/^\S+$/.test(page.accessToken)) return null;
    return page;
  };
  const fingerprint = (siteId, encrypted) => {
    const page = connection(siteId, encrypted);
    return page ? createHash('sha256').update(JSON.stringify([page.pageId, page.accessToken])).digest('hex') : null;
  };
  async function graph(siteId, encrypted, path, body) {
    const page = connection(siteId, encrypted);
    if (!page) throw Object.assign(new Error('Configure this website’s Facebook Page access token on the server.'), { setup: true });
    const response = await request('https://graph.facebook.com/' + version + '/' + page.pageId + path, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15000), redirect: 'error',
      headers: { Authorization: 'Bearer ' + page.accessToken },
      ...(body ? { body: new URLSearchParams(body) } : {})
    });
    const data = await response.json();
    if (response.status === 429) throw Object.assign(new Error('Facebook rate limit reached. The worker will retry.'), { retryable: true });
    if (!response.ok || data.error) {
      throw Object.assign(new Error('Facebook rejected the request. Check the Page token, permissions and Page access.'), {
        rejected: [400, 401, 403, 404].includes(response.status)
      });
    }
    return data;
  }
  return {
    fingerprint,
    supports: platform => platform === 'facebook',
    async accounts(siteId, encrypted) {
      const page = await graph(siteId, encrypted, '?fields=id,name');
      if (page.id !== String(connection(siteId, encrypted).pageId)) throw new Error('Facebook Page ID did not match.');
      return ['facebook'];
    },
    async publish(siteId, payload, encrypted) {
      if (payload.platforms[0] !== 'facebook') throw new Error('Unsupported automatic destination.');
      const result = await graph(siteId, encrypted, '/feed', { message: payload.post, link: payload.articleUrl });
      if (typeof result.id !== 'string' || !/^\d+(?:_\d+)?$/.test(result.id)) return {};
      return { id: result.id, postIds: [{ platform: 'facebook', status: 'success', id: result.id, postUrl: 'https://www.facebook.com/' + result.id }] };
    }
  };
}
