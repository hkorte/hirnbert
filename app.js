'use strict';

// ---------- Konstanten ----------
const STATE_KEY = 'hirnbert.v1';
const PW_KEY = 'hirnbert.pw';
const DAY = 86400000;
// Leitner-Boxen: 1 = falsch/neu gelernt, 5 = sitzt. Wert = Tage bis zur nächsten Abfrage.
const INTERVAL_DAYS = { 2: 1, 3: 3, 4: 7, 5: 21 };
const MASTERED_BOX = 4;
const MAX_RETRIES = 2;
const CHAPTER_COLORS = ['#58cc02', '#1cb0f6', '#ce82ff', '#ff9600', '#ff4b4b', '#ff86c0', '#2bc3a8', '#ffc800'];

const app = document.getElementById('app');
let DATA = null;          // { kapitel: [...] }
let Q = new Map();        // id -> { id, ch, q, a, k, l?, e?, nr }
let S = loadState();
let lesson = null;
let screen = 'home';

// ---------- State ----------
function defaultState() {
  return { cards: {}, xp: 0, days: {}, settings: { len: 10, goal: 20, sound: true }, lastExport: null };
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY));
    if (s && s.cards) return { ...defaultState(), ...s, settings: { ...defaultState().settings, ...s.settings } };
  } catch (e) { /* leer oder kaputt */ }
  return defaultState();
}
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(S)); } catch (e) { toast('Speichern fehlgeschlagen!'); }
}

function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfDay(t = Date.now()) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function todayCount() { return S.days[dayKey()] || 0; }
function streak() {
  let n = 0;
  let t = Date.now();
  if (!S.days[dayKey(t)]) t -= DAY; // heute noch nichts gemacht: Streak von gestern zählt noch
  while (S.days[dayKey(t)]) { n++; t -= DAY; }
  return n;
}

// ---------- Leitner ----------
function grade(id, ok) {
  const c = S.cards[id] || { b: 0, ok: 0, bad: 0 };
  const now = Date.now();
  if (ok) {
    c.b = Math.min(Math.max(c.b, 1) + 1, 5);
    c.ok++;
    c.due = startOfDay(now) + INTERVAL_DAYS[c.b] * DAY;
  } else {
    c.b = 1;
    c.bad++;
    c.due = now;
  }
  c.last = now;
  S.cards[id] = c;
}
function status(id) {
  const c = S.cards[id];
  if (!c) return 'new';
  if (c.b <= 1) return 'wrong';
  if (c.b >= MASTERED_BOX) return 'mastered';
  return 'learning';
}
function isDue(id, now = Date.now()) { const c = S.cards[id]; return !!c && c.due <= now; }
function countBy(ids) {
  const r = { new: 0, wrong: 0, learning: 0, mastered: 0, due: 0 };
  const now = Date.now();
  for (const id of ids) { r[status(id)]++; if (isDue(id, now)) r.due++; }
  return r;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

function pickLesson(mode, chapterNr) {
  const len = S.settings.len;
  const pool = [...Q.values()].filter((q) => chapterNr == null || q.ch.nr === chapterNr).map((q) => q.id);
  if (mode === 'mistakes') {
    return shuffle(pool.filter((id) => status(id) === 'wrong')
      .sort((a, b) => S.cards[b].bad - S.cards[a].bad).slice(0, len));
  }
  const now = Date.now();
  const due = pool.filter((id) => isDue(id, now))
    .sort((a, b) => S.cards[a].b - S.cards[b].b || S.cards[a].due - S.cards[b].due);
  const fresh = pool.filter((id) => !S.cards[id]);
  let picked = due.slice(0, len);
  if (picked.length < len) picked = picked.concat(fresh.slice(0, len - picked.length));
  if (picked.length === 0 && chapterNr != null) {
    // Kapitel komplett durch und nichts fällig: freies Üben, Schwächste zuerst
    picked = pool.slice().sort((a, b) => S.cards[a].b - S.cards[b].b || S.cards[a].due - S.cards[b].due).slice(0, len);
  }
  return shuffle(picked);
}

// ---------- Crypto ----------
function b64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
async function decryptData(enc, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.ct));
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

