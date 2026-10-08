'use strict';
/**
 * Breach check - asks the free XposedOrNot API whether the email appears in
 * known data breaches, and (best effort) which data types were exposed.
 */
const { safeFetch } = require('../lib/safeFetch');

const API = 'https://api.xposedornot.com/v1';
const SENSITIVE = /password|phone|physical address|financial|credit card|bank|account balance|government|social security|passport|tax/i;
const FIX = [
  'Change the password on every listed site and anywhere you reused it',
  'Enable 2FA / passkeys',
  'Use a password manager to make unique passwords',
  'Watch for phishing mails referencing these services',
];

/** Flatten the nested `breaches` array ([["A","B"]] or ["A;B"]) into unique names. */
function flattenBreaches(raw) {
  const out = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'string') v.split(';').map((s) => s.trim()).filter(Boolean).forEach((s) => out.add(s));
  };
  walk(raw);
  return [...out];
}

/** Collect exposed data type names ("Passwords", "Phone numbers", ...) from breach-analytics. */
function extractDataTypes(analytics) {
  const types = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && node.name.startsWith('data_')) types.add(node.name.slice(5));
    if (node.children) walk(node.children);
  };
  walk(analytics && analytics.BreachMetrics && analytics.BreachMetrics.xposed_data);
  return [...types];
}

async function fetchDataTypes(email) {
  try {
    const res = await safeFetch(`${API}/breach-analytics?email=${encodeURIComponent(email)}`, { timeout: 6000 });
    if (!res.ok) return [];
    return extractDataTypes(await res.json());
  } catch {
    return [];
  }
}

module.exports = {
  id: 'breach',
  title: 'Data breaches',
  appliesTo: ['email'],
  async run({ email }) {
    const base = { id: this.id, title: this.title };
    try {
      const [res, dataTypes] = await Promise.all([
        safeFetch(`${API}/check-email/${encodeURIComponent(email)}`, { timeout: 7000 }),
        fetchDataTypes(email),
      ]);
      if (res.status === 429) {
        return { ...base, status: 'error', points: 0, summary: 'Breach database is rate-limiting us - try again in a minute.', details: [], fix: [] };
      }
      const body = res.status === 404 ? null : await res.json().catch(() => null);
      if (res.status !== 404 && !res.ok) {
        return { ...base, status: 'error', points: 0, summary: 'Breach database is unavailable right now - try again later.', details: [], fix: [] };
      }
      const breaches = flattenBreaches(body && body.breaches);
      if (!breaches.length) {
        return { ...base, status: 'safe', points: 0, summary: 'No known breaches found for this email.', details: [], fix: [] };
      }

      const sensitive = dataTypes.filter((t) => SENSITIVE.test(t));
      const points = Math.min(breaches.length, 5) * 8 + (sensitive.length ? 15 : 0);
      const details = breaches.slice(0, 10).map((b) => `Breach: ${b}`);
      if (breaches.length > 10) details.push(`...and ${breaches.length - 10} more`);
      if (dataTypes.length) details.push(`Exposed data types: ${dataTypes.slice(0, 12).join(', ')}`);
      return {
        ...base,
        status: 'risk',
        points,
        summary: `Found in ${breaches.length} known breach${breaches.length === 1 ? '' : 'es'}` +
          (sensitive.length ? ` - including sensitive data (${sensitive.slice(0, 3).join(', ')}).` : '.'),
        details,
        fix: FIX,
      };
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return {
        ...base,
        status: 'error',
        points: 0,
        summary: timedOut ? 'Breach database timed out - try again later.' : 'Could not reach the breach database.',
        details: [],
        fix: [],
      };
    }
  },
  _internal: { flattenBreaches, extractDataTypes },
};
