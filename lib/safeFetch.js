'use strict';
/**
 * safeFetch - a thin wrapper around Node's global fetch that adds:
 *   - a hard timeout (AbortSignal.timeout)
 *   - a polite, identifiable User-Agent
 *   - SSRF protection: only http/https, and every hostname is resolved with
 *     dns.lookup and rejected if ANY address is private, loopback, link-local,
 *     multicast or otherwise non-public. Redirects are followed manually so the
 *     check is repeated on every hop.
 */
const dns = require('node:dns').promises;
const net = require('node:net');

const USER_AGENT =
  'HowDoxxableAreYou/1.0 (+https://github.com/your-org/how-doxxable-are-you; privacy self-check)';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;

class BlockedUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedUrlError';
    this.code = 'BLOCKED_URL';
  }
}

// Non-public address ranges (RFC 1918, loopback, link-local, CGNAT, ULA, ...).
const blockList = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([addr, prefix]) => blockList.addSubnet(addr, prefix, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
].forEach(([addr, prefix]) => blockList.addSubnet(addr, prefix, 'ipv6'));

/** True if the IP literal is not a public, routable unicast address. */
function isPrivateAddress(ip) {
  if (typeof ip !== 'string') return true;
  let addr = ip.trim().replace(/^\[|\]$/g, '').split('%')[0];
  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) -> check as IPv4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) addr = mapped[1];
  const mappedHex = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    addr = [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  const family = net.isIP(addr);
  if (family === 4) return blockList.check(addr, 'ipv4');
  if (family === 6) return blockList.check(addr, 'ipv6');
  return true; // not an IP at all -> treat as unsafe
}

/**
 * Throws BlockedUrlError unless the URL is http(s) and its host resolves only
 * to public addresses. Returns the parsed URL.
 */
async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError('That does not look like a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedUrlError('Only http and https URLs are allowed.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new BlockedUrlError('URL has no host.');

  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host }];
  } else {
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch {
      throw new BlockedUrlError(`Could not resolve host "${host}".`);
    }
  }
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedUrlError('Blocked: that address points to a private or internal network.');
  }
  return url;
}

/**
 * Fetch a URL safely.
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.timeout=8000]  total timeout in ms (covers all redirect hops)
 * @param {'follow'|'manual'} [opts.redirect='follow']  'manual' returns the 3xx response as-is
 * @param {object} [opts.headers]
 * @param {string} [opts.method='GET']
 * @param {AbortSignal} [opts.signal]
 */
async function safeFetch(url, opts = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, redirect = 'follow', headers = {}, method = 'GET' } = opts;
  const signal = opts.signal || AbortSignal.timeout(timeout);
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      method,
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/html;q=0.9, */*;q=0.5', ...headers },
    });
    const location = res.headers.get('location');
    if (redirect === 'manual' || res.status < 300 || res.status >= 400 || !location) return res;
    if (res.body) await res.body.cancel().catch(() => {});
    current = new URL(location, current).toString();
  }
  throw new Error('Too many redirects');
}

module.exports = { safeFetch, assertPublicUrl, isPrivateAddress, BlockedUrlError, USER_AGENT };