let encCache = null;
async function unlock(password) {
  if (!encCache) encCache = await (await fetch('data.enc.json', { cache: 'no-cache' })).json();
  DATA = await decryptData(encCache, password);
  Q = new Map();
  for (const ch of DATA.kapitel) {
    for (const q of ch.fragen) {
      const id = `${ch.nr}-${q.nr}`;
      Q.set(id, { ...q, id, ch });
    }
  }
}

// ---------- Hilfen ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
function confetti(n = 70) {
  const box = document.getElementById('confetti');
  const colors = ['#58cc02', '#1cb0f6', '#ffc800', '#ff4b4b', '#ce82ff', '#ff86c0', '#ff9600'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = pick(colors);
    p.style.animationDuration = 1.8 + Math.random() * 1.8 + 's';
    p.style.animationDelay = Math.random() * 0.5 + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
    setTimeout(() => p.remove(), 4500);
  }
}

let audioCtx = null;
function sound(kind) {
  if (!S.settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = { good: [660, 880], bad: [220, 175], done: [523, 659, 784, 1047] }[kind];
    const t0 = audioCtx.currentTime;
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = kind === 'bad' ? 'square' : 'triangle';
      o.frequency.value = f;
      const t = t0 + i * (kind === 'done' ? 0.11 : 0.09);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'bad' ? 0.06 : 0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(audioCtx.destination);
      o.start(t);
      o.stop(t + 0.25);
    });
  } catch (e) { /* kein Audio */ }
}

// ---------- Maskottchen ----------
function brain(mood = 'happy', cls = '') {
  const lobes = [[34, 44, 24], [60, 30, 26], [86, 44, 24], [30, 66, 20], [90, 66, 20], [60, 62, 34]];
  const outline = lobes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r + 3}"/>`).join('');
  const fill = lobes.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('');
  const openEyes = (dy = 0) => `
    <g class="blink">
      <ellipse cx="47" cy="60" rx="9" ry="10" fill="#fff" stroke="#3c3c4f" stroke-width="2"/>
      <ellipse cx="73" cy="60" rx="9" ry="10" fill="#fff" stroke="#3c3c4f" stroke-width="2"/>
      <circle cx="48" cy="${62 + dy}" r="5" fill="#3c3c4f"/><circle cx="74" cy="${62 + dy}" r="5" fill="#3c3c4f"/>
      <circle cx="50" cy="${59 + dy}" r="1.8" fill="#fff"/><circle cx="76" cy="${59 + dy}" r="1.8" fill="#fff"/>
    </g>`;
  const faces = {
    happy: openEyes() + '<path d="M52 76 Q60 87 68 76 Z" fill="#7a1f3d"/><ellipse cx="60" cy="81" rx="4" ry="2.2" fill="#ff5a8a"/>',
    sad: openEyes(2) +
      '<path d="M38 46 l14 5 M82 46 l-14 5" stroke="#3c3c4f" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M52 83 Q60 75 68 83" fill="none" stroke="#7a1f3d" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M84 70 q-3 6 0 8 q3 -2 0 -8" fill="#7fd3ff"/>',
    cheer: '<path d="M40 62 q7 -9 14 0 M66 62 q7 -9 14 0" fill="none" stroke="#3c3c4f" stroke-width="3.5" stroke-linecap="round"/>' +
      '<path d="M49 73 Q60 92 71 73 Z" fill="#7a1f3d"/><ellipse cx="60" cy="84" rx="5" ry="3" fill="#ff5a8a"/>' +
      '<path d="M27 72 q-14 -6 -15 -24 M93 72 q14 -6 15 -24" fill="none" stroke="#e0609a" stroke-width="5" stroke-linecap="round"/>' +
      '<circle cx="12" cy="46" r="4" fill="#e0609a"/><circle cx="108" cy="46" r="4" fill="#e0609a"/>',
    think: openEyes(-4) + '<path d="M55 80 h10" stroke="#7a1f3d" stroke-width="3" stroke-linecap="round"/>',
  };
  return `<svg class="mascot ${cls}" viewBox="0 0 120 110" aria-hidden="true">
    <ellipse cx="48" cy="101" rx="9" ry="5" fill="#e0609a"/><ellipse cx="72" cy="101" rx="9" ry="5" fill="#e0609a"/>
    <g fill="#e0609a">${outline}</g>
    <g fill="#ff9ec7">${fill}</g>
    <ellipse cx="42" cy="28" rx="10" ry="5" fill="#fff" opacity=".45" transform="rotate(-25 42 28)"/>
    <g fill="none" stroke="#e86aa6" stroke-width="3" stroke-linecap="round">
      <path d="M60 8 C55 18 65 26 60 38"/><path d="M24 46 q6 -8 14 -4"/><path d="M82 42 q8 -6 14 2"/>
      <path d="M43 18 q7 4 4 13"/><path d="M77 18 q-7 4 -4 13"/><path d="M20 70 q7 2 9 -6"/><path d="M100 70 q-7 2 -9 -6"/>
    </g>
    <ellipse cx="37" cy="75" rx="6" ry="4" fill="#ff5a9a" opacity=".45"/><ellipse cx="83" cy="75" rx="6" ry="4" fill="#ff5a9a" opacity=".45"/>
    ${faces[mood] || faces.happy}
  </svg>`;
}

