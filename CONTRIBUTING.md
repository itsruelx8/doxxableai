# Contributing to How Doxxable Are You?

Thanks for helping people protect their privacy! This project is beginner friendly and
Hacktoberfest friendly. The easiest way to contribute is to **add a new exposure check**.

## Ground rules

- **Self-check only.** Checks must help people audit *their own* exposure. No features for
  profiling other people, bulk lookups, or scraping behind logins.
- **Store nothing, log nothing.** Never `console.log` emails, usernames or API responses
  that contain them. Never write user data to disk.
- **Use free, public, documented APIs** where possible, and respect their rate limits and terms.
- **Never throw.** A check that fails must return `status: 'error'` so the rest of the scan still works.

## Add a new exposure check in 10 minutes

### 1. Understand the check contract

Every file in `/checks` (except `index.js`) is loaded automatically. Each exports:

```js
{
  id: 'my-check',                 // unique, kebab-case
  title: 'Human readable title',
  appliesTo: ['email'],           // ['email'] | ['username'] | ['email', 'username']
  run: async ({ email, username }) => Result,
}
```

`Result` must look like:

```js
{
  id, title,
  status: 'safe' | 'warn' | 'risk' | 'error',
  points: 0,          // added to the 0-100 Doxx Score (keep it proportional, usually <= 20)
  summary: 'One sentence for the risk card',
  details: ['Bullet points shown under "Details"'],
  fix: ['Actionable steps shown under "How to fix"'],
}
```

The registry (`checks/index.js`) runs every applicable check in parallel, enforces an
8-second timeout, and normalises the result shape - but your check should still catch its own errors.

### 2. Create the file

Here is a complete, working example - a Gravatar check (a great first issue if nobody has taken it yet!).
Save it as `checks/gravatar.js`:

```js
'use strict';
/**
 * Gravatar check - does this email have a public Gravatar profile?
 * Gravatar profiles can leak your real name, photo, location and other accounts.
 */
const crypto = require('node:crypto');
const { safeFetch } = require('../lib/safeFetch');

module.exports = {
  id: 'gravatar',
  title: 'Gravatar profile',
  appliesTo: ['email'],
  async run({ email }) {
    const base = { id: this.id, title: this.title };
    try {
      const hash = crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
      const res = await safeFetch(`https://en.gravatar.com/${hash}.json`, { timeout: 6000 });
      if (res.status === 404) {
        return { ...base, status: 'safe', points: 0, summary: 'No public Gravatar profile.', details: [], fix: [] };
      }
      if (!res.ok) {
        return { ...base, status: 'error', points: 0, summary: 'Gravatar is unavailable right now.', details: [], fix: [] };
      }
      const data = await res.json();
      const entry = (data.entry && data.entry[0]) || {};
      const details = [];
      if (entry.displayName) details.push(`Display name: ${entry.displayName}`);
      if (entry.currentLocation) details.push(`Location: ${entry.currentLocation}`);
      (entry.accounts || []).slice(0, 5).forEach((a) => details.push(`Linked account: ${a.shortname}`));
      return {
        ...base,
        status: 'warn',
        points: 5,
        summary: 'Your email has a public Gravatar profile that anyone can look up.',
        details,
        fix: ['Review what is public at gravatar.com', 'Remove your real name, location and linked accounts'],
      };
    } catch {
      return { ...base, status: 'error', points: 0, summary: 'Could not reach Gravatar.', details: [], fix: [] };
    }
  },
};
```

### 3. Try it

```bash
npm start
curl -s -X POST localhost:3000/api/scan -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}' | jq '.results[] | {id,status,points}'
```

Your check shows up automatically as a new risk card in the UI - no frontend changes needed.

### 4. Test it

- Test with an identity that **should** be found and one that **should not**.
- Turn off Wi-Fi and make sure you get a friendly `status: 'error'`, not a crash.
- Run `npm test` - all smoke tests must pass.

### Tips

- Always use `safeFetch` from `lib/safeFetch.js` (timeouts, User-Agent and SSRF protection built in).
- Always `encodeURIComponent()` user input that goes into a URL.
- Treat ambiguous responses (403, 429, captcha pages) as "inconclusive", never as "found".
- Keep `points` honest - the total is capped at 100, and the score should reflect real risk.

## Adding a username site

Add an entry to the `SITES` array in `checks/username.js`:

```js
{
  name: 'Example',
  url: (u) => `https://api.example.com/users/${u}`,   // u is already URL-encoded
  profile: (u) => `https://example.com/${u}`,
  detect: async (res) => (res.status === 200 ? true : res.status === 404 ? false : null),
},
```

Verify it with a known account and a random 20-character string before opening a PR.
Sites that show bot challenges to servers (Cloudflare "Just a moment...") are not reliable - skip them.

## Good first issues

- Add more username sites (verified with a real account + a random string)
- Add a Gravatar check (example above)
- Add a paste-site check (e.g. the XposedOrNot paste data)
- Add translations for the UI
- Improve accessibility or mobile layout
- More QR X-Ray risk signals (known phishing TLDs, look-alike brand domains)

## Pull request guidelines

1. Fork the repo and create a branch: `git checkout -b feat/gravatar-check`.
2. Keep PRs small and focused - one check or one fix per PR.
3. Follow the existing style: CommonJS, `'use strict'`, 2-space indent, short comments.
4. Run `npm test` and make sure it passes.
5. Describe **what** the check detects, **which API** it uses (link the docs), and how you tested it.
6. No new heavy dependencies - Node built-ins and global `fetch` go a long way.
7. Be kind in reviews. We follow the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/).
