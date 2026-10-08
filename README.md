# How Doxxable Are You?

> A self-check privacy exposure scanner. Enter **your own** email and/or username and find out
> what a stranger could dig up in 30 seconds - then fix it in 10 minutes.

![Screenshot placeholder](docs/screenshot.png)

**Self-check only. Nothing is stored. Open source (MIT).**

## Features

- **Doxx Score (0-100)** - animated gauge, color-coded Low / Medium / High.
- **Data breaches** - checks your email against known breaches (XposedOrNot) and flags exposed sensitive data such as passwords, phone numbers and addresses.
- **Username footprint** - probes 16 platforms (GitHub, GitLab, Hacker News, DEV, Chess.com, Lichess, Docker Hub, Codeforces, Replit, Keybase, npm, Medium, Hugging Face, Codewars, Mastodon, Bluesky) to show how easily your accounts can be linked.
- **GitHub email exposure** - finds your email in public commit metadata and public profiles.
- **Risk cards** with details and concrete "How to fix" steps.
- **3-step cleanup plan** with a progress bar: "Your score could drop to X".
- **Share card** - downloads a PNG with your score and level only (never your email or username).
- **Password Autopsy** - checks a password against Have I Been Pwned using k-anonymity. Your password never leaves your device.
- **QR X-Ray** - decode a QR photo in your browser, then safely follow its redirect chain on the server and flag risk signals (shorteners, raw IPs, punycode, many hops, no HTTPS, huge query strings).
- **Demo mode** - realistic sample data that works without internet, for when the venue Wi-Fi dies.

## Game mode

The UI is a small game, to make checking your privacy fun:

- **XP and levels** go from *Noob* to *Digital Phantom*. You earn XP for scanning, finishing cleanup "side quests", and using the password and QR tools.
- **12 achievements** pop up as toasts with confetti. *Ghost Mode*, *Cleanup Crew*, *QR Detective* and *Completionist* are a few of them.
- **Score reveal effects:** a radar sweep with blips while the scan runs, a glitch title and a matrix-rain background. The rank stamp shows a *Privacy class* from GHOST to OPEN BOOK, plus a Privacy HP bar. A high score shakes the screen and a low score drops confetti.
- **Quests change the gauge:** each cleanup fix you tick moves the gauge down to your projected score.
- **Live password-strength meter,** computed entirely in the browser.

All effects are plain canvas and CSS in `public/fx.js` and `public/style.css`, with no dependencies. They turn off under `prefers-reduced-motion`. XP and badges live only in memory: close the tab and they are gone.

## How it works

```
Browser (vanilla JS)                    Server (Express)
--------------------                    ----------------
Identity Scan  --POST /api/scan------>  checks/index.js runs all applicable checks in parallel
                                          |- checks/breach.js   -> XposedOrNot API
                                          |- checks/username.js -> 16 public platform APIs
                                          '- checks/github.js   -> GitHub search API
               <--- score + results ---  lib/score.js turns findings into a 0-100 score
Password Check --(first 5 hash chars)--> api.pwnedpasswords.com   (no server involved)
QR X-Ray       --POST /api/unroll----->  lib/safeFetch.js follows redirects manually, with SSRF checks on every hop
```

Each check follows one contract and never throws, so one failing API never breaks the scan.
Every check has an 8-second timeout; each username probe has a 6-second timeout.

## Privacy and ethics

- **Self-check only.** You must confirm you own the email/username before scanning. Please only scan yourself.
- **Nothing is stored.** No database, no accounts, no cookies, no analytics. Lookups are never logged - the server does not log request bodies at all.
- **Passwords never leave your device.** Only the first 5 characters of the SHA-1 hash are sent to Have I Been Pwned.
- **QR images never leave your device.** They are decoded in the browser; only the decoded URL is sent for unrolling.
- **Third parties:** your email/username is sent to the APIs listed above to perform the checks. Review their privacy policies if that matters to you.
- The share card contains your score and level only.

## Quick start

Requires Node.js 18+.

```bash
npm install
cp .env.example .env    # optional: add GITHUB_TOKEN for higher GitHub rate limits
npm start
```

Open http://localhost:3000.

Run the smoke tests:

```bash
npm test                # same as: node test/smoke.js
```

## Troubleshooting

**"Could not reach the scanner backend"** means the browser got no response from `/api/*`. Under the scan buttons, a status light shows whether the scanner is online.

- Make sure `npm start` is still running, then open **http://localhost:3000**. Opening `public/index.html` as a file does not work, because the API comes from the Node server.
- If you use a preview, tunnel or login proxy, reload the page. When your proxy session expires, the API calls get a login page back. The app reports that as "non-API page".
- "Too many requests" comes from the rate limiter (30 API calls per 10 minutes per IP).
- **Try demo data** keeps working even when the backend is unreachable.

## Deploy

The app is a Node server, so it needs a host that runs Node. **GitHub Pages cannot run it.**