// ---------- Screens ----------
function render() {
  window.scrollTo(0, 0);
  if (!DATA) return renderLock();
  if (screen === 'lesson' && lesson) return renderLesson();
  if (screen === 'done' && lesson) return renderDone();
  if (screen === 'settings') return renderSettings();
  return renderHome();
}

function renderLock(error = '') {
  app.innerHTML = `
    <div class="lock">
      ${brain('think', 'big bounce')}
      <h1>Hirnbert</h1>
      <p>Hallo! Ich bin Hirnbert. Verrätst du mir das Passwort für die Fragen?</p>
      <form id="lockform" style="width:100%;display:grid;gap:12px">
        <input class="input" id="pw" type="password" autocomplete="current-password" placeholder="Passwort" required>
        <div class="error">${esc(error)}</div>
        <button class="btn" type="submit">Los geht's</button>
      </form>
    </div>`;
  const form = document.getElementById('lockform');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = document.getElementById('pw').value;
    form.querySelector('button').disabled = true;
    try {
      await unlock(pw);
      localStorage.setItem(PW_KEY, pw);
      screen = 'home';
      render();
    } catch (err) {
      renderLock(err instanceof TypeError ? 'Fragen konnten nicht geladen werden. Bist du online?' : 'Hmm, das Passwort passt nicht.');
    }
  });
}

function greeting(counts) {
  const h = new Date().getHours();
  const hello = h < 11 ? 'Guten Morgen!' : h < 18 ? 'Hallo!' : 'Guten Abend!';
  if (todayCount() >= S.settings.goal) return `Tagesziel geschafft! 🎉 Du bist ein echtes Superhirn.`;
  if (counts.wrong > 0 && Math.random() < 0.4) return `${hello} Es warten ${counts.wrong} Fehler darauf, ausgebügelt zu werden.`;
  if (counts.due > 0) return `${hello} ${counts.due} Fragen wollen heute wiederholt werden.`;
  if (counts.new === Q.size) return `${hello} Bereit für die erste Lektion? Ich bin schon ganz aufgeregt!`;
  return pick([`${hello} Lust auf ein paar neue Fragen?`, `${hello} Mein Gehirn ist hungrig – füttere es!`, `${hello} Jede Frage macht uns schlauer.`]);
}

function ring(value, max) {
  const r = 26, c = 2 * Math.PI * r, p = Math.min(value / max, 1);
  return `<svg class="ring" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="#efe9de" stroke-width="8"/>
    <circle cx="32" cy="32" r="${r}" fill="none" stroke="${p >= 1 ? '#58cc02' : '#1cb0f6'}" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p)}" transform="rotate(-90 32 32)"/>
    <text x="32" y="38" text-anchor="middle" font-family="Fredoka, sans-serif" font-size="17" fill="#3c3c4f">${p >= 1 ? '✓' : Math.round(p * 100) + '%'}</text>
  </svg>`;
}

