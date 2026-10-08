/* How Doxxable Are You? - frontend (vanilla JS, no build step).
 * Security note: every piece of user- or API-provided text is inserted with
 * textContent via the el() helper - never innerHTML. */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const USERNAME_RE = /^[A-Za-z0-9._-]{1,39}$/;
  const MIN_ANIMATION_MS = 3000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const REQUEST_TIMEOUT_MS = 45000;
  const noop = () => {};
  const FX = window.FX || { confetti: noop, burst: noop, burstAt: noop, shake: noop, flash: noop, toast: noop, floatText: noop, scramble: (n, t) => { n.textContent = t; }, addXP: noop, unlock: noop, used: noop, reduceMotion: true };

  /** The browser never got an HTTP response (server down, wrong URL, proxy/login page, timeout). */
  class NetworkError extends Error {}
  /** The server answered with an error (validation, rate limit...). */
  class ApiError extends Error {}

  /** Create an element; `text` is always set with textContent. */
  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** fetch() wrapper that separates "no response" from "server said no". */
  async function requestJSON(url, options = {}) {
    if (location.protocol === 'file:') {
      throw new NetworkError('This page was opened as a file. Run "npm start" and open http://localhost:3000 instead.');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { ...options, signal: ctrl.signal, credentials: 'same-origin' });
    } catch (err) {
      throw new NetworkError(err.name === 'AbortError'
        ? 'The scan timed out. The server may be overloaded - try again or use the demo data.'
        : 'Could not reach the scanner backend. Make sure "npm start" is still running in your terminal and reload this page.');
    } finally {
      clearTimeout(timer);
    }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      throw new NetworkError(`The server answered with a non-API page (HTTP ${res.status}). If you are behind a preview/login proxy, reload the page and sign in again.`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new ApiError(data.error || 'Too many scans - wait a few minutes and try again.');
    if (!res.ok) throw new ApiError(data.error || `Request failed (HTTP ${res.status}).`);
    return data;
  }

  function postJSON(url, body) {
    return requestJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  /* ================= Tabs ================= */
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    });
    tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (dir) selectTab(tabs[(i + dir + tabs.length) % tabs.length]);
      if (e.key === 'Home') selectTab(tabs[0]);
      if (e.key === 'End') selectTab(tabs[tabs.length - 1]);
    });
  });

  /* ================= Identity scan form ================= */
  const emailInput = $('#email');
  const usernameInput = $('#username');
  const consent = $('#consent');
  const scanBtn = $('#scan-btn');
  const demoBtn = $('#demo-btn');
  const formError = $('#form-error');
  let platformCount = 16;
  let busy = false;

  const STATIC_HOST = /\.github\.io$/i.test(location.hostname);
  const serverStatus = $('#server-status');
  function setServerStatus(state, text) {
    serverStatus.className = `server-status ${state}`;
    $('#server-status-text').textContent = text;
  }
  async function checkHealth() {
    try {
      const d = await requestJSON('/api/health');
      if (d.platforms) platformCount = d.platforms;
      setServerStatus('online', `Scanner online - ${platformCount} platforms armed`);
      return true;
    } catch (err) {
      if (STATIC_HOST) {
        setServerStatus('offline', 'Static demo build (GitHub Pages): live scans need the Node server. Demo data and Password Check work here.');
        return false;
      }
      setServerStatus('offline', 'Scanner offline - demo mode still works.');
      serverStatus.title = err.message;
      return false;
    }
  }
  checkHealth();
  setInterval(() => { if (!document.hidden && !busy) checkHealth(); }, 30000);

  function readInputs() {
    const email = emailInput.value.trim();
    const username = usernameInput.value.trim().replace(/^@/, '');
    const emailOk = EMAIL_RE.test(email);
    const userOk = USERNAME_RE.test(username);
    return { email, username, emailOk, userOk };
  }

  function updateFormState() {
    const { email, username, emailOk, userOk } = readInputs();
    emailInput.setAttribute('aria-invalid', String(Boolean(email) && !emailOk));
    usernameInput.setAttribute('aria-invalid', String(Boolean(username) && !userOk));
    const anyInvalid = (email && !emailOk) || (username && !userOk);
    scanBtn.disabled = busy || !consent.checked || !(emailOk || userOk) || Boolean(anyInvalid);
  }
  [emailInput, usernameInput, consent].forEach((n) => n.addEventListener('input', updateFormState));
  consent.addEventListener('change', updateFormState);

  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = !msg;
  }

  function setBusy(state) {
    busy = state;
    demoBtn.disabled = state;
    scanBtn.textContent = state ? 'Scanning...' : 'Scan me';
    scanBtn.classList.toggle('is-busy', state);
    updateFormState();
  }

  /* ================= Terminal animation ================= */
  const terminal = $('#terminal');
  const log = $('#terminal-log');

  function logLine(text, cls = '') {
    log.querySelectorAll('.cursor').forEach((n) => n.classList.remove('cursor'));
    const li = el('li', { class: `${cls} cursor`.trim() }, text);
    log.appendChild(li);
    return li;
  }

  const STATUS_ICON = { safe: '[ OK ]', warn: '[WARN]', risk: '[RISK]', error: '[FAIL]' };

  /**
   * Plays the "hacker terminal" while the request runs, for at least
   * MIN_ANIMATION_MS, then prints one line per completed check.
   */
  const radarBlips = $('#radar-blips');
  function setScanProgress(pct) {
    $('#scan-progress-bar').style.width = `${pct}%`;
    $('#radar-pct').textContent = `${Math.round(pct)}%`;
  }
  function addBlip(status) {
    const a = Math.random() * Math.PI * 2;
    const d = 18 + Math.random() * 28;
    const b = el('span', { class: `blip ${status}` });
    b.style.left = `${50 + Math.cos(a) * d}%`;
    b.style.top = `${50 + Math.sin(a) * d}%`;
    radarBlips.append(b);
  }

  async function runWithTerminal(request, { email, username, demo }) {
    terminal.hidden = false;
    terminal.classList.add('scanning');
    $('#results').hidden = true;
    log.textContent = '';
    radarBlips.textContent = '';
    setScanProgress(0);
    terminal.scrollIntoView({ behavior: FX.reduceMotion ? 'auto' : 'smooth', block: 'center' });
    const steps = [`$ doxx-check ${demo ? '--demo' : '--self'}`, 'Initialising scanner... no data will be stored.'];
    if (email || demo) steps.push('Scanning breach databases...', 'Checking public commits on GitHub...');
    if (username || demo) steps.push(`Probing ${platformCount} platforms for your username...`);
    steps.push('Correlating findings...');

    const started = Date.now();
    const pending = request.then((data) => ({ data }), (error) => ({ error }));
    const stepDelay = Math.max(350, (MIN_ANIMATION_MS - 400) / steps.length);
    for (const [i, s] of steps.entries()) {
      logLine(s, s.startsWith('$') ? 'dim' : '');
      setScanProgress(((i + 1) / steps.length) * 70);
      await sleep(stepDelay);
    }
    const outcome = await pending;
    terminal.classList.remove('scanning');
    const elapsed = Date.now() - started;
    if (elapsed < MIN_ANIMATION_MS) await sleep(MIN_ANIMATION_MS - elapsed);

    if (outcome.error) {
      logLine(`[FAIL] ${outcome.error.message}`, 'risk');
      throw outcome.error;
    }
    const total = outcome.data.results.length || 1;
    for (const [i, r] of outcome.data.results.entries()) {
      logLine(`${STATUS_ICON[r.status] || '[ ?? ]'} ${r.title}: ${r.summary}`, r.status === 'safe' ? '' : r.status);
      addBlip(r.status);
      setScanProgress(70 + ((i + 1) / total) * 30);
      await sleep(280);
    }
    logLine(`Done. Doxx Score = ${outcome.data.score}/100`, 'dim');
    return outcome.data;
  }

  /* ================= Results ================= */
  const VERDICTS = {
    low: 'Nice work - you are hard to find. Keep your guard up.',
    medium: 'A few quick fixes will make you much harder to find.',
    high: 'A stranger could connect a lot of dots - but it is fixable in 10 minutes.',
  };
  const LEVEL_COLORS = { low: '#2bff88', medium: '#ffd23f', high: '#ff3860' };
  const CIRCUMFERENCE = 2 * Math.PI * 88;
  let lastScan = null;
  let gaugeValue = 0;
  let gaugeAnim = 0;

  const RANKS = [
    { max: 10, name: 'GHOST', cls: 'low' },
    { max: 30, name: 'SHADOW', cls: 'low' },
    { max: 60, name: 'VISIBLE', cls: 'medium' },
    { max: 80, name: 'EXPOSED', cls: 'high' },
    { max: 100, name: 'OPEN BOOK', cls: 'high' },
  ];
  const rankFor = (score) => RANKS.find((r) => score <= r.max) || RANKS[RANKS.length - 1];
  const levelFor = (score) => (score <= 30 ? 'low' : score <= 60 ? 'medium' : 'high');

  function animateGauge(score, level, onDone) {
    const fill = $('#gauge-fill');
    const value = $('#score-value');
    const color = LEVEL_COLORS[level] || LEVEL_COLORS.low;
    fill.style.stroke = color;
    fill.style.color = color;
    fill.style.strokeDasharray = String(CIRCUMFERENCE);
    $('#gauge').setAttribute('aria-label', `Doxx score ${score} out of 100`);
    $('#gauge').className = `gauge gauge-${level}`;
    const from = gaugeValue;
    const duration = FX.reduceMotion ? 0 : from === 0 ? 1800 : 700;
    const start = performance.now();
    cancelAnimationFrame(gaugeAnim);
    const frame = (now) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(from + (score - from) * eased);
      gaugeValue = current;
      value.textContent = String(current);
      fill.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - current / 100));
      $('#hp-fill').style.width = `${100 - current}%`;
      $('#hp-text').textContent = String(100 - current);
      if (t < 1) gaugeAnim = requestAnimationFrame(frame);
      else if (onDone) onDone();
    };
    gaugeAnim = requestAnimationFrame(frame);
  }

  function renderCard(r) {
    const card = el('article', { class: `card risk-card ${r.status}` });
    const header = el('header');
    header.append(el('h4', {}, r.title), el('span', { class: `status-pill ${r.status}` }, r.status));
    card.append(header, el('p', { class: 'summary' }, r.summary));
    if (r.points) card.append(el('p', { class: 'points' }, `+${r.points} points`));
    if (r.details.length) {
      const det = el('details');
      det.append(el('summary', {}, `Details (${r.details.length})`));
      const ul = el('ul');
      r.details.forEach((d) => ul.append(el('li', {}, d)));
      det.append(ul);
      card.append(det);
    }
    if (r.fix.length) {
      card.append(el('p', { class: 'fix-title' }, 'How to fix'));
      const ul = el('ul');
      r.fix.forEach((f) => ul.append(el('li', {}, f)));
      card.append(ul);
    }
    return card;
  }

  function renderPlan(data) {
    const list = $('#plan-list');
    list.textContent = '';
    const fixes = data.topFixes || [];
    if (!fixes.length) {
      list.append(el('li', {}, 'Nothing urgent to fix - you are in good shape. Re-check every few months.'));
    }
    fixes.forEach((f, i) => {
      const li = el('li');
      const label = el('label');
      const box = el('input', { type: 'checkbox', 'data-impact': String(f.impact) });
      box.addEventListener('change', () => {
        updateProjection(data, true);
        if (box.checked && !box.dataset.rewarded) {
          box.dataset.rewarded = '1';
          FX.burstAt(box, '#2bff88', 36);
          FX.addXP(30, box);
          FX.unlock('quest', box);
        }
      });
      label.append(box, el('span', {}, `${i + 1}. ${f.text} `), el('span', { class: 'impact' }, `-${Math.round(f.impact)} pts`));
      li.append(label);
      list.append(li);
    });
    updateProjection(data, false);
  }

  function updateProjection(data, interactive) {
    const boxes = [...document.querySelectorAll('#plan-list input[type="checkbox"]')];
    const done = boxes.filter((b) => b.checked);
    const removed = done.reduce((s, b) => s + Number(b.dataset.impact || 0), 0);
    const allImpact = boxes.reduce((s, b) => s + Number(b.dataset.impact || 0), 0);
    const raw = typeof data.rawScore === 'number' ? data.rawScore : data.score;
    const projectedAll = Math.max(0, Math.min(100, Math.round(raw - allImpact)));
    const projectedNow = Math.max(0, Math.min(100, Math.round(raw - removed)));
    $('#plan-progress').style.width = boxes.length ? `${(done.length / boxes.length) * 100}%` : '100%';
    const text = !boxes.length
      ? `Score: ${data.score}`
      : done.length === boxes.length
        ? `All done! Your score could drop to ${projectedNow} once these fixes take effect.`
        : `${done.length}/${boxes.length} done - your score could drop to ${projectedAll} after fixing all three` +
          (done.length ? ` (${projectedNow} so far).` : '.');
    $('#plan-projection').textContent = text;
    if (interactive) {
      const lvl = levelFor(projectedNow);
      animateGauge(projectedNow, lvl);
      $('#rank').textContent = rankFor(projectedNow).name;
      $('#rank').className = `rank-stamp ${rankFor(projectedNow).cls}`;
      if (boxes.length && done.length === boxes.length) {
        FX.confetti(200);
        FX.unlock('cleanup', $('#plan-projection'));
      }
    }
  }

  function renderResults(data, demo) {
    lastScan = { score: data.score, level: data.level, label: data.label, scannedAt: data.scannedAt };
    $('#results').hidden = false;
    $('#demo-badge').hidden = !demo;
    const label = $('#level-label');
    label.textContent = data.label;
    label.className = `level-${data.level}`;
    $('#verdict').textContent = VERDICTS[data.level] || '';
    const cards = $('#cards');
    cards.textContent = '';
    data.results.forEach((r, i) => {
      const card = renderCard(r);
      card.classList.add('reveal');
      card.style.animationDelay = `${0.25 + i * 0.18}s`;
      cards.append(card);
    });
    renderPlan(data);
    $('#scanned-at').textContent = `Scanned ${new Date(data.scannedAt).toLocaleString()} - nothing was stored.`;
    const rank = rankFor(data.score);
    const rankNode = $('#rank');
    rankNode.className = `rank-stamp ${rank.cls}`;
    rankNode.textContent = '???';
    gaugeValue = 0;
    animateGauge(data.score, data.level, () => celebrate(data, demo, rank));
    $('#results-heading').focus({ preventScroll: true });
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Big reveal once the gauge lands. */
  function celebrate(data, demo, rank) {
    const rankNode = $('#rank');
    FX.scramble(rankNode, rank.name, 700);
    rankNode.classList.add('stamp-in');
    const gauge = $('#gauge');
    FX.burstAt(gauge, LEVEL_COLORS[data.level], 70);
    if (data.level === 'high') { FX.shake(); FX.flash('rgba(255,56,96,.35)'); }
    else if (data.level === 'low') FX.confetti(180);
    else FX.flash('rgba(255,210,63,.25)');
    FX.used('scan');
    if (demo) FX.unlock('demo', gauge);
    else FX.unlock('first_scan', gauge);
    if (!demo) {
      if (data.score <= 10) FX.unlock('ghost', gauge);
      if (data.score >= 81) FX.unlock('open_book', gauge);
      if (data.results.some((r) => r.id === 'breach' && r.status === 'risk')) FX.unlock('survivor', gauge);
    }
  }

  async function startScan(demo) {
    if (busy) return;
    showFormError('');
    const { email, username, emailOk, userOk } = readInputs();
    if (!demo && (!consent.checked || !(emailOk || userOk))) return;
    setBusy(true);
    try {
      const body = {};
      if (email) body.email = email;
      if (username) body.username = username;
      const request = demo
        ? requestJSON('/api/demo').catch((err) => (err instanceof NetworkError ? localDemo() : Promise.reject(err)))
        : postJSON('/api/scan', body);
      const data = await runWithTerminal(request, { email, username, demo });
      renderResults(data, demo);
      if (!demo) setServerStatus('online', `Scanner online - ${platformCount} platforms armed`);
    } catch (err) {
      terminal.classList.remove('scanning');
      if (err instanceof NetworkError && STATIC_HOST) {
        showFormError('Live scans need the Node server, which GitHub Pages cannot run. Press "Try demo data", or deploy the full app (see README > Deploy).');
      } else if (err instanceof NetworkError) {
        setServerStatus('offline', 'Scanner offline. Demo mode still works.');
        showFormError(`${err.message} You can still press "Try demo data".`);
      } else {
        if (!(err instanceof ApiError)) console.error(err);
        else setServerStatus('online', `Scanner online - ${platformCount} platforms armed`);
        showFormError(err.message || 'Something went wrong while showing your results.');
      }
    } finally {
      setBusy(false);
    }
  }

  /** Copy of GET /api/demo (fictional data from lib/demo.js) so the demo works even if the backend is unreachable. */
  const LOCAL_DEMO = {
      "score": 74,
      "rawScore": 74,
      "level": "high",
      "label": "High exposure",
      "color": "#ff3860",
      "results": [
        {
          "id": "breach",
          "title": "Data breaches",
          "status": "risk",
          "points": 47,
          "summary": "Found in 4 known breaches - including sensitive data (Passwords, Phone numbers).",
          "details": [
            "Breach: Canva",
            "Breach: LinkedIn",
            "Breach: Dropbox",
            "Breach: MyFitnessPal",
            "Exposed data types: Email addresses, Passwords, Names, Phone numbers, Usernames"
          ],
          "fix": [
            "Change the password on every listed site and anywhere you reused it",
            "Enable 2FA / passkeys",
            "Use a password manager to make unique passwords",
            "Watch for phishing mails referencing these services"
          ]
        },
        {
          "id": "github",
          "title": "GitHub email exposure",
          "status": "risk",
          "points": 15,
          "summary": "Your email is publicly visible on GitHub - anyone can harvest it from commit metadata.",
          "details": [
            "Public commits in: neo-demo/dotfiles",
            "Public commits in: neo-demo/hackathon-2024",
            "37 public commits authored with this email"
          ],
          "fix": [
            "Enable 'Keep my email addresses private' in GitHub Settings > Emails",
            "Turn on 'Block command line pushes that expose my email'",
            "Use your GitHub noreply address in git config user.email",
            "Rewrite history only if truly necessary"
          ]
        },
        {
          "id": "username",
          "title": "Username footprint",
          "status": "risk",
          "points": 12,
          "summary": "This username exists on 6 platforms - easy to link your accounts together.",
          "details": [
            "GitHub - https://github.com/neo_demo",
            "DEV Community - https://dev.to/neo_demo",
            "Chess.com - https://www.chess.com/member/neo_demo",
            "Docker Hub - https://hub.docker.com/u/neo_demo",
            "Keybase - https://keybase.io/neo_demo",
            "Hugging Face - https://huggingface.co/neo_demo",
            "Checked 16 sites, 1 inconclusive (Replit)"
          ],
          "fix": [
            "Use different usernames for personal vs. professional accounts",
            "Delete accounts you no longer use",
            "Make old profiles private or remove personal info from bios"
          ]
        }
      ],
      "topFixes": [
        {
          "text": "Change the password on every listed site and anywhere you reused it",
          "checkId": "breach",
          "title": "Data breaches",
          "impact": 11.8
        },
        {
          "text": "Enable 'Keep my email addresses private' in GitHub Settings > Emails",
          "checkId": "github",
          "title": "GitHub email exposure",
          "impact": 3.8
        },
        {
          "text": "Use different usernames for personal vs. professional accounts",
          "checkId": "username",
          "title": "Username footprint",
          "impact": 4
        }
      ],
      "demo": true
    };
  function localDemo() {
    return { ...LOCAL_DEMO, scannedAt: new Date().toISOString() };
  }

  $('#scan-form').addEventListener('submit', (e) => { e.preventDefault(); startScan(false); });
  demoBtn.addEventListener('click', () => startScan(true));

  /* ================= Share card (canvas -> PNG) ================= */
  // Deliberately contains NO email or username - only score, level and date.
  $('#share-btn').addEventListener('click', () => {
    if (!lastScan) return;
    const { score, level, label } = lastScan;
    const color = LEVEL_COLORS[level];
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 630;
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 1200, 630);
    bg.addColorStop(0, '#070b14');
    bg.addColorStop(1, '#0f1d33');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1200, 630);
    ctx.strokeStyle = 'rgba(0,229,255,0.07)';
    for (let x = 0; x < 1200; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke(); }
    for (let y = 0; y < 630; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke(); }

    const mono = 'ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = '#2bff88';
    ctx.font = `28px ${mono}`;
    ctx.fillText('root@privacy:~$ ./doxx-check --self', 70, 90);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 64px ${mono}`;
    ctx.fillText('How Doxxable', 70, 190);
    ctx.fillText('Am I?', 70, 265);
    ctx.fillStyle = color;
    ctx.font = `bold 46px ${mono}`;
    ctx.fillText(label, 70, 360);
    ctx.fillStyle = '#8ea3c7';
    ctx.font = `28px ${mono}`;
    ctx.fillText(VERDICTS[level], 70, 420, 620);
    ctx.fillStyle = '#ffd23f';
    ctx.font = `bold 30px ${mono}`;
    ctx.fillText(`PRIVACY CLASS: ${rankFor(score).name}`, 70, 490, 640);
    ctx.fillStyle = '#8ea3c7';
    ctx.font = `28px ${mono}`;
    ctx.fillText('Check yourself - nothing is stored. Open source.', 70, 560, 640);

    const cx = 930, cy = 315, r = 170;
    ctx.lineWidth = 30;
    ctx.strokeStyle = '#16233a';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 25;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * score) / 100); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `bold 120px ${mono}`;
    ctx.fillText(String(score), cx, cy + 35);
    ctx.fillStyle = '#8ea3c7';
    ctx.font = `30px ${mono}`;
    ctx.fillText('/ 100 DOXX SCORE', cx, cy + 85);

    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `doxx-score-${score}.png` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      FX.unlock('sharer', $('#share-btn'));
    }, 'image/png');
  });

  /* ================= Password Autopsy (browser only) ================= */
  const pw = $('#pw');
  const pwResult = $('#pw-result');
  $('#pw-toggle').addEventListener('click', (e) => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  function strength(value) {
    if (!value) return { score: 0, label: '-' };
    let pool = 0;
    if (/[a-z]/.test(value)) pool += 26;
    if (/[A-Z]/.test(value)) pool += 26;
    if (/[0-9]/.test(value)) pool += 10;
    if (/[^A-Za-z0-9]/.test(value)) pool += 33;
    let bits = value.length * Math.log2(Math.max(pool, 1));
    if (/password|qwerty|letmein|welcome|admin|iloveyou|dragon|monkey|123456|abc123/i.test(value)) bits = Math.min(bits, 20);
    if (/^[A-Za-z]+\d{1,4}[!.?]?$/.test(value)) bits *= 0.7;
    if (/(.)\1{2,}/.test(value)) bits *= 0.8;
    const levels = [[28, 'Paper-thin'], [40, 'Weak'], [60, 'Decent'], [80, 'Strong'], [Infinity, 'Fortress']];
    const idx = levels.findIndex(([max]) => bits < max);
    return { score: idx, label: levels[idx][1], bits: Math.round(bits) };
  }
  const STRENGTH_COLORS = ['#ff3860', '#ff7a45', '#ffd23f', '#2bff88', '#00e5ff'];
  pw.addEventListener('input', () => {
    const s = strength(pw.value);
    const fill = $('#strength-fill');
    fill.style.width = pw.value ? `${((s.score + 1) / 5) * 100}%` : '0';
    fill.style.background = STRENGTH_COLORS[s.score];
    fill.style.color = STRENGTH_COLORS[s.score];
    $('#strength-text').textContent = pw.value ? `Strength: ${s.label} (~${s.bits} bits, estimated locally)` : 'Strength: -';
  });

  async function sha1Hex(text) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function pwBox(cls, title, big, text) {
    const box = el('div', { class: `result-box ${cls}` });
    box.append(el('h3', {}, title));
    if (big) box.append(el('p', { class: 'big-number' }, big));
    box.append(el('p', {}, text));
    pwResult.textContent = '';
    pwResult.append(box);
  }

  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = pw.value;
    if (!value) return pwBox('meh', 'Type a password first', '', 'Nothing was sent anywhere.');
    if (!window.crypto || !crypto.subtle) {
      return pwBox('meh', 'Not available', '', 'Your browser needs a secure context (https or localhost) for hashing.');
    }
    const btn = $('#pw-btn');
    btn.disabled = true;
    btn.textContent = 'Checking...';
    try {
      const hash = await sha1Hex(value);
      FX.used('password');
      const prefix = hash.slice(0, 5);
      const suffix = hash.slice(5);
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
        referrerPolicy: 'no-referrer',
      });
      if (!res.ok) throw new Error(`Service responded ${res.status}`);
      const text = await res.text();
      let count = 0;
      for (const line of text.split('\n')) {
        const [s, n] = line.trim().split(':');
        if (s === suffix) { count = parseInt(n, 10) || 0; break; }
      }
      if (count > 0) {
        FX.shake();
        FX.flash('rgba(255,56,96,.3)');
        FX.unlock('pw_pwned', btn);
        pwBox('bad', 'Pwned!', count.toLocaleString(), `This password appeared ${count.toLocaleString()} time${count === 1 ? '' : 's'} in known leaks. Stop using it everywhere and switch to a unique password from a password manager.`);
      } else {
        FX.burstAt(btn, '#2bff88', 50);
        FX.unlock('pw_safe', btn);
        pwBox('good', 'Not found in known leaks', '0', 'Good sign - but still use it on only one site and enable 2FA.');
      }
    } catch {
      pwBox('meh', 'Could not check right now', '', 'The Pwned Passwords service is unreachable. Your password was not sent anywhere.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Check password';
    }
  });

  /* ================= QR X-Ray ================= */
  const qrFile = $('#qr-file');
  const qrUrl = $('#qr-url');
  const qrError = $('#qr-error');
  const qrResult = $('#qr-result');

  function showQrError(msg) {
    qrError.textContent = msg;
    qrError.hidden = !msg;
  }

  async function decodeQr(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (typeof window.jsQR === 'function') {
      const code = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      return code ? code.data : null;
    }
    if ('BarcodeDetector' in window) {
      const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(canvas);
      return found.length ? found[0].rawValue : null;
    }
    throw new Error('The QR decoder could not load (offline?). Paste the URL instead.');
  }

  qrFile.addEventListener('change', async () => {
    showQrError('');
    qrResult.textContent = '';
    const file = qrFile.files && qrFile.files[0];
    if (!file) return;
    try {
      const data = await decodeQr(file);
      if (!data) return showQrError('No QR code found in that image - try a sharper, closer photo.');
      const decoded = el('p', { class: 'decoded' }, `Decoded: ${data}`);
      qrResult.append(decoded);
      if (/^(https?:\/\/|www\.)/i.test(data.trim())) {
        qrUrl.value = data.trim();
        unroll(data.trim());
      } else {
        qrResult.append(el('p', {}, 'This QR code contains text, not a web link - nothing to follow.'));
      }
    } catch (err) {
      showQrError(err.message || 'Could not read that image.');
    }
  });

  const VERDICT_TEXT = {
    'looks-ok': ['good', 'No obvious red flags'],
    caution: ['meh', 'Be careful'],
    suspicious: ['bad', 'Suspicious link'],
  };

  async function unroll(url) {
    showQrError('');
    const btn = $('#qr-btn');
    btn.disabled = true;
    btn.textContent = 'Following redirects...';
    [...qrResult.querySelectorAll('.result-box')].forEach((n) => n.remove());
    try {
      const data = await postJSON('/api/unroll', { url });
      const [cls, title] = VERDICT_TEXT[data.verdict] || VERDICT_TEXT.caution;
      const box = el('div', { class: `result-box ${cls}` });
      box.append(el('h3', {}, title));
      const final = el('p');
      final.append('Final destination: ', el('strong', {}, data.finalDomain));
      box.append(final, el('p', { class: 'hint' }, `${data.hops} redirect${data.hops === 1 ? '' : 's'}`));
      const chain = el('ol', { class: 'chain' });
      data.chain.forEach((hop) => {
        const li = el('li');
        li.append(el('span', { class: 'status' }, hop.status ? String(hop.status) : '---'), document.createTextNode(hop.url));
        if (hop.note) li.append(el('em', {}, ` (${hop.note})`));
        chain.append(li);
      });
      box.append(chain);
      if (data.signals.length) {
        box.append(el('p', { class: 'fix-title' }, 'Risk signals'));
        const ul = el('ul', { class: 'signals' });
        data.signals.forEach((s) => ul.append(el('li', {}, s)));
        box.append(ul);
      }
      box.append(el('p', { class: 'hint' }, 'We never opened the final page in your browser. Only visit it if you trust the domain.'));
      qrResult.append(box);
      FX.used('qr');
      FX.unlock('qr', btn);
      if (data.verdict === 'suspicious') FX.shake();
    } catch (err) {
      showQrError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'X-Ray this link';
    }
  }

  $('#qr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = qrUrl.value.trim();
    if (!url) return showQrError('Upload a QR image or paste a URL first.');
    unroll(url);
  });

  updateFormState();
})();
