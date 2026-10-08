# Contributing

Welcome, contributors. The easiest contribution is a new exposure check.

## Add a check in 10 minutes
1. Create `checks/yourcheck.js`. Every `.js` file in `checks/` (except `index.js`) is loaded automatically.
2. Export this shape:
```js
'use strict';
const { safeFetch } = require('../lib/safeFetch');

module.exports = {
  id: 'gravatar',
  title: 'Gravatar profile',
  appliesTo: ['email'],              // inputs this check needs: 'email', 'username', or both
  async run({ email, username }) {
    const base = { id: this.id, title: this.title, details: [], fix: [] };
    try {
      // ...call an API, decide what you found...
      return { ...base, status: 'warn', points: 5, summary: 'Plain-language finding.', details: ['item'], fix: ['What the user should do'] };
    } catch {
      return { ...base, status: 'error', points: 0, summary: 'Could not reach the service.' };
    }
  }
};
```
3. `status` is `safe`, `warn`, `risk` or `error`. Never throw: return `error` instead. Checks time out after 10 seconds.
4. Keep points small (1-20) so the total stays meaningful. Add a test in `test/smoke.js` that mocks `global.fetch`.
5. Run `npm test`, then open a pull request.

## Rules
- Self-check only: no features that look up other people.
- Never store or log emails, usernames or passwords.
- Use `textContent`, never `innerHTML`, for anything user-supplied or API-supplied.

## Good first issues
More username sites, a Gravatar check, a paste-site check, translations, a dark/light toggle.