function stackedBar(c, total) {
  const pct = (n) => (100 * n / total).toFixed(2) + '%';
  return `<div class="bar"><span class="m" style="width:${pct(c.mastered)}"></span><span class="l" style="width:${pct(c.learning)}"></span><span class="w" style="width:${pct(c.wrong)}"></span></div>`;
}

function renderHome() {
  const all = [...Q.keys()];
  const counts = countBy(all);
  const today = todayCount();
  const learnable = Math.min(S.settings.len, counts.due + counts.new);
  const chapters = DATA.kapitel.map((ch, i) => {
    const ids = ch.fragen.map((q) => `${ch.nr}-${q.nr}`);
    const c = countBy(ids);
    const color = CHAPTER_COLORS[i % CHAPTER_COLORS.length];
    const crown = c.mastered === ids.length ? '<span class="crown">👑</span>' : '';
    return `<button class="chapter" data-chapter="${ch.nr}">
      <span class="num" style="background:${color}">${ch.nr}</span>
      <span class="body">
        <div class="title">${esc(ch.titel)}</div>
        ${stackedBar(c, ids.length)}
        <div class="meta"><span>${c.mastered}/${ids.length} gemeistert</span><span>${c.due ? c.due + ' fällig' : c.new ? c.new + ' neu' : ''}</span></div>
      </span>${crown}
    </button>`;
  }).join('');

  app.innerHTML = `
    <div class="topbar">
      <div class="brand">Hirnbert</div>
      <div class="stats">
        <span class="chip fire" title="Tage in Folge">🔥 ${streak()}</span>
        <span class="chip xp" title="Erfahrungspunkte">⭐ ${S.xp}</span>
        <button class="iconbtn" data-action="settings" aria-label="Einstellungen">⚙️</button>
      </div>
    </div>
    <div class="hero">${brain(today >= S.settings.goal ? 'cheer' : 'happy', 'bounce')}<div class="bubble">${esc(greeting(counts))}</div></div>
    <div class="card goalcard">
      ${ring(today, S.settings.goal)}
      <div><div class="label">Tagesziel</div><div class="value">${today} / ${S.settings.goal} Fragen</div></div>
    </div>
    <div class="actions">
      <button class="btn" data-action="learn" ${learnable ? '' : 'disabled'}>
        Lernen<span class="sub">${counts.due ? counts.due + ' fällig · ' : ''}${counts.new} neu</span>
      </button>
      <button class="btn red" data-action="mistakes" ${counts.wrong ? '' : 'disabled'}>
        Fehler üben<span class="sub">${counts.wrong ? counts.wrong + ' Fragen' : 'Keine Fehler offen 🎉'}</span>
      </button>
    </div>
    <div class="card">
      <div class="overall"><h2>Gesamtfortschritt</h2><span>${Math.round(100 * counts.mastered / all.length)}%</span></div>
      ${stackedBar(counts, all.length)}
      <div class="legend">
        <span><i style="background:var(--green)"></i>${counts.mastered} gemeistert</span>
        <span><i style="background:var(--yellow)"></i>${counts.learning} in Arbeit</span>
        <span><i style="background:var(--red)"></i>${counts.wrong} falsch</span>
        <span><i style="background:#efe9de"></i>${counts.new} neu</span>
      </div>
    </div>
    <h2 class="section-title">Kapitel</h2>
    <div class="chapters">${chapters}</div>`;
}

function startLesson(mode, chapterNr = null, replace = false) {
  const ids = pickLesson(mode, chapterNr);
  if (!ids.length) { toast('Gerade gibt es hier nichts zu tun!'); return; }
  lesson = {
    mode, chapterNr, queue: ids, idx: 0, unique: ids.length, solved: 0,
    attempts: {}, firstOk: 0, xp: 0, combo: 0, maxCombo: 0, selected: new Set(), checked: null, start: Date.now(),
  };
  screen = 'lesson';
  if (replace) history.replaceState({ screen }, ''); else history.pushState({ screen }, '');
  render();
}

