# How Doxxable Are You?

A self-check privacy scanner. Enter **your own** email or username and see what is already public: data breaches, accounts tied to your handle, and emails exposed in public GitHub commits. You get a 0-100 Doxx Score and a short cleanup plan.

**Nothing is stored. Nothing is logged.** Results exist only in your browser tab.

## Quick start
```
npm install
cp .env.example .env     # optional: add a free GITHUB_TOKEN (no scopes) to avoid GitHub rate limits
npm start
```
Open http://localhost:3000. Use **Use sample data** to see a full result with no internet. Run `npm test` to run the 22 automated checks.

## Features
- **Identity scan**: breach exposure (XposedOrNot), username on 15 platforms, email in public GitHub commits.
- **Password check**: SHA-1 hashed in your browser, only a 5-character prefix is sent to Pwned Passwords.
- **Link and QR check**: follows redirects server-side (with SSRF protection) and flags shorteners, raw IPs, punycode and long chains.
- **Score card**: download a PNG that contains only your score, never your email or username.

## How the score works
Breaches: +8 each (max 5), +15 if sensitive data such as passwords was exposed. Usernames: +2 per platform (max 20). Public GitHub email: +15. Total capped at 100. Low 0-30, Medium 31-60, High 61-100. A check that fails to run adds 0 points and shows "Couldn't check".

## API
- `POST /api/scan` `{email?, username?}` returns `{score, level, label, results[], topFixes[]}`
- `POST /api/unroll` `{url}` returns the redirect chain and warning flags
- `GET /api/demo`, `GET /api/health`

## Notes and limits
- Third-party sites change. Username detection is best effort: a site that blocks us is counted as inconclusive, never as found.
- Without `GITHUB_TOKEN`, GitHub allows very few requests per hour per IP.
- Only scan identifiers you own. This tool is for privacy awareness, not for looking up other people.

## Contributing
New checks are tiny plug-in files. See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.

## Game layer
Earn XP and rank up by scanning yourself, fixing risks, checking a password, tracing a link and playing the Spot the scam quiz. Eight badges and four missions track your progress. Only your XP and badges are saved in your browser (localStorage); emails, usernames and passwords are never saved.
