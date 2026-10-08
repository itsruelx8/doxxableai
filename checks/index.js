'use strict';
/**
 * Check registry. Every *.js file in this folder (except this one) is loaded
 * automatically, so adding a check is just dropping a new file here.
 */
const fs = require('node:fs');
const path = require('node:path');

const CHECK_TIMEOUT_MS = 8000;

function loadChecks(dir = __dirname) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .sort()
    .map((f) => require(path.join(dir, f)))
    .filter((c) => c && c.id && typeof c.run === 'function' && Array.isArray(c.appliesTo));
}

const checks = loadChecks();

function errorResult(check, summary) {
  return { id: check.id, title: check.title, status: 'error', points: 0, summary, details: [], fix: [] };
}

/** Normalise whatever a check returned so the UI can always rely on the shape. */
function normalise(check, r) {
  if (!r || typeof r !== 'object') return errorResult(check, 'Check returned no result.');
  const status = ['safe', 'warn', 'risk', 'error'].includes(r.status) ? r.status : 'error';
  const points = Number.isFinite(r.points) && r.points > 0 ? r.points : 0;
  return {
    id: check.id,
    title: r.title || check.title,
    status,
    points: status === 'error' ? 0 : points,
    summary: String(r.summary || ''),
    details: Array.isArray(r.details) ? r.details.map(String) : [],
    fix: Array.isArray(r.fix) ? r.fix.map(String) : [],
  };
}

/** Run one check with a hard timeout; never throws. */
async function runOne(check, input) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(errorResult(check, 'This check timed out - the service may be slow right now.')), CHECK_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(() => check.run(input)), timeout]);
    return normalise(check, result);
  } catch {
    return errorResult(check, 'This check failed unexpectedly - try again later.');
  } finally {
    clearTimeout(timer);
  }
}

/** Run every check that applies to the given input, in parallel. */
async function runChecks(input, list = checks) {
  const applicable = list.filter((c) => c.appliesTo.some((field) => Boolean(input[field])));
  const settled = await Promise.allSettled(applicable.map((c) => runOne(c, input)));
  return settled.map((s, i) => (s.status === 'fulfilled' ? s.value : errorResult(applicable[i], 'This check failed unexpectedly.')));
}

module.exports = { checks, runChecks, loadChecks };
