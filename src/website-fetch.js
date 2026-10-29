import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
export const CRAWLER_AGENT = 'AutoBlogKnowledgeBot';
export function publicAddress(address) {
  try {
    let ip = ipaddr.parse(address);
    if (ip.kind() === 'ipv6' && ip.isIPv4MappedAddress()) ip = ip.toIPv4Address();
    return ip.range() === 'unicast';
  } catch { return false; }
}
export function crawlUrl(value, base) {
  try {
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) return null;
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    if (base && url.origin !== new URL(base).origin) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}
// Pin the checked DNS result to the actual socket. Redirects are checked again.
export async function fetchWebsite(value, origin, { resolve = lookup, timeout = 15000, maxBytes = 1048576, allowed = () => true } = {}) {
  const until = Date.now() + timeout;
  let url = crawlUrl(value, origin);
  if (!url) throw new Error('URL is outside the website or uses an unsupported port/protocol.');
  for (let redirect = 0; redirect <= 4; redirect++) {
    if (!allowed(url)) throw new Error('URL is excluded by robots.txt.');
    const target = new URL(url), hostname = target.hostname.replace(/^\[|\]$/g, '');
    const records = await Promise.race([resolve(hostname, { all: true, verbatim: true }), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('DNS lookup timed out.')), Math.max(1, until - Date.now())); timer.unref(); })]);
    if (!records.length || records.some(record => !publicAddress(record.address))) throw new Error('Website resolves to a private, local or reserved network.');
    const selected = records[0];
    const response = await new Promise((accept, reject) => {
      const req = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
        method: 'GET', agent: false, headers: { 'User-Agent': `${CRAWLER_AGENT}/1.0`, Accept: 'text/html,application/xhtml+xml,application/xml,text/xml,text/plain', 'Accept-Encoding': 'identity' },
        lookup: (_host, options, callback) => options.all ? callback(null, [selected]) : callback(null, selected.address, selected.family)
      }, res => {
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > maxBytes) req.destroy(new Error('Page exceeds the 1 MB download limit.')); else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => accept({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      const timer = setTimeout(() => req.destroy(new Error('Website request timed out.')), Math.max(1, until - Date.now()));
      req.once('close', () => clearTimeout(timer)); req.once('error', reject); req.end();
    });
    if ([301,302,303,307,308].includes(response.status)) {
      url = crawlUrl(response.headers.location, url);
      if (!url || new URL(url).origin !== new URL(origin).origin) throw new Error('Redirect left the connected website origin. Use the final website URL in settings.');
      continue;
    }
    return { ...response, url, type: String(response.headers['content-type'] || '').toLowerCase() };
  }
  throw new Error('Website redirected too many times.');
}
