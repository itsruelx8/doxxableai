'use strict';
/**
 * How Doxxable Are You? - Express server.
 * Stores nothing and never logs request bodies, emails or usernames.
 */
const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const rateLimit = require('express-rate-limit');

const { runChecks } = require('./checks');
const { USERNAME_RE, SITES } = require('./checks/username');
const { computeScore } = require('./lib/score');
const { safeFetch, BlockedUrlError } = require('./lib/safeFetch');
const { DEMO_RESULTS } = require('./lib/demo');

loadDotEnv();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_HOPS = 8;
const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 'bl.ink', 'lnkd.in', 'qrco.de', 's.id', 'v.gd', 't.ly', 'shorte.st', 'adf.ly', 'qr.net', 'urlz.fr',
]);

/** Minimal .env loader (no dependency). Existing env vars win. */
function loadDotEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function validateInput(body) {
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim().replace(/^@/, '') : '';
  if (!email && !username) return { error: 'Enter your email and/or username to scan.' };
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return { error: 'That email address does not look valid.' };
  if (username && !USERNAME_RE.test(username)) {
    return { error: 'Usernames must be 1-39 characters: letters, digits, dot, underscore or hyphen.' };
  }
  return { email, username };
}

function buildScanResponse(results) {
  const { score, rawScore, level, label, color, topFixes } = computeScore(results);
  return { score, rawScore, level, label, color, results, topFixes, scannedAt: new Date().toISOString() };
}

/** Risk signals for an unrolled URL chain. */
function riskSignals(chain) {
  const signals = [];
  const hosts = chain.map((h) => new URL(h.url).hostname.toLowerCase());
  const shorteners = [...new Set(hosts.filter((h) => SHORTENERS.has(h.replace(/^www\./, ''))))];
  if (shorteners.length) signals.push(`URL shortener hides the destination (${shorteners.join(', ')})`);
  if (hosts.some((h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || h.startsWith('['))) signals.push('Uses a raw IP address instead of a domain name');
  if (hosts.some((h) => h.split('.').some((p) => p.startsWith('xn--')))) signals.push('Punycode domain (xn--) - may imitate a real brand with look-alike characters');
  if (chain.length - 1 >= 3) signals.push(`Many redirects (${chain.length - 1} hops)`);
  if (chain.some((h) => h.url.startsWith('http:'))) signals.push('Part of the chain is not encrypted (http instead of https)');
  if (chain.some((h) => new URL(h.url).search.length > 200)) signals.push('Very long query string - often used for tracking or obfuscation');
  return signals;
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "connect-src 'self' https://api.pwnedpasswords.com",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    next();
  });

  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

  app.get('/api/health', (req, res) => res.json({ ok: true, platforms: SITES.length }));

  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests - please wait a few minutes and try again.' },
  });
  app.use('/api', limiter);

  app.post('/api/scan', async (req, res) => {
    const input = validateInput(req.body || {});
    if (input.error) return res.status(400).json({ error: input.error });
    const results = await runChecks({ email: input.email || undefined, username: input.username || undefined });
    res.set('Cache-Control', 'no-store').json(buildScanResponse(results));
  });

  app.get('/api/demo', (req, res) => {
    res.json({ ...buildScanResponse(DEMO_RESULTS), demo: true });
  });

  app.post('/api/unroll', async (req, res) => {
    const raw = typeof (req.body || {}).url === 'string' ? req.body.url.trim() : '';
    if (!raw) return res.status(400).json({ error: 'Paste or scan a URL first.' });
    if (raw.length > 2048) return res.status(400).json({ error: 'That URL is too long.' });
    let current;
    try {
      current = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`).toString();
    } catch {
      return res.status(400).json({ error: 'That does not look like a valid URL.' });
    }

    const chain = [];
    try {
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        const r = await safeFetch(current, { redirect: 'manual', timeout: 6000 });
        if (r.body) await r.body.cancel().catch(() => {});
        chain.push({ url: current, status: r.status });
        const location = r.headers.get('location');
        if (r.status < 300 || r.status >= 400 || !location) break;
        if (hop === MAX_HOPS) {
          chain[chain.length - 1].note = `Stopped after ${MAX_HOPS} redirects`;
          break;
        }
        current = new URL(location, current).toString();
      }
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        const where = chain.length ? ' (a redirect in the chain tried to reach it)' : '';
        return res.status(400).json({ error: err.message + where, chain });
      }
      // Unreachable hop: still report the chain and its risk signals.
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      chain.push({ url: current, status: null, note: timedOut ? 'Timed out - site did not respond' : 'Could not connect' });
    }

    const finalUrl = chain[chain.length - 1].url;
    const signals = riskSignals(chain);
    res.json({
      chain,
      hops: chain.length - 1,
      finalUrl,
      finalDomain: new URL(finalUrl).hostname,
      signals,
      verdict: signals.length >= 2 ? 'suspicious' : signals.length === 1 ? 'caution' : 'looks-ok',
    });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

  // Malformed JSON and other errors: friendly message, never echo the body.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    res.status(500).json({ error: 'Something went wrong on our side - please try again.' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`How Doxxable Are You? running at http://localhost:${port}`);
  });
}

module.exports = { createApp, validateInput, riskSignals };
