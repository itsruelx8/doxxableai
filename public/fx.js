/* How Doxxable Are You? - visual effects + game layer (vanilla JS).
 * Exposes window.FX. Everything is in-memory only: XP and badges reset when
 * the page is closed, and nothing about the user is stored anywhere. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const NEON = ['#00e5ff', '#2bff88', '#ff3860', '#ffd23f', '#b16cff'];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  /* ---------- Matrix rain background ---------- */
  function startMatrix(canvas) {
    if (!canvas || reduceMotion) return;
    const ctx = canvas.getContext('2d');
    const glyphs = '01<>/{}[]$#@*+=%&ABCDEFXYZ0123456789';
    const size = 16;
    let cols = [];
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cols = Array.from({ length: Math.ceil(canvas.width / size) }, () => rand(-50, 0));
    }
    resize();
    window.addEventListener('resize', resize);
    let last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (document.hidden || t - last < 55) return;
      last = t;
      ctx.fillStyle = 'rgba(7, 11, 20, 0.12)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${size}px monospace`;
      cols.forEach((y, i) => {
        const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
        ctx.fillStyle = Math.random() > 0.975 ? '#e6fffb' : i % 7 === 0 ? '#00e5ff' : '#2bff88';
        ctx.fillText(ch, i * size, y * size);
        cols[i] = y * size > canvas.height && Math.random() > 0.975 ? 0 : y + 1;
      });
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Particle overlay: confetti + bursts ---------- */
  const overlay = el('canvas', 'fx-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const octx = overlay.getContext('2d');
  let particles = [];
  let running = false;

  function sizeOverlay() {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
  }

  function loop() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.vy += p.gravity;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 1;
      octx.save();
      octx.globalAlpha = Math.min(1, p.life / 40);
      octx.translate(p.x, p.y);
      octx.rotate(p.rot);
      octx.fillStyle = p.color;
      octx.shadowColor = p.color;
      octx.shadowBlur = p.glow;
      if (p.shape === 'rect') octx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else { octx.beginPath(); octx.arc(0, 0, p.size / 2, 0, Math.PI * 2); octx.fill(); }
      octx.restore();
    }
    if (particles.length) requestAnimationFrame(loop);
    else { running = false; octx.clearRect(0, 0, overlay.width, overlay.height); }
  }

  function spawn(list) {
    if (reduceMotion) return;
    particles.push(...list);
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  function confetti(amount = 160) {
    const w = window.innerWidth;
    spawn(Array.from({ length: amount }, () => ({
      x: rand(0, w), y: rand(-80, -10), vx: rand(-3, 3), vy: rand(2, 7), gravity: 0.12, drag: 0.995,
      size: rand(7, 13), rot: rand(0, 6), vr: rand(-0.2, 0.2), life: rand(140, 220),
      color: NEON[Math.floor(Math.random() * NEON.length)], shape: 'rect', glow: 6,
    })));
  }

  function burst(x, y, color, amount = 40) {
    spawn(Array.from({ length: amount }, () => {
      const a = rand(0, Math.PI * 2);
      const s = rand(2, 9);
      return {
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 0.05, drag: 0.95,
        size: rand(3, 7), rot: 0, vr: 0, life: rand(40, 80), color: color || NEON[Math.floor(Math.random() * 3)], shape: 'dot', glow: 14,
      };
    }));
  }

  function burstAt(node, color, amount) {
    if (!node) return;
    const r = node.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, color, amount);
  }

  /* ---------- Screen shake & flash ---------- */
  function shake() {
    if (reduceMotion) return;
    document.body.classList.remove('shake');
    void document.body.offsetWidth;
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 700);
  }

  function flash(color) {
    if (reduceMotion) return;
    const f = el('div', 'fx-flash');
    f.style.background = color;
    document.body.append(f);
    setTimeout(() => f.remove(), 600);
  }

  /* ---------- Floating "+XP" text ---------- */
  function floatText(text, x, y, color) {
    const n = el('div', 'float-text', text);
    n.style.left = `${x}px`;
    n.style.top = `${y}px`;
    n.style.color = color || '#2bff88';
    n.setAttribute('aria-hidden', 'true');
    document.body.append(n);
    setTimeout(() => n.remove(), 1400);
  }

  /* ---------- Toasts ---------- */
  const toastHost = el('div', 'toast-host');
  toastHost.setAttribute('aria-live', 'polite');
  function toast(title, text, kind = 'badge') {
    const t = el('div', `toast toast-${kind}`);
    t.append(el('div', 'toast-icon', kind === 'level' ? 'LV' : '★'), el('div', 'toast-body'));
    t.lastChild.append(el('strong', '', title), el('span', '', text));
    toastHost.append(t);
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4200);
  }

  /* ---------- Game: XP, levels, achievements ---------- */
  const LEVELS = [
    { xp: 0, title: 'Noob' },
    { xp: 100, title: 'Script Kiddie' },
    { xp: 250, title: 'Privacy Padawan' },
    { xp: 450, title: 'OpSec Operator' },
    { xp: 700, title: 'Ghost Protocol' },
    { xp: 1000, title: 'Digital Phantom' },
  ];

  const BADGES = [
    { id: 'first_scan', name: 'Know Thyself', desc: 'Ran your first identity scan', xp: 100 },
    { id: 'demo', name: 'Test Pilot', desc: 'Tried the demo data', xp: 25 },
    { id: 'ghost', name: 'Ghost Mode', desc: 'Scored 10 or less', xp: 150 },
    { id: 'survivor', name: 'Breach Survivor', desc: 'Found in a breach - and still standing', xp: 50 },
    { id: 'open_book', name: 'Open Book', desc: 'Scored 81+ (time for a cleanup!)', xp: 50 },
    { id: 'quest', name: 'First Fix', desc: 'Completed a cleanup quest', xp: 40 },
    { id: 'cleanup', name: 'Cleanup Crew', desc: 'Completed all 3 cleanup quests', xp: 150 },
    { id: 'pw_safe', name: 'Uncrackable', desc: 'Checked a password that is not in any known leak', xp: 60 },
    { id: 'pw_pwned', name: 'Oof.', desc: 'Found a leaked password before attackers used it', xp: 40 },
    { id: 'qr', name: 'QR Detective', desc: 'X-rayed a link', xp: 60 },
    { id: 'sharer', name: 'Show-off', desc: 'Downloaded your share card', xp: 30 },
    { id: 'completionist', name: 'Completionist', desc: 'Used scan, password check and QR X-Ray', xp: 200 },
  ];

  const state = { xp: 0, level: 0, unlocked: new Set(), used: new Set() };

  function levelFor(xp) {
    let i = 0;
    LEVELS.forEach((l, idx) => { if (xp >= l.xp) i = idx; });
    return i;
  }

  function renderHud() {
    const lvl = LEVELS[state.level];
    const next = LEVELS[state.level + 1];
    const pct = next ? ((state.xp - lvl.xp) / (next.xp - lvl.xp)) * 100 : 100;
    const q = (s) => document.querySelector(s);
    if (!q('#hud')) return;
    q('#hud-level').textContent = `LV ${state.level + 1}`;
    q('#hud-title').textContent = lvl.title;
    q('#hud-xp').textContent = next ? `${state.xp} / ${next.xp} XP` : `${state.xp} XP - MAX`;
    q('#hud-bar').style.width = `${Math.min(100, pct)}%`;
    q('#hud-badges').textContent = `${state.unlocked.size}/${BADGES.length}`;
    q('#hud').setAttribute('aria-label', `Level ${state.level + 1} ${lvl.title}, ${state.xp} XP, ${state.unlocked.size} of ${BADGES.length} badges`);
    const list = q('#badge-list');
    if (list) {
      list.textContent = '';
      BADGES.forEach((b) => {
        const got = state.unlocked.has(b.id);
        const li = el('li', got ? 'badge-item unlocked' : 'badge-item');
        li.append(el('span', 'badge-medal', got ? '★' : '?'), el('div'));
        li.lastChild.append(el('strong', '', got ? b.name : 'Locked'), el('span', '', `${b.desc} (+${b.xp} XP)`));
        list.append(li);
      });
    }
  }

  function addXP(amount, anchor) {
    if (!amount) return;
    state.xp += amount;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      floatText(`+${amount} XP`, r.left + r.width / 2, r.top);
    }
    const lvl = levelFor(state.xp);
    const hud = document.querySelector('#hud');
    if (hud) { hud.classList.remove('pulse'); void hud.offsetWidth; hud.classList.add('pulse'); }
    if (lvl > state.level) {
      state.level = lvl;
      toast(`Level up! LV ${lvl + 1}`, LEVELS[lvl].title, 'level');
      confetti(90);
    }
    renderHud();
  }

  function unlock(id, anchor) {
    const b = BADGES.find((x) => x.id === id);
    if (!b || state.unlocked.has(id)) return;
    state.unlocked.add(id);
    toast(`Achievement unlocked: ${b.name}`, b.desc);
    burstAt(document.querySelector('#hud-badges-btn'), '#ffd23f', 30);
    addXP(b.xp, anchor);
  }

  function used(feature) {
    state.used.add(feature);
    if (['scan', 'password', 'qr'].every((f) => state.used.has(f))) unlock('completionist');
  }

  /* ---------- Misc: mouse spotlight, button ripples, title glitch ---------- */
  function wireAmbient() {
    if (!reduceMotion) {
      window.addEventListener('pointermove', (e) => {
        document.documentElement.style.setProperty('--mx', `${e.clientX}px`);
        document.documentElement.style.setProperty('--my', `${e.clientY}px`);
      }, { passive: true });
    }
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn || btn.disabled || reduceMotion) return;
      const r = btn.getBoundingClientRect();
      const ripple = el('span', 'ripple');
      ripple.style.left = `${e.clientX - r.left}px`;
      ripple.style.top = `${e.clientY - r.top}px`;
      btn.append(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
    const dlg = document.querySelector('#badge-dialog');
    const open = document.querySelector('#hud-badges-btn');
    if (dlg && open && typeof dlg.showModal === 'function') {
      open.addEventListener('click', () => { renderHud(); dlg.showModal(); });
      dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    }
  }

  /** Scramble-decode text effect ("hacker reveal"). */
  function scramble(node, finalText, duration = 900) {
    if (!node) return;
    if (reduceMotion) { node.textContent = finalText; return; }
    const chars = '!<>-_\\/[]{}=+*^?#01';
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const revealed = Math.floor(finalText.length * t);
      let out = finalText.slice(0, revealed);
      for (let i = revealed; i < finalText.length; i++) out += finalText[i] === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)];
      node.textContent = out;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  document.addEventListener('DOMContentLoaded', () => {
    sizeOverlay();
    window.addEventListener('resize', sizeOverlay);
    document.body.append(overlay, toastHost);
    startMatrix(document.querySelector('#matrix'));
    wireAmbient();
    renderHud();
    const title = document.querySelector('.hero h1');
    if (title) scramble(title, title.dataset.text || title.textContent, 1200);
  });

  window.FX = { confetti, burst, burstAt, shake, flash, toast, floatText, scramble, addXP, unlock, used, reduceMotion };
})();
