'use strict';
try { process.loadEnvFile && process.loadEnvFile(); } catch { /* .env is optional */ }
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { runAll } = require('./checks');
const { computeScore } = require('./lib/score');
const { unroll } = require('./lib/unroll');
const { demoScan } = require('./lib/demo');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// Security headers
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://api.pwnedpasswords.com; frame-ancestors 'none'"
  });
  next();
});

app.use('/api', rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Wait a few minutes and try again.' } }));

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const USER_RE = /^[A-Za-z0-9._-]{1,39}$/;

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/demo', (req, res) => res.json(demoScan()));

app.post('/api/scan', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
  if (!email && !username) return res.status(400).json({ error: 'Enter an email, a username, or both.' });
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return res.status(400).json({ error: 'That email address does not look valid.' });
  if (username && !USER_RE.test(username)) return res.status(400).json({ error: 'Usernames can use letters, numbers, dots, underscores and hyphens (up to 39 characters).' });
  const results = await runAll({ email, username });
  res.json({ ...computeScore(results), results, scannedAt: new Date().toISOString() });
});

app.post('/api/unroll', async (req, res) => {
  const url = typeof req.body.url === 'string' ? req.body.url.trim() : '';
  if (!url || url.length > 2048) return res.status(400).json({ error: 'Paste a link to trace.' });
  try {
    res.json(await unroll(url));
  } catch (e) {
    const known = /Invalid URL|Only http|Address not allowed/.test(e.message);
    res.status(known ? 400 : 502).json({ error: known ? 'That link is not allowed or not valid. Use a public http(s) link.' : 'Could not trace that link. The site may be down.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => res.status(400).json({ error: 'Bad request.' }));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Running at http://localhost:${port}`));
}
module.exports = app;
