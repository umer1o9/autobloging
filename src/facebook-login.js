import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function oauthCipher(prefix, secret, configured) {
  const key = createHash('sha256').update(prefix + (secret || '')).digest();
  function seal(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function open(value) {
    if (!configured || !value) return null;
    try {
      const bytes = Buffer.from(value, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]));
    } catch { return null; }
  }
  return { seal, open };
}

export function facebookAppEnvironment(app, env = process.env) {
  return app ? { ...env, FACEBOOK_APP_ID: app.id, FACEBOOK_APP_SECRET: app.secret } : env;
}

export function facebookLogin(origin, env = process.env, request = fetch) {
  const appId = env.FACEBOOK_APP_ID;
  const secret = env.FACEBOOK_APP_SECRET;
  const version = env.FACEBOOK_GRAPH_VERSION || 'v27.0';
  const configured = /^\d+$/.test(appId || '') && !!secret && /^v\d+\.\d+$/.test(version) && new URL(origin).protocol === 'https:';
  const redirect = new URL('/facebook/callback', origin).href;
  const { seal, open } = oauthCipher('autoblog-facebook-v1:', secret, configured);
  async function graph(path, query, token) {
    const response = await request('https://graph.facebook.com/' + version + path + '?' + new URLSearchParams(query), {
      redirect: 'error', signal: AbortSignal.timeout(15000), headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error('Facebook authorization failed.');
    return data;
  }
  return {
    configured, seal, open,
    authorize(state) {
      return 'https://www.facebook.com/' + version + '/dialog/oauth?' + new URLSearchParams({
        client_id: appId, redirect_uri: redirect, state, response_type: 'code',
        scope: 'pages_show_list,pages_read_engagement,pages_manage_posts'
      });
    },
    async exchange(code) {
      const token = await graph('/oauth/access_token', { client_id: appId, client_secret: secret, redirect_uri: redirect, code });
      const extended = await graph('/oauth/access_token', {
        grant_type: 'fb_exchange_token', client_id: appId, client_secret: secret, fb_exchange_token: token.access_token
      });
      return extended.access_token;
    },
    async pages(token) {
      const pages = [];
      let after;
      for (let i = 0; i < 20; i++) {
        const data = await graph('/me/accounts', { fields: 'id,name,access_token,tasks', limit: '100', ...(after ? { after } : {}) }, token);
        pages.push(...data.data.filter(page => /^\d+$/.test(page.id) && page.access_token &&
          page.tasks?.some(task => ['CREATE_CONTENT', 'MANAGE', 'PROFILE_PLUS_CREATE_CONTENT', 'PROFILE_PLUS_FULL_CONTROL'].includes(task))));
        after = data.paging?.next && data.paging?.cursors?.after;
        if (!after) break;
      }
      return pages;
    }
  };
}