function renderLesson() {
  const L = lesson;
  const q = Q.get(L.queue[L.idx]);
  const att = L.attempts[q.id] || 0;
  const st = status(q.id);
  const c = S.cards[q.id];
  const tags = [
    `<span class="tag chap">Kapitel ${q.ch.nr} · Frage ${q.nr}</span>`,
    att > 0 ? '<span class="tag redo">Nochmal!</span>' : st === 'new' ? '<span class="tag new">Neu</span>' : st === 'wrong' ? '<span class="tag redo">Fehler</span>' : `<span class="tag box">Stufe ${c.b}</span>`,
  ].join('');
  const opts = Object.entries(q.a).map(([k, txt]) => {
    let cls = '', mark = '';
    if (L.checked) {
      const right = q.k.includes(k), sel = L.selected.has(k);
      if (right && sel) { cls = 'ok'; mark = '✓'; }
      else if (right) { cls = 'missed'; mark = '←'; }
      else if (sel) { cls = 'bad'; mark = '✗'; }
      else cls = 'dim';
    } else if (L.selected.has(k)) cls = 'sel';
    return `<button class="opt ${cls}" data-opt="${esc(k)}" ${L.checked ? 'disabled' : ''}>
      <span class="letter">${esc(k)}</span><span class="txt">${esc(txt)}</span>${mark ? `<span class="mark">${mark}</span>` : ''}</button>`;
  }).join('');

  app.innerHTML = `
    <div class="lesson">
      <div class="lesson-top">
        <button class="close" data-action="quit" aria-label="Lektion beenden">✕</button>
        <div class="bar"><span style="width:${(100 * L.solved / L.unique).toFixed(1)}%"></span></div>
        <div class="combo">${L.combo >= 2 ? '🔥' + L.combo : ''}</div>
      </div>
      <div class="qmeta">${tags}</div>
      <p class="question">${esc(q.q)}</p>
      <div class="hint">Eine oder mehrere Antworten sind richtig.</div>
      <div class="options">${opts}</div>
      <div class="lesson-bottom">
        ${L.checked ? '' : `<button class="btn" data-action="check" ${L.selected.size ? '' : 'disabled'}>Prüfen</button>`}
      </div>
    </div>
    ${L.checked ? feedbackSheet(q, L.checked === 'good') : ''}`;
  if (L.checked) {
    // Platz schaffen, damit das Sheet die Antworten nicht verdeckt
    const sheet = app.querySelector('.sheet');
    app.querySelector('.lesson-bottom').style.height = sheet.offsetHeight + 'px';
  }
}

function feedbackSheet(q, good) {
  const head = good
    ? pick(['Super!', 'Klasse!', 'Genau richtig!', 'Volltreffer!', 'Hirnbert ist stolz!', 'Wie ein Profi!'])
    : pick(['Knapp daneben!', 'Nicht ganz…', 'Das üben wir nochmal!', 'Hoppla!']);
  let body = '';
  if (!good) body += `<div class="correct-list">Richtig wäre: <b>${q.k.join(', ')}</b></div>`;
  if (q.l) body += `<div class="explain">${Object.entries(q.l).map(([k, v]) => `<b>${esc(k)})</b> ${esc(v)}`).join('\n')}</div>`;
  if (q.e) body += `<div class="explain">${esc(q.e)}</div>`;
  const info = (q.ch.infoboxen || []).filter((i) => i.nach === q.nr);
  for (const i of info) body += `<details class="explain info"><summary>📘 ${esc(i.titel)}</summary>${esc(i.text)}</details>`;
  return `<div class="sheet ${good ? 'good' : 'bad'}"><div class="sheet-inner">
    <div class="sheet-head">${brain(good ? 'cheer' : 'sad', good ? 'jump' : 'shake')}<h3>${head}</h3></div>
    ${body}
    <button class="btn ${good ? '' : 'red'}" data-action="next">Weiter</button>
  </div></div>`;
}

