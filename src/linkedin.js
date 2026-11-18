import { createHash } from 'node:crypto';
import { oauthCipher } from './facebook-login.js';

export function linkedinLogin(origin, app, request = fetch) {
  const callback = new URL('/linkedin/callback', origin).href;
  const configured = !!(app?.id && app?.secret && callback.startsWith('https:'));
  const cipher = oauthCipher('autoblog-linkedin-v1:', app?.secret, configured);
  return {
    ...cipher, configured, callback,
    authorize(state) {
      return 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
        response_type: 'code', client_id: app.id, redirect_uri: callback, state, scope: 'openid profile w_member_social'
      });
    },
    async exchange(code) {
      const response = await request('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback, client_id: app.id, client_secret: app.secret })
      });
      const token = await response.json();
      if (!response.ok || !token.access_token || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error('LinkedIn authorization failed.');
      const profile = await request('https://api.linkedin.com/v2/userinfo', {
        redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Authorization: 'Bearer ' + token.access_token }
      });
      const member = await profile.json();
      if (!profile.ok || !/^[a-zA-Z0-9_-]{1,128}$/.test(member.sub || '')) throw new Error('LinkedIn profile could not be verified.');
      return { memberId: member.sub, name: String(member.name || '').slice(0, 200), token: token.access_token, expires: Date.now() + token.expires_in * 1000 };
    }
  };
}

export function linkedinConnection(site) {
  if (!site?.linkedinApp || !site.linkedinConnection) return null;
  const account = linkedinLogin(site.linkedinApp.origin, site.linkedinApp).open(site.linkedinConnection);
  return account?.expires > Date.now() ? account : null;
}

export function linkedinFingerprint(account) {
  return account && createHash('sha256').update('linkedin:' + account.memberId).digest('hex');
}

export async function publishLinkedIn(account, post, request = fetch) {
  const response = await request('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({
      author: 'urn:li:person:' + account.memberId,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: post.text }, shareMediaCategory: 'ARTICLE',
        media: [{ status: 'READY', originalUrl: post.articleUrl, title: { text: post.title } }]
      } },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' }
    })
  });
  if (response.status === 429) throw Object.assign(new Error('LinkedIn rate limit reached. The worker will retry.'), { retryable: true });
  if (response.status !== 201) throw Object.assign(new Error('LinkedIn rejected the post. Check your connection and posting permissions.'), { rejected: [400, 401, 403, 404, 422].includes(response.status) });
  const id = response.headers.get('x-restli-id');
  if (!id || !/^urn:li:(share|ugcPost):\d+$/.test(id)) return {};
  return { id, postIds: [{ platform: 'linkedin', status: 'success', id, postUrl: 'https://www.linkedin.com/feed/update/' + id + '/' }] };
}