**Full app (recommended):** Render, Railway, Fly.io or any VPS will work.
- **Render:** New > Blueprint, then pick this repo. `render.yaml` sets everything up. Add `GITHUB_TOKEN` as a secret if you want.
- **Anywhere else:** `npm ci && npm start`, with `PORT` set by the host and `TRUST_PROXY=1` when running behind a proxy.

**Static demo on GitHub Pages:** `.github/workflows/pages.yml` publishes `public/` on every push to `main`.
- Turn it on under **Settings > Pages > Build and deployment > Source: GitHub Actions**. If Source is set to "Deploy from a branch" with `/docs`, the build fails with `No such file or directory @ dir_chdir0 - /github/workspace/docs`.
- On Pages, the demo data and Password Check work. Live identity scans and QR link tracing show a notice instead, because they need the server.

## Configuration

| Variable       | Default | Description |
| -------------- | ------- | ----------- |
| `PORT`         | `3000`  | HTTP port |
| `GITHUB_TOKEN` | -       | Optional GitHub token (no scopes needed). Raises GitHub rate limits from 60/h to 5000/h. |
| `TRUST_PROXY`  | -       | Set to `1` behind a reverse proxy so rate limiting uses the real client IP. |

## API

All endpoints return JSON. Rate limit: 30 requests / 10 minutes per IP (except `/api/health`).

### `POST /api/scan`

```json
{ "email": "you@example.com", "username": "neo_1999" }
```

At least one field is required. Email must look like an email; username must be 1-39 characters of letters,
digits, `.`, `_` or `-`. Invalid input returns `400 { "error": "..." }`.

Response:

```json
{
  "score": 74, "rawScore": 74, "level": "high", "label": "High exposure", "color": "#ff3860",
  "results": [
    { "id": "breach", "title": "Data breaches", "status": "risk", "points": 47,
      "summary": "Found in 4 known breaches ...", "details": ["Breach: Canva", "..."], "fix": ["..."] }
  ],
  "topFixes": [ { "text": "Change the password on every listed site ...", "checkId": "breach", "title": "Data breaches", "impact": 11.8 } ],
  "scannedAt": "2026-10-08T12:00:00.000Z"
}
```

### `GET /api/demo`

Same shape as `/api/scan` with hard-coded fictional data (score 74) and `"demo": true`.

### `POST /api/unroll`

```json
{ "url": "https://bit.ly/example" }
```

Response:

```json
{
  "chain": [ { "url": "https://bit.ly/example", "status": 301 }, { "url": "https://example.com/", "status": 200 } ],
  "hops": 1, "finalUrl": "https://example.com/", "finalDomain": "example.com",
  "signals": ["URL shortener hides the destination (bit.ly)"], "verdict": "caution"
}
```

Private, loopback, link-local and other internal addresses are rejected with `400` - on the first URL and on every redirect hop.
Max 8 hops.

### `GET /api/health`

`{ "ok": true, "platforms": 16 }`

## How scoring works

| Finding | Points |
| ------- | ------ |
| Each data breach (max 5 counted) | +8 (max 40) |
| Breach exposed passwords, phone numbers, addresses, financial data or government IDs | +15 |
| Each platform where your username exists | +2 (max 20) |
| Email visible in public GitHub commits / profiles | +15 |

The total is capped at 100. **0-30 Low** (green), **31-60 Medium** (yellow), **61-100 High** (red).
The cleanup plan picks the top fix from each of the highest-scoring findings; each fix's "impact" is
its finding's points split evenly across all of that finding's fixes (completing every fix for a finding removes its points).

## Security

- SSRF protection (`lib/safeFetch.js`): only `http`/`https`; hostnames are resolved with `dns.lookup` and rejected if **any**
  address is private (127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, ::1, fc00::/7, fe80::/10, IPv4-mapped IPv6, ...).
  Redirects are followed manually and re-checked on every hop.
  Known limitation: there is a small window between the DNS check and the connection (DNS rebinding). For a hardened deployment, run behind an egress proxy or firewall that blocks internal ranges.
- Security headers: `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options`, `Permissions-Policy`.
- All user and API text is rendered with `textContent` - never `innerHTML`.
- Request bodies are limited to 10 KB and are never logged.

## Tech stack

- Node.js 18+ (built-in `fetch`), Express, express-rate-limit
- Vanilla HTML/CSS/JS frontend, no build step
- [jsQR](https://github.com/cozmo/jsQR) for QR decoding (loaded from jsDelivr with Subresource Integrity, since it is not published on cdnjs), with the native `BarcodeDetector` API as a fallback

## Roadmap

- More checks: Gravatar, paste sites, data-broker opt-out links, exposed phone numbers
- Localisation
- Optional browser-extension version
- Exportable cleanup checklist (PDF)

## Contributing

Adding a check takes about 10 minutes - see [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues are listed there.

## License

[MIT](LICENSE)
