'use strict';
/**
 * Username check - probes public platforms from the server (browsers can't do
 * this because of CORS). Each site has its own detection rule returning
 * true (exists), false (not found) or null (inconclusive). Inconclusive never
 * counts as found.
 *
 * Sites were verified against known accounts and random strings. Reddit, PyPI,
 * CodePen and Medium profile pages were dropped/replaced because they return
 * bot-challenge pages to servers, which makes results unreliable.
 */
const { safeFetch } = require('../lib/safeFetch');

const SITE_TIMEOUT_MS = 6000;
const USERNAME_RE = /^[A-Za-z0-9._-]{1,39}$/;
const FIX = [
  'Use different usernames for personal vs. professional accounts',
  'Delete accounts you no longer use',
  'Make old profiles private or remove personal info from bios',
];

const byStatus = (res) => (res.status === 200 ? true : res.status === 404 ? false : null);
const json = async (res) => (res.ok ? res.json() : null);

/** @type {Array<{name:string, url:(u:string)=>string, profile:(u:string)=>string, detect:(res:Response)=>Promise<boolean|null>, redirect?:string, headers?:object}>} */
const SITES = [
  {
    name: 'GitHub',
    url: (u) => `https://api.github.com/users/${u}`,
    profile: (u) => `https://github.com/${u}`,
    headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
    // The REST API is rate limited (60/h unauthenticated); fall back to the public profile page.
    async detect(res, u) {
      if (res.status === 200 || res.status === 404) return res.status === 200;
      const page = await safeFetch(`https://github.com/${u}`, { timeout: SITE_TIMEOUT_MS, redirect: 'manual' });
      if (page.body) await page.body.cancel().catch(() => {});
      return byStatus(page);
    },
  },
  {
    name: 'GitLab',
    url: (u) => `https://gitlab.com/api/v4/users?username=${u}`,
    profile: (u) => `https://gitlab.com/${u}`,
    detect: async (res) => { const d = await json(res); return Array.isArray(d) ? d.length > 0 : null; },
  },
  {
    name: 'Hacker News',
    url: (u) => `https://hacker-news.firebaseio.com/v0/user/${u}.json`,
    profile: (u) => `https://news.ycombinator.com/user?id=${u}`,
    detect: async (res) => { if (!res.ok) return null; const d = await res.json(); return d !== null && typeof d === 'object'; },
  },
  {
    name: 'DEV Community',
    url: (u) => `https://dev.to/api/users/by_username?url=${u}`,
    profile: (u) => `https://dev.to/${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Chess.com',
    url: (u) => `https://api.chess.com/pub/player/${u.toLowerCase()}`,
    profile: (u) => `https://www.chess.com/member/${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Lichess',
    url: (u) => `https://lichess.org/api/user/${u}`,
    profile: (u) => `https://lichess.org/@/${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Docker Hub',
    url: (u) => `https://hub.docker.com/v2/users/${u}/`,
    profile: (u) => `https://hub.docker.com/u/${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Codeforces',
    url: (u) => `https://codeforces.com/api/user.info?handles=${u}`,
    profile: (u) => `https://codeforces.com/profile/${u}`,
    detect: async (res) => {
      const d = await res.json().catch(() => null);
      if (d && d.status === 'OK') return true;
      if (d && d.status === 'FAILED' && /not found/i.test(d.comment || '')) return false;
      return null;
    },
  },
  {
    name: 'Replit',
    url: (u) => `https://replit.com/@${u}`,
    profile: (u) => `https://replit.com/@${u}`,
    redirect: 'manual',
    // Existing profiles answer 200 or redirect to login; missing ones are 404.
    detect: async (res) => {
      if (res.status === 404) return false;
      if (res.status === 200) return true;
      if (res.status >= 300 && res.status < 400) return /login/.test(res.headers.get('location') || '') ? true : null;
      return null;
    },
  },
  {
    name: 'Keybase',
    url: (u) => `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${u}`,
    profile: (u) => `https://keybase.io/${u}`,
    detect: async (res) => {
      const d = await json(res);
      if (!d || !d.status) return null;
      if (d.status.code === 0) return Array.isArray(d.them) && d.them.some(Boolean);
      return d.status.code === 100 || d.status.code === 205 ? false : null;
    },
  },
  {
    name: 'npm',
    url: (u) => `https://registry.npmjs.org/-/v1/search?text=maintainer:${u}&size=1`,
    profile: (u) => `https://www.npmjs.com/~${u}`,
    detect: async (res) => { const d = await json(res); return d && Array.isArray(d.objects) ? d.objects.length > 0 : null; },
  },
  {
    name: 'Medium',
    // Profile pages are behind a bot challenge; the RSS feed is reliable (200 vs 404).
    url: (u) => `https://medium.com/feed/@${u}`,
    profile: (u) => `https://medium.com/@${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Hugging Face',
    url: (u) => `https://huggingface.co/api/users/${u}/overview`,
    profile: (u) => `https://huggingface.co/${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Codewars',
    url: (u) => `https://www.codewars.com/api/v1/users/${u}`,
    profile: (u) => `https://www.codewars.com/users/${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Mastodon (mastodon.social)',
    url: (u) => `https://mastodon.social/api/v1/accounts/lookup?acct=${u}`,
    profile: (u) => `https://mastodon.social/@${u}`,
    detect: async (res) => byStatus(res),
  },
  {
    name: 'Bluesky',
    url: (u) => `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${u.toLowerCase()}.bsky.social`,
    profile: (u) => `https://bsky.app/profile/${u.toLowerCase()}.bsky.social`,
    detect: async (res) => {
      if (res.ok) return true;
      if (res.status === 400) {
        const d = await res.json().catch(() => null);
        return d && /not found|invalid/i.test(`${d.message} ${d.error}`) ? false : null;
      }
      return null;
    },
  },
];

