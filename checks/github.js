'use strict';
/**
 * GitHub email check - is this email visible in public commits or as a
 * public profile email? Uses GITHUB_TOKEN from .env when present.
 */
const { safeFetch } = require('../lib/safeFetch');

const FIX = [
  "Enable 'Keep my email addresses private' in GitHub Settings > Emails",
  "Turn on 'Block command line pushes that expose my email'",
  'Use your GitHub noreply address in git config user.email',
  'Rewrite history only if truly necessary',
];

class RateLimitError extends Error {}

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function search(path) {
  const res = await safeFetch(`https://api.github.com${path}`, { headers: headers(), timeout: 7000 });
  if (res.status === 403 || res.status === 429) throw new RateLimitError();
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  return res.json();
}

module.exports = {
  id: 'github',
  title: 'GitHub email exposure',
  appliesTo: ['email'],
  async run({ email }) {
    const base = { id: this.id, title: this.title };
    try {
      const q = encodeURIComponent(email);
      const [commits, users] = await Promise.allSettled([
        search(`/search/commits?q=author-email:${q}&per_page=5`),
        search(`/search/users?q=${q}+in:email&per_page=5`),
      ]);
      if (commits.status === 'rejected' && users.status === 'rejected') throw commits.reason;

      const commitCount = commits.status === 'fulfilled' ? commits.value.total_count || 0 : 0;
      const userCount = users.status === 'fulfilled' ? users.value.total_count || 0 : 0;
      if (commitCount + userCount === 0) {
        return { ...base, status: 'safe', points: 0, summary: 'Email not found in public GitHub commits or profiles.', details: [], fix: [] };
      }

      const repos = commits.status === 'fulfilled'
        ? [...new Set((commits.value.items || []).map((i) => i.repository && i.repository.full_name).filter(Boolean))].slice(0, 5)
        : [];
      const logins = users.status === 'fulfilled' ? (users.value.items || []).map((u) => u.login).slice(0, 3) : [];
      const details = [
        ...repos.map((r) => `Public commits in: ${r}`),
        ...logins.map((l) => `Public profile email on: github.com/${l}`),
      ];
      if (commitCount) details.push(`${commitCount} public commit${commitCount === 1 ? '' : 's'} authored with this email`);
      return {
        ...base,
        status: 'risk',
        points: 15,
        summary: 'Your email is publicly visible on GitHub - anyone can harvest it from commit metadata.',
        details,
        fix: FIX,
      };
    } catch (err) {
      const summary = err instanceof RateLimitError
        ? 'GitHub rate limit reached - add GITHUB_TOKEN to .env'
        : 'Could not reach GitHub right now - try again later.';
      return { ...base, status: 'error', points: 0, summary, details: [], fix: [] };
    }
  },
};
