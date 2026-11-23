import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { oauthCipher } from './facebook-login.js';
import { fetchWebsite } from './website-fetch.js';

export function linkedinLogin(origin, app, request = fetch) {
  const callback = new URL('/linkedin/callback', origin).href;
  const configured = !!(app?.id && app?.secret && callback.startsWith('https:'));
  const cipher = oauthCipher('autoblog-linkedin-v1:', app?.secret, configured);
  return {
    ...cipher, configured, callback,
    authorize(state) {
      return 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({
        response_type: 'code', client_id: app.id, redirect_uri: callback, state,
        scope: 'openid profile w_member_social' + (app.pageAccess ? ' rw_organization_admin w_organization_social' : '')
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
      return { memberId: member.sub, name: String(member.name || '').slice(0, 200), token: token.access_token, pageAccess: app.pageAccess === true, expires: Date.now() + token.expires_in * 1000 };
    }
  };
}

export function linkedinConnection(site) {
  if (!site?.linkedinApp || !site.linkedinConnection) return null;
  const account = oauthCipher('autoblog-linkedin-v1:', site.linkedinApp.secret, !!(site.linkedinApp.id && site.linkedinApp.secret)).open(site.linkedinConnection);
  return account?.expires > Date.now() ? account : null;
}

export function linkedinFingerprint(account, destination = '') {
  return account && createHash('sha256').update('linkedin:' + account.memberId + (destination ? ':' + destination : '')).digest('hex');
}

export function linkedinDestinations(site) {
  return site.social?.linkedinDestinations ?? ['profile'];
}

export function linkedinTargetSelected(site, post) {
  return linkedinDestinations(site).includes(post.destination || 'profile') &&
    (!post.destination || (linkedinConnection(site)?.pageAccess && site.linkedinPages?.some(page => page.id === post.destination)));
}

const pageHeaders = token => ({ Authorization: 'Bearer ' + token, 'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202610', 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' });

export async function linkedinPages(account, request = fetch) {
  if (!account?.pageAccess) throw Object.assign(new Error('Enable approved LinkedIn Page permissions in Configure LinkedIn app, then reconnect LinkedIn.'), { status: 409 });
  const pages = new Map();
  for (let start = 0; ; start += 100) {
    const response = await request('https://api.linkedin.com/rest/organizationAcls?' + new URLSearchParams({ q: 'roleAssignee', state: 'APPROVED', count: '100', start: String(start) }), {
      headers: pageHeaders(account.token), redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Object.assign(new Error(response.status === 403 ? 'LinkedIn denied Page access. Check Community Management API approval and reconnect with Page permissions.' : 'Could not load LinkedIn Pages. Try again.'), { status: response.status === 403 ? 409 : 502 });
    const data = await response.json();
    if (!Array.isArray(data.elements)) throw Object.assign(new Error('LinkedIn returned an invalid Page list.'), { status: 502 });
    for (const item of data.elements) {
      if (item.state === 'APPROVED' && ['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR'].includes(item.role) && /^urn:li:organization:\d+$/.test(item.organization)) pages.set(item.organization, { id: item.organization });
    }
    if (!data.paging?.links?.some(link => link.rel === 'next')) break;
    if (start >= 9900) throw Object.assign(new Error('LinkedIn returned too many Pages. Contact support.'), { status: 502 });
  }
  for (const page of pages.values()) {
    const id = page.id.split(':').at(-1);
    const response = await request('https://api.linkedin.com/rest/organizations/' + id, { headers: pageHeaders(account.token), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Object.assign(new Error('Could not read LinkedIn Page details. Try refreshing Pages.'), { status: 502 });
    const organization = await response.json();
    page.name = String(organization.localizedName || organization.vanityName || 'LinkedIn Page ' + id).slice(0, 200);
  }
  return [...pages.values()];
}

const memberHeaders = token => ({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' });
const coverError = (message, retryable = false) => Object.assign(new Error(message), { retryable, setup: !retryable });
const coverTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function uploadLinkedInCover(account, post, download = fetchWebsite, request = fetch) {
  const source = URL.parse(post.mediaUrl);
  if (source?.protocol !== 'https:') throw coverError('Use a public HTTPS URL for the LinkedIn cover.');
  let image;
  try {
    image = await download(source.href, source.origin, {
      accept: coverTypes.join(','), timeout: 10000, maxBytes: 25 * 1024 * 1024
    });
  } catch {
    throw coverError('Could not download the LinkedIn cover. Check that the cover URL is publicly reachable.', true);
  }
  if (image.status === 404 || image.status === 429 || image.status >= 500) {
    throw coverError('The LinkedIn cover URL is temporarily unavailable. The worker will retry.', true);
  }
  if (image.status !== 200 || !coverTypes.includes(image.type?.split(';')[0].trim())) {
    throw coverError('Use a public JPEG, PNG, WebP, or GIF URL for the LinkedIn cover.');
  }
  let jpeg;
  try {
    const input = sharp(image.body, { limitInputPixels: 36_000_000 });
    const { format } = await input.metadata();
    if (!coverTypes.includes('image/' + format)) throw new Error('Unsupported cover format');
    jpeg = await input.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 86 }).toBuffer();
  } catch {
    throw coverError('The article cover could not be read as an image. Replace the cover URL in the LinkedIn draft.');
  }

  const coverRequest = async (url, options) => {
    let response;
    try {
      response = await request(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch {
      throw coverError('LinkedIn’s cover upload is temporarily unavailable. The worker will retry.', true);
    }
    if (!response.ok) throw coverError('LinkedIn could not accept the cover image. Check the post and account permissions.', response.status === 429 || response.status >= 500);
    return response;
  };
  const registration = await coverRequest('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST', headers: pageHeaders(account.token),
    body: JSON.stringify({ initializeUploadRequest: { owner: post.destination } })
  });
  const value = (await registration.json().catch(() => null))?.value;
  const coverId = value?.image;
  const target = URL.parse(value?.uploadUrl || '');
  if (!/^urn:li:image:[\w-]+$/.test(coverId || '') || !target || !['https://api.linkedin.com', 'https://www.linkedin.com'].includes(target.origin) || target.username || target.password) {
    throw coverError('LinkedIn returned an invalid cover upload target. Review the post before retrying.');
  }
  await coverRequest(target.href, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + account.token, 'Content-Type': 'image/jpeg' }, body: jpeg
  });
  return coverId;
}

export async function publishLinkedIn(account, post, request = fetch) {
  const page = post.destination;
  if (page && (!/^urn:li:organization:\d+$/.test(page) || !account.pageAccess)) throw Object.assign(new Error('Reconnect LinkedIn with approved Page publishing access.'), { setup: true });
  const article = { source: post.articleUrl, title: post.title };
  if (post.previewDescription) article.description = post.previewDescription;
  if (post.coverId) article.thumbnail = post.coverId;
  const memberArticle = { status: 'READY', originalUrl: post.articleUrl, title: { text: post.title } };
  if (post.previewDescription) memberArticle.description = { text: post.previewDescription };
  const response = await request(page ? 'https://api.linkedin.com/rest/posts' : 'https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: page ? pageHeaders(account.token) : memberHeaders(account.token),
    body: JSON.stringify(page ? {
      author: page, commentary: post.text, visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { article },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false
    } : {
      author: 'urn:li:person:' + account.memberId,
      lifecycleState: 'PUBLISHED',
      specificContent: { 'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: post.text }, shareMediaCategory: 'ARTICLE', media: [memberArticle]
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