function checkAnswer() {
  const L = lesson;
  const q = Q.get(L.queue[L.idx]);
  const ok = q.k.length === L.selected.size && q.k.every((k) => L.selected.has(k));
  const first = !L.attempts[q.id];
  L.attempts[q.id] = (L.attempts[q.id] || 0) + 1;
  if (first) {
    grade(q.id, ok);
    S.days[dayKey()] = todayCount() + 1;
  }
  if (ok) {
    L.solved++;
    L.combo++;
    L.maxCombo = Math.max(L.maxCombo, L.combo);
    if (first) L.firstOk++;
    const xp = (first ? 10 : 5) + (L.combo >= 5 ? 2 : 0);
    L.xp += xp;
    S.xp += xp;
    sound('good');
  } else {
    L.combo = 0;
    if (L.attempts[q.id] <= MAX_RETRIES) L.queue.push(q.id);
    else L.solved++; // aufgeben – kommt über „Fehler üben“ wieder
    sound('bad');
    if (navigator.vibrate) navigator.vibrate(120);
  }
  saveState();
  L.checked = ok ? 'good' : 'bad';
  renderLesson();
}

function nextQuestion() {
  const L = lesson;
  L.idx++;
  L.selected = new Set();
  L.checked = null;
  if (L.idx >= L.queue.length) {
    screen = 'done';
    sound('done');
    confetti();
  }
  render();
}

function renderDone() {
  const L = lesson;
  const secs = Math.round((Date.now() - L.start) / 1000);
  const acc = Math.round(100 * L.firstOk / L.unique);
  const goalHit = todayCount() >= S.settings.goal;
  const title = acc === 100 ? 'Perfekt!' : acc >= 70 ? 'Lektion geschafft!' : 'Gut gekämpft!';
  app.innerHTML = `
    <div class="done">
      ${brain('cheer', 'big jump')}
      <h1>${title}</h1>
      <div>${goalHit ? 'Tagesziel erreicht – Hirnbert tanzt! 💃' : `Noch ${S.settings.goal - todayCount()} Fragen bis zum Tagesziel.`}</div>
      <div class="tiles">
        <div class="tile y"><div class="t">XP</div><div class="v">+${L.xp}</div></div>
        <div class="tile g"><div class="t">Treffer</div><div class="v">${acc}%</div></div>
        <div class="tile b"><div class="t">Zeit</div><div class="v">${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</div></div>
      </div>
      ${L.maxCombo >= 3 ? `<div>🔥 Beste Serie: ${L.maxCombo} richtig hintereinander</div>` : ''}
      <button class="btn" data-action="again">Noch eine Lektion</button>
      <button class="btn ghost" data-action="home">Zur Übersicht</button>
    </div>`;
}

function renderSettings() {
  const last = S.lastExport ? new Date(S.lastExport).toLocaleDateString('de-DE') : 'noch nie';
  app.innerHTML = `
    <div class="settings">
      <div class="lesson-top"><button class="close" data-action="home" aria-label="Zurück">✕</button></div>
      <h1>Einstellungen</h1>
      <div class="card">
        <div class="row"><div>Fragen pro Lektion</div>
          <div class="stepper"><button data-step="len:-1">−</button><span>${S.settings.len}</span><button data-step="len:1">+</button></div></div>
        <div class="row"><div>Tagesziel (Fragen)</div>
          <div class="stepper"><button data-step="goal:-5">−</button><span>${S.settings.goal}</span><button data-step="goal:5">+</button></div></div>
        <div class="row"><div>Töne</div><button class="switch ${S.settings.sound ? 'on' : ''}" data-action="sound" aria-label="Töne an/aus"></button></div>
      </div>
      <div class="card">
        <div class="row" style="border:0;padding-top:0"><div>Fortschritt sichern<small>Letztes Backup: ${last}</small></div></div>
        <div class="btnrow">
          <button class="btn blue small" data-action="export">Exportieren</button>
          <button class="btn ghost small" data-action="import">Importieren</button>
        </div>
        <input type="file" id="importfile" accept="application/json,.json" hidden>
      </div>
      <div class="card">
        <div class="row" style="border:0;padding-top:0"><div>So funktioniert's<small>
          Jede Frage wandert durch 5 Stufen. Richtig → eine Stufe hoch (nächste Abfrage nach 1, 3, 7 bzw. 21 Tagen).
          Falsch → zurück auf Stufe 1 und sofort wieder dran. Ab Stufe 4 gilt eine Frage als gemeistert.
          Dein Fortschritt wird nur auf diesem Gerät gespeichert – exportiere ab und zu ein Backup.</small></div></div>
      </div>
      <div class="btnrow">
        <button class="btn ghost small" data-action="logout">Passwort vergessen</button>
        <button class="btn red small" data-action="reset">Alles zurücksetzen</button>
      </div>
    </div>`;
}

