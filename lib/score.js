'use strict';
/**
 * Score engine - a pure function that turns check results into a Doxx Score.
 *   0-30  Low    (green)
 *   31-60 Medium (yellow)
 *   61-100 High  (red)
 */
const LEVELS = [
  { max: 30, level: 'low', label: 'Low exposure', color: '#2bff88' },
  { max: 60, level: 'medium', label: 'Medium exposure', color: '#ffd23f' },
  { max: 100, level: 'high', label: 'High exposure', color: '#ff3860' },
];

function levelFor(score) {
  return LEVELS.find((l) => score <= l.max) || LEVELS[LEVELS.length - 1];
}

/**
 * Pick the 3 most impactful fixes. Findings are ranked by points; we take the
 * first fix of each top finding, then second fixes, etc. (round-robin) so the
 * plan covers the biggest problems first. Each fix gets an `impact` = its
 * finding's points split evenly across ALL of that finding's fixes (doing
 * every fix of a finding removes its points), which the UI uses for
 * "your score could drop to X".
 */
function pickTopFixes(results, count = 3) {
  const ranked = results
    .filter((r) => r && r.points > 0 && Array.isArray(r.fix) && r.fix.length)
    .sort((a, b) => b.points - a.points);
  const picks = [];
  const seen = new Set();
  const maxFixes = Math.max(0, ...ranked.map((r) => r.fix.length));
  for (let i = 0; i < maxFixes && picks.length < count; i++) {
    for (const r of ranked) {
      if (picks.length >= count) break;
      const text = r.fix[i];
      if (!text || seen.has(text)) continue;
      seen.add(text);
      picks.push({ text, checkId: r.id, title: r.title, impact: Math.round((r.points / r.fix.length) * 10) / 10 });
    }
  }
  return picks;
}

/**
 * @param {Array<{points:number, fix:string[]}>} results
 * @returns {{score:number, rawScore:number, level:string, label:string, color:string, topFixes:Array}}
 */
function computeScore(results = []) {
  const list = Array.isArray(results) ? results : [];
  const rawScore = list.reduce((sum, r) => {
    const p = Number(r && r.points);
    return sum + (Number.isFinite(p) && p > 0 ? p : 0);
  }, 0);
  const score = Math.min(100, Math.round(rawScore));
  const { level, label, color } = levelFor(score);
  return { score, rawScore, level, label, color, topFixes: pickTopFixes(list) };
}

module.exports = { computeScore, levelFor, LEVELS };
