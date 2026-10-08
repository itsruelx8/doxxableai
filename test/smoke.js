'use strict';
/**
 * Smoke test - run with `node test/smoke.js` (or `npm test`).
 * Starts the app in-process on a random port and checks every endpoint, the
 * score engine, input validation, SSRF blocking and the username check.
 * Live-network tests fall back to a mocked fetch (clearly reported) when the
 * network is unavailable.
 */
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { computeScore, levelFor } = require('../lib/score');
const { isPrivateAddress } = require('../lib/safeFetch');
const { runChecks } = require('../checks');
const username = require('../checks/username');

let base;
let passed = 0;
let failed = 0;
const notes = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err && err.message}`);
  }
}

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
}

const r = (points, fix = []) => ({ id: `c${points}`, title: `Check ${points}`, status: points ? 'risk' : 'safe', points, summary: '', details: [], fix });

async function main() {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  console.log(`Smoke test against ${base}\n`);

  await test('GET /api/health -> {ok:true} with security headers', async () => {
    const res = await api('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  });

  await test('GET / serves the frontend', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /How Doxxable Are You\?/);
  });

  await test('GET /api/demo returns a realistic, well-formed scan', async () => {
    const { status, json } = await api('GET', '/api/demo');
    assert.equal(status, 200);
    for (const k of ['score', 'level', 'label', 'results', 'topFixes', 'scannedAt']) assert.ok(k in json, `missing ${k}`);
    assert.ok(json.score >= 65 && json.score <= 80, `demo score ${json.score} should be ~72`);
    assert.equal(json.level, 'high');
    assert.equal(json.topFixes.length, 3);
    const ids = json.results.map((x) => x.id).sort();
    assert.deepEqual(ids, ['breach', 'github', 'username']);
    for (const res of json.results) {
      assert.ok(['safe', 'warn', 'risk', 'error'].includes(res.status));
      assert.ok(Array.isArray(res.details) && Array.isArray(res.fix));
      assert.equal(typeof res.points, 'number');
    }
    const userHits = json.results.find((x) => x.id === 'username').details.filter((d) => d.includes(' - http'));
    assert.equal(userHits.length, 6);
    assert.ok(!Number.isNaN(Date.parse(json.scannedAt)));
  });

  await test('score.js: sums points', () => {
    assert.equal(computeScore([r(10), r(15), r(0)]).score, 25);
    assert.equal(computeScore([]).score, 0);
  });

  await test('score.js: caps at 100', () => {
    const s = computeScore([r(55), r(20), r(15), r(40)]);
    assert.equal(s.score, 100);
    assert.equal(s.rawScore, 130);
    assert.equal(s.level, 'high');
  });

  await test('score.js: level boundaries 0/30/31/60/61/100', () => {
    const cases = [[0, 'low'], [30, 'low'], [31, 'medium'], [60, 'medium'], [61, 'high'], [100, 'high']];
    for (const [pts, lvl] of cases) {
      assert.equal(computeScore([r(pts)]).level, lvl, `${pts} -> ${lvl}`);
      assert.equal(levelFor(pts).level, lvl);
    }
    assert.equal(computeScore([r(10)]).label, 'Low exposure');
    assert.equal(computeScore([r(45)]).label, 'Medium exposure');
    assert.equal(computeScore([r(70)]).label, 'High exposure');
  });

  await test('score.js: topFixes = 3 fixes from the highest-point findings', () => {
    const s = computeScore([r(5, ['low-a']), r(40, ['big-a', 'big-b']), r(15, ['mid-a', 'mid-b']), r(0, ['none'])]);
    assert.deepEqual(s.topFixes.map((f) => f.text), ['big-a', 'mid-a', 'low-a']);
    assert.ok(s.topFixes.every((f) => f.impact > 0));
    assert.equal(computeScore([r(0, ['x'])]).topFixes.length, 0);
  });

  await test('POST /api/scan rejects empty/invalid input with 400', async () => {
    const bad = [
      {},
      { email: '', username: '' },
      { email: 'not-an-email' },
      { username: 'has spaces' },
      { username: 'a'.repeat(40) },
      { username: '<script>' },
      { email: 'ok@example.com', username: 'bad/name' },
      { email: 42 },
    ];
    for (const body of bad) {
      const res = await api('POST', '/api/scan', body);
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      assert.equal(typeof res.json.error, 'string');
    }
    const malformed = await fetch(base + '/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":' });
    assert.equal(malformed.status, 400, 'malformed JSON should be a 400');
  });

  await test('SSRF: isPrivateAddress blocks internal ranges, allows public', () => {
    const blocked = ['127.0.0.1', '127.8.9.10', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '0.0.0.0', '100.64.0.1', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'not-an-ip'];
    for (const ip of blocked) assert.equal(isPrivateAddress(ip), true, `${ip} should be blocked`);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, `${ip} should be allowed`);
  });

  await test('SSRF: POST /api/unroll rejects internal targets', async () => {
    const targets = ['http://127.0.0.1', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/api/health',
      'http://[::1]/', 'http://10.0.0.1/', 'http://2130706433/', 'file:///etc/passwd', 'ftp://example.com/', 'gopher://127.0.0.1/'];
    for (const url of targets) {
      const res = await api('POST', '/api/unroll', { url });
      assert.equal(res.status, 400, `${url} should be rejected (got ${res.status})`);
      assert.ok(res.json.error, 'error message expected');
    }
    const empty = await api('POST', '/api/unroll', {});
    assert.equal(empty.status, 400);
  });

  await test('registry: a throwing check becomes status "error", never breaks the scan', async () => {
    const boom = { id: 'boom', title: 'Boom', appliesTo: ['email'], run: async () => { throw new Error('kaboom'); } };
    const ok = { id: 'ok', title: 'OK', appliesTo: ['email'], run: async () => ({ status: 'safe', points: 0, summary: 'fine', details: [], fix: [] }) };
    const skip = { id: 'skip', title: 'Skip', appliesTo: ['username'], run: async () => ({ status: 'risk', points: 99 }) };
    const results = await runChecks({ email: 'a@b.co' }, [boom, ok, skip]);
    assert.equal(results.length, 2);
    assert.equal(results[0].status, 'error');
    assert.equal(results[0].points, 0);
    assert.equal(results[1].status, 'safe');
  });

  // Username check: live first, mocked fallback if the network is unavailable.
  const github = username.SITES.find((s) => s.name === 'GitHub');
  const randomName = Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  await test('username check: "octocat" found on GitHub, random 20-char string not found', async () => {
    let [octo, rnd] = await Promise.all([username.probeSite(github, 'octocat'), username.probeSite(github, randomName)]);
    if (octo.found === null || rnd.found === null) {
      notes.push('GitHub was unreachable from this environment - the username test used a MOCKED fetch.');
      const mockFetch = async (url) => new Response('{}', { status: /\/octocat$/.test(url) ? 200 : 404 });
      [octo, rnd] = await Promise.all([username.probeSite(github, 'octocat', mockFetch), username.probeSite(github, randomName, mockFetch)]);
    } else {
      notes.push('Username test ran LIVE against GitHub.');
    }
    assert.equal(octo.found, true, 'octocat should exist on GitHub');
    assert.equal(rnd.found, false, `${randomName} should not exist on GitHub`);
  });

  await test('username check: inconclusive sites never count as found', async () => {
    const failing = async () => { throw new Error('network down'); };
    const result = await username.run({ username: 'octocat' }, { fetchImpl: failing });
    assert.equal(result.status, 'error');
    assert.equal(result.points, 0);
  });

  await test('POST /api/scan (username only) returns a full result shape', async () => {
    const { status, json } = await api('POST', '/api/scan', { username: randomName });
    assert.equal(status, 200);
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].id, 'username');
    assert.ok(['safe', 'error'].includes(json.results[0].status), `random name should be safe (or error offline), got ${json.results[0].status}`);
    assert.equal(json.score, 0);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  notes.forEach((n) => console.log(`NOTE: ${n}`));
  process.exit(failed ? 1 : 0);
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

main();