// ---------- Export / Import ----------
function exportProgress() {
  S.lastExport = Date.now();
  saveState();
  const blob = new Blob([JSON.stringify({ app: 'hirnbert', version: 1, exported: new Date().toISOString(), state: S }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `hirnbert-fortschritt-${dayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  renderSettings();
}
async function importProgress(file) {
  try {
    const d = JSON.parse(await file.text());
    const s = d.state || d;
    if (!s.cards) throw new Error('kein Hirnbert-Backup');
    if (!confirm(`Backup mit ${Object.keys(s.cards).length} beantworteten Fragen laden? Der aktuelle Stand wird ersetzt.`)) return;
    S = { ...defaultState(), ...s, settings: { ...defaultState().settings, ...s.settings } };
    saveState();
    toast('Backup geladen!');
    renderSettings();
  } catch (e) {
    toast('Das ist kein gültiges Backup.');
  }
}

// ---------- Events ----------
app.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-opt]');
  if (opt && lesson && !lesson.checked) {
    const k = opt.dataset.opt;
    lesson.selected.has(k) ? lesson.selected.delete(k) : lesson.selected.add(k);
    opt.classList.toggle('sel');
    app.querySelector('[data-action="check"]').disabled = lesson.selected.size === 0;
    return;
  }
  const chap = e.target.closest('[data-chapter]');
  if (chap) return startLesson('learn', Number(chap.dataset.chapter));
  const step = e.target.closest('[data-step]');
  if (step) {
    const [key, d] = step.dataset.step.split(':');
    const lim = { len: [3, 30], goal: [5, 200] }[key];
    S.settings[key] = Math.min(lim[1], Math.max(lim[0], S.settings[key] + Number(d)));
    saveState();
    return renderSettings();
  }
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'learn': return startLesson('learn');
    case 'mistakes': return startLesson('mistakes');
    case 'check': return checkAnswer();
    case 'next': return nextQuestion();
    case 'again': return startLesson(lesson.mode, lesson.chapterNr, true);
    case 'quit': case 'home': return history.state ? history.back() : goHome();
    case 'settings': screen = 'settings'; history.pushState({ screen }, ''); return render();
    case 'sound': S.settings.sound = !S.settings.sound; saveState(); return renderSettings();
    case 'export': return exportProgress();
    case 'import': return document.getElementById('importfile').click();
    case 'reset':
      if (confirm('Wirklich den gesamten Lernfortschritt löschen?') && confirm('Ganz sicher? Das kann nicht rückgängig gemacht werden.')) {
        S = defaultState(); saveState(); goHome();
      }
      return;
    case 'logout':
      localStorage.removeItem(PW_KEY); DATA = null; return render();
  }
});
app.addEventListener('change', (e) => {
  if (e.target.id === 'importfile' && e.target.files[0]) importProgress(e.target.files[0]);
});
document.addEventListener('keydown', (e) => {
  if (screen !== 'lesson' || !lesson || e.key !== 'Enter') return;
  const b = app.querySelector('[data-action="next"], [data-action="check"]:not(:disabled)');
  if (b) b.click();
});

function goHome() { screen = 'home'; render(); }
window.addEventListener('popstate', goHome);

// ---------- Start ----------
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const pw = localStorage.getItem(PW_KEY);
  if (pw) {
    try { await unlock(pw); } catch (e) { DATA = null; }
  }
  history.replaceState(null, '');
  render();
}
boot();