/**
 * Probe a single site. Returns { site, found: true|false|null, profile }.
 * `fetchImpl` is injectable so tests can mock the network.
 */
async function probeSite(site, username, fetchImpl = safeFetch) {
  const u = encodeURIComponent(username);
  try {
    const res = await fetchImpl(site.url(u), {
      timeout: SITE_TIMEOUT_MS,
      redirect: site.redirect || 'follow',
      headers: site.headers || {},
    });
    const found = await site.detect(res, u);
    if (res.body && !res.bodyUsed) await res.body.cancel().catch(() => {});
    return { site: site.name, found: typeof found === 'boolean' ? found : null, profile: site.profile(u) };
  } catch {
    return { site: site.name, found: null, profile: site.profile(u) };
  }
}

module.exports = {
  id: 'username',
  title: 'Username footprint',
  appliesTo: ['username'],
  SITES,
  USERNAME_RE,
  probeSite,
  async run({ username }, { fetchImpl } = {}) {
    const base = { id: this.id, title: this.title };
    if (!USERNAME_RE.test(username || '')) {
      return { ...base, status: 'error', points: 0, summary: 'Invalid username.', details: [], fix: [] };
    }
    try {
      const settled = await Promise.allSettled(SITES.map((s) => probeSite(s, username, fetchImpl)));
      const probes = settled.map((s, i) => (s.status === 'fulfilled' ? s.value : { site: SITES[i].name, found: null }));
      const found = probes.filter((p) => p.found === true);
      const unknown = probes.filter((p) => p.found === null);

      if (unknown.length === probes.length) {
        return { ...base, status: 'error', points: 0, summary: 'Could not reach any platform - check your connection and try again.', details: [], fix: [] };
      }
      const status = found.length === 0 ? 'safe' : found.length <= 4 ? 'warn' : 'risk';
      const details = found.map((p) => `${p.site} - ${p.profile}`);
      details.push(`Checked ${probes.length} sites, ${unknown.length} inconclusive` +
        (unknown.length ? ` (${unknown.map((p) => p.site).join(', ')})` : ''));
      return {
        ...base,
        status,
        points: Math.min(found.length * 2, 20),
        summary: found.length
          ? `This username exists on ${found.length} platform${found.length === 1 ? '' : 's'} - easy to link your accounts together.`
          : 'No public accounts found with this username on the platforms we checked.',
        details,
        fix: found.length ? FIX : [],
      };
    } catch {
      return { ...base, status: 'error', points: 0, summary: 'Username check failed unexpectedly - try again later.', details: [], fix: [] };
    }
  },
};
