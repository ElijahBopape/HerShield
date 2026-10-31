/* HerShield: hackathon demo (skeleton of the full product).
   Plain HTML/CSS/JS so it runs on Android + iOS browsers with no install,
   works offline (service worker), and uses only on-device APIs:
   MediaRecorder (microphone), Geolocation (GPS), Web Crypto (SHA-256), IndexedDB (storage). */

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const THEMES = [
  { name: 'Violet', a: '#7C3AED', b: '#EC4899' },
  { name: 'Rose', a: '#E11D48', b: '#FB923C' },
  { name: 'Teal', a: '#0D9488', b: '#22D3EE' },
  { name: 'Ocean', a: '#2563EB', b: '#7C3AED' },
  { name: 'Amber', a: '#D97706', b: '#DB2777' },
  { name: 'Graphite', a: '#374151', b: '#6B7280' },
];
const LANGS = ['English', 'Sepedi', 'isiZulu', 'Afrikaans', 'Xitsonga', 'Tshivenda', 'isiXhosa', 'Setswana'];
const CHUNK_MS = 4000;

/* ---------------- Settings (on-device) ---------------- */
const DEFAULTS = {
  onboarded: false, phrase: '', pin: '', duressPin: '', accent: THEMES[0].a, accent2: THEMES[0].b,
  dark: false, disguise: 'calculator', playback: 'pin', sensitivity: 70, armed: true,
  shake: true, tripleTap: true, language: 'English', contacts: [], deviceId: '',
};
let S = load();
let decoy = false;           // true when unlocked with the duress PIN
let unlockedPlayback = false;
function load() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('hs.settings') || '{}')); }
  catch { return { ...DEFAULTS }; }
}
function save() { try { localStorage.setItem('hs.settings', JSON.stringify(S)); } catch {} applyTheme(); }
function applyTheme() {
  document.documentElement.style.setProperty('--accent', S.accent);
  document.documentElement.style.setProperty('--accent2', S.accent2);
  document.body.classList.toggle('dark', !!S.dark);
}
if (!S.deviceId) { S.deviceId = 'HS-' + Math.random().toString(36).slice(2, 10).toUpperCase(); save(); }

/* ---------------- Crypto helpers ---------------- */
async function sha256(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const short = h => h ? h.slice(0, 10) + '…' + h.slice(-6) : '-';

/* ---------------- IndexedDB evidence store (no delete API exists) ---------------- */
let dbp;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('hershield', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('sessions', { keyPath: 'id' }); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error);
  });
}
const putSession = s => tx('sessions', 'readwrite', st => st.put(s));
const getSession = id => tx('sessions', 'readonly', st => st.get(id));
const allSessions = async () => (await tx('sessions', 'readonly', st => st.getAll())).sort((a, b) => b.start - a.start);
const putBlob = (k, b) => tx('blobs', 'readwrite', st => st.put(b, k));
const getBlob = k => tx('blobs', 'readonly', st => st.get(k));
// NOTE: there is intentionally no deleteSession(): evidence is append-only.

/* ---------------- Location ---------------- */
function getLocation() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), acc: Math.round(p.coords.accuracy) }),
      () => res(null), { timeout: 3000, maximumAge: 60000 });
  });
}
const fmtLoc = l => l ? `${l.lat}, ${l.lng} (±${l.acc}m)` : 'No GPS fix (indoors)';

/* ---------------- Evidence sealing (hash chain) ---------------- */
async function blockHash(prev, chunkHash, ts, loc, i) {
  return sha256(`${prev}|${chunkHash}|${ts}|${loc ? loc.lat + ',' + loc.lng : 'nofix'}|${i}`);
}
async function sealChunk(session, blob, loc) {
  const i = session.chunks.length;
  const ts = Date.now();
  const chunkHash = await sha256(await blob.arrayBuffer());
  const prev = i === 0 ? session.genesis : session.chunks[i - 1].blockHash;
  const bh = await blockHash(prev, chunkHash, ts, loc, i);
  await putBlob(`${session.id}:${i}`, blob);
  session.chunks.push({ i, ts, size: blob.size, chunkHash, prevHash: prev, blockHash: bh, loc });
  await putSession(session);
  return session.chunks[i];
}
async function newSession(trigger) {
  const id = 'EV-' + new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const s = { id, start: Date.now(), end: null, trigger, device: S.deviceId, mime: 'audio/webm', chunks: [], fileHash: null, loc: null };
  s.genesis = await sha256(`HERSHIELD-GENESIS|${id}|${S.deviceId}|${s.start}`);
  await putSession(s);
  return s;
}
async function finaliseSession(s) {
  const blobs = [];
  for (const c of s.chunks) blobs.push(await getBlob(`${s.id}:${c.i}`));
  const file = new Blob(blobs, { type: s.mime });
  s.fileHash = await sha256(await file.arrayBuffer());
  s.size = file.size; s.end = Date.now();
  await putSession(s);
  return s;
}
async function assembleFile(s) {
  const blobs = [];
  for (const c of s.chunks) blobs.push(await getBlob(`${s.id}:${c.i}`));
  return new Blob(blobs, { type: s.mime });
}
async function verifyChain(s) {
  const results = [];
  for (const c of s.chunks) {
    const blob = await getBlob(`${s.id}:${c.i}`);
    const ch = blob ? await sha256(await blob.arrayBuffer()) : 'missing';
    const prev = c.i === 0 ? s.genesis : s.chunks[c.i - 1].blockHash;
    const bh = await blockHash(prev, ch, c.ts, c.loc, c.i);
    results.push({ i: c.i, ok: ch === c.chunkHash && bh === c.blockHash && prev === c.prevHash, ch });
  }
  return results;
}

/* ---------------- Recording ---------------- */
let rec = null; // { session, recorder, stream, timer, fallback }
async function startRecording(trigger = 'Secret phrase') {
  if (rec) return;
  stopListening();
  const session = await newSession(trigger);
  rec = { session, startedAt: Date.now(), queue: Promise.resolve(), loc: null };
  getLocation().then(l => { rec && (rec.loc = l, session.loc = l, putSession(session)); });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    session.mime = recorder.mimeType || 'audio/webm';
    recorder.ondataavailable = e => { if (e.data && e.data.size) rec.queue = rec.queue.then(() => sealChunk(session, e.data, rec.loc)).then(renderLive); };
    recorder.start(CHUNK_MS);
    Object.assign(rec, { recorder, stream });
  } catch (err) {
    // No microphone (e.g. permission denied), generate synthetic audio so the sealing pipeline can still be demonstrated.
    session.mime = 'audio/wav'; session.synthetic = true;
    rec.timer = setInterval(() => { rec.queue = rec.queue.then(() => sealChunk(session, synthWav(4, rec.session.chunks.length), rec.loc)).then(renderLive); }, CHUNK_MS);
  }
  go('recording');
}
async function stopRecording() {
  if (!rec) return;
  const r = rec;
  if (r.recorder && r.recorder.state !== 'inactive') {
    await new Promise(res => { r.recorder.onstop = res; r.recorder.stop(); });
    r.stream.getTracks().forEach(t => t.stop());
  }
  if (r.timer) clearInterval(r.timer);
  await r.queue;
  if (r.session.chunks.length === 0) await sealChunk(r.session, synthWav(1, 0), r.loc);
  await finaliseSession(r.session);
  rec = null;
  toast('Recording sealed in your Vault 🔒');
  go('session/' + r.session.id);
}

/* Synthetic WAV (used for sample evidence & no-mic fallback) */
function synthWav(seconds, seed = 0) {
  const rate = 8000, n = rate * seconds, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const s = 0.25 * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(t * 3 + seed)) * t) * (0.5 + 0.5 * Math.sin(t * 7)) + (Math.random() - .5) * 0.05;
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
async function seedSamples() {
  const samples = [
    { ago: 3 * 86400e3, trigger: 'Secret phrase', loc: { lat: -23.90449, lng: 29.46885, acc: 12 }, secs: 20 },
    { ago: 9 * 86400e3 + 5e6, trigger: 'Shake gesture', loc: { lat: -23.88731, lng: 29.44812, acc: 25 }, secs: 12 },
  ];
  for (const x of samples) {
    const s = await newSession(x.trigger);
    s.start = Date.now() - x.ago; s.mime = 'audio/wav'; s.loc = x.loc; s.sample = true;
    s.genesis = await sha256(`HERSHIELD-GENESIS|${s.id}|${S.deviceId}|${s.start}`);
    const full = new Uint8Array(await synthWav(x.secs, x.ago % 7).arrayBuffer());
    const parts = Math.ceil(x.secs / 4), size = Math.ceil(full.length / parts);
    for (let p = 0; p < parts; p++) {
      const blob = new Blob([full.slice(p * size, (p + 1) * size)], { type: 'audio/wav' });
      const c = await sealChunk(s, blob, x.loc);
      c.ts = s.start + p * CHUNK_MS;
      c.blockHash = await blockHash(c.prevHash, c.chunkHash, c.ts, x.loc, p);
    }
    // re-link the chain after adjusting timestamps
    for (let p = 0; p < s.chunks.length; p++) {
      const c = s.chunks[p]; c.prevHash = p === 0 ? s.genesis : s.chunks[p - 1].blockHash;
      c.blockHash = await blockHash(c.prevHash, c.chunkHash, c.ts, c.loc, p);
    }
    await finaliseSession(s);
    s.end = s.start + x.secs * 1000; await putSession(s);
  }
}

/* ---------------- Secret-phrase listening ---------------- */
let recog = null, listening = false;
const norm = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
function startListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !S.phrase || !S.armed || rec || decoy) return false;
  if (listening) return true;
  recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = 'en-ZA';
  recog.onresult = e => {
    const heard = norm([...e.results].map(r => r[0].transcript).join(' '));
    const said = $('#heard'); if (said) said.textContent = '“' + heard.slice(-60) + '”';
    if (heard.includes(norm(S.phrase))) { stopListening(); startRecording('Secret phrase'); }
  };
  recog.onend = () => { listening = false; if (location.hash.startsWith('#home') && S.armed && !rec) setTimeout(startListening, 400); };
  try { recog.start(); listening = true; } catch { listening = false; }
  return listening;
}
function stopListening() { if (recog) { recog.onend = null; try { recog.stop(); } catch {} } listening = false; }

/* Shake trigger */
let lastShake = 0, shakes = 0;
window.addEventListener('devicemotion', e => {
  if (!S.shake || !S.armed || rec || !S.onboarded) return;
  const a = e.accelerationIncludingGravity; if (!a) return;
  const f = Math.abs(a.x) + Math.abs(a.y) + Math.abs(a.z);
  if (f > 45) { const now = Date.now(); shakes = now - lastShake < 800 ? shakes + 1 : 1; lastShake = now; if (shakes >= 3) startRecording('Shake gesture'); }
});

/* ---------------- UI helpers ---------------- */
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms); }
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); }; return m; }
function closeModal() { $('#modal').hidden = true; }
function go(r) { if (location.hash !== '#' + r) location.hash = r; else render(); }
const when = ts => new Date(ts).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dur = s => { const sec = Math.round(((s.end || Date.now()) - s.start) / 1000); return `${Math.floor(sec / 60)}m ${sec % 60}s`; };
function header(title, sub = '') {
  return `<div class="top"><div class="brand"><img src="logo.svg" alt="">${title}</div>
  <button class="iconbtn" id="qexit" title="Quick exit">✕ Exit</button></div>${sub ? `<p class="muted">${sub}</p>` : ''}`;
}
function askPin(title, cb) {
  const m = modal(`<h3>${title}</h3><p class="muted">Enter your HerShield PIN.</p>
    <input type="password" inputmode="numeric" id="pinIn" placeholder="••••" maxlength="8">
    <div class="row" style="margin-top:12px"><button class="btn ghost" id="pinCancel">Cancel</button><button class="btn" id="pinOk">Confirm</button></div>`);
  $('#pinIn').focus();
  $('#pinCancel').onclick = closeModal;
  $('#pinOk').onclick = () => { if ($('#pinIn').value === S.pin) { closeModal(); cb(); } else toast('Incorrect PIN'); };
}
function soon(what) {
  modal(`<span class="pill soon">Full version</span><h3 style="margin-top:8px">${what}</h3>
  <p class="muted">This is part of the full HerShield app. The demo shows where it lives and how it will work.</p>
  <button class="btn" onclick="closeModal()">Got it</button>`);
}

/* ---------------- Screens ---------------- */
const screens = {};

/* Disguise: working calculator; PIN + "=" unlocks */
screens.disguise = () => {
  stopListening();
  $('#tabbar').hidden = true;
  let expr = '';
  view.innerHTML = `<div class="calc"><div class="display" id="disp">0</div><div class="keys">
    ${['AC', '±', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', '.', '='].map(k =>
      `<button class="${['AC', '±', '%'].includes(k) ? 'fn' : ['÷', '×', '−', '+', '='].includes(k) ? 'op' : ''} ${k === '0' ? 'zero' : ''}" data-k="${k}">${k}</button>`).join('')}
  </div></div>`;
  const disp = $('#disp');
  view.querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === 'AC') expr = '';
    else if (k === '=') {
      if (S.pin && expr === S.pin) { decoy = false; return go('home'); }
      if (S.duressPin && expr === S.duressPin) { decoy = true; return go('home'); }
      try { expr = String(Function('return (' + expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-') + ')')() ?? ''); } catch { expr = 'Error'; }
    } else if (k === '±') expr = expr.startsWith('-') ? expr.slice(1) : '-' + expr;
    else if (k === '%') expr = String((parseFloat(expr) || 0) / 100);
    else expr = (expr === 'Error' ? '' : expr) + k;
    disp.textContent = expr || '0';
  });
};

/* Onboarding (7 steps) */
let ob = { phraseReps: 0 };
screens.onboard = (step = '1') => {
  $('#tabbar').hidden = true;
  const n = +step, total = 7;
  const bar = `<div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>`;
  const next = (label = 'Continue', id = 'next') => `<button class="btn" id="${id}" style="margin-top:16px">${label}</button>`;
  let html = '';
  if (n === 1) html = `<div class="hero"><img src="logo.svg" alt="HerShield logo"><h1>HerShield</h1>
      <p class="muted">The black box for gender-based violence.<br>The truth, sealed, so it can't be ignored, edited or made up.</p></div>
      <div class="card"><h3>🎙️ Starts with your voice</h3><p class="muted">Say your secret everyday phrase and recording starts silently. No need to touch your phone.</p></div>
      <div class="card"><h3>🔒 Sealed the moment it's captured</h3><p class="muted">Every few seconds the audio is fingerprinted, time-stamped and chained. Nobody can edit or delete it: not him, not you.</p></div>
      <div class="card"><h3>⚖️ Facts, not accusations</h3><p class="muted">HerShield never labels anyone. It only preserves what happened, so courts can decide on evidence.</p></div>
      ${next('Set up my shield')}`;
  if (n === 2) html = `<h1>How your shield works</h1><p class="muted">Everything happens on your phone. No signal or data needed.</p>
      ${[['1', 'Armed', 'Your phone quietly listens only for your phrase, like "Hey Siri", on the device. Nothing is recorded or sent while waiting.'],
         ['2', 'Triggered', 'You say your phrase (or shake the phone). The screen stays dark or shows the calculator.'],
         ['3', 'Sealed', 'Audio, time and GPS location are saved in 4-second pieces. Each piece is fingerprinted and linked to the one before.'],
         ['4', 'Protected', 'Recordings cannot be deleted. Any edit, even one second, breaks the seal and is detected.'],
         ['5', 'Verified', 'Police, lawyers or courts can check a recording is genuine with the Verify tool.']]
        .map(([i, t, d]) => `<div class="option"><span class="pill info">${i}</span><div><h3>${t}</h3><span class="muted">${d}</span></div></div>`).join('')}
      ${next()}`;
  if (n === 3) html = `<h1>Your secret phrase</h1><p class="muted">Pick something you could say naturally in any situation. He will never know it's a trigger.</p>
      <label class="field">Phrase</label><input type="text" id="phrase" value="${S.phrase || ''}" placeholder="e.g. Have you seen my red scarf">
      <div class="card"><h3>Good phrases</h3><span class="muted">• 4 to 6 words, everyday but not too common<br>• Easy to say while scared or crying<br>• Examples: “I left the kettle on”, “Did mama call today”, “Where is my red scarf”</span></div>
      <div class="card"><div class="row between"><div><h3>Train your voice</h3><span class="muted small">Say it 3 times so the phone learns your voice.</span></div><span class="pill info" id="reps">${ob.phraseReps}/3</span></div>
      <button class="btn soft" id="train" style="margin-top:10px">🎙️ Say phrase now</button></div>
      ${next()}`;
  if (n === 4) html = `<h1>Make it yours</h1><p class="muted">Choose the colours you like. You can change this any time.</p>
      <h2>Theme colour</h2><div class="swatches">${THEMES.map((t, i) => `<button class="swatch ${S.accent === t.a ? 'on' : ''}" data-t="${i}" title="${t.name}" style="background:linear-gradient(135deg,${t.a},${t.b})"></button>`).join('')}
      <label class="swatch" title="Custom" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red);display:grid;place-items:center"><input type="color" id="custom" value="${S.accent}" style="opacity:0;width:1px"></label></div>
      <div class="card row between" style="margin-top:16px"><div><h3>Dark mode</h3><span class="muted small">Easier to use discreetly at night</span></div><label class="switch"><input type="checkbox" id="dark" ${S.dark ? 'checked' : ''}><span></span></label></div>
      <div class="status" style="margin-top:10px"><div class="pulse"><img src="logo.svg" alt=""></div><b>Preview</b><div class="small">This is how your shield will look</div></div>
      ${next()}`;
  if (n === 5) html = `<h1>Lock & disguise</h1><p class="muted">HerShield hides behind an ordinary app. Type your PIN and press “=” to open it.</p>
      <label class="field">PIN (4 to 8 digits)</label><input type="password" inputmode="numeric" id="pin" maxlength="8" value="${S.pin}" placeholder="••••">
      <label class="field">Duress PIN <span class="pill soon">optional</span></label><input type="password" inputmode="numeric" id="dpin" maxlength="8" value="${S.duressPin}" placeholder="Opens an empty decoy app">
      <p class="muted small">If you're ever forced to open the app, use the duress PIN. It shows an empty shield and an empty vault.</p>
      <h2>Disguise as</h2>
      ${[['calculator', '🧮 Calculator', 'A working calculator'], ['notes', '📝 Notes', 'Full version'], ['weather', '⛅ Weather', 'Full version']].map(([v, t, d]) =>
        `<label class="option ${S.disguise === v ? 'on' : ''}"><input type="radio" name="dis" value="${v}" ${S.disguise === v ? 'checked' : ''} ${v !== 'calculator' ? 'disabled' : ''}><div><h3>${t}</h3><span class="muted small">${d}</span></div></label>`).join('')}
      ${next()}`;
  if (n === 6) html = `<h1>Permissions</h1><p class="muted">HerShield only uses features already on your phone. No data costs.</p>
      ${[['mic', '🎙️ Microphone', 'To hear your phrase and record evidence.'], ['loc', '📍 Location (GPS)', 'Works offline. Adds where it happened.'],
         ['bg', '🔋 Run in background', 'So your shield stays armed when the screen is off.'], ['note', '🔔 Notifications', 'Silent only. Never shows “recording”.']]
        .map(([k, t, d]) => `<div class="option"><div style="flex:1"><h3>${t}</h3><span class="muted small">${d}</span></div><button class="btn sm soft" data-perm="${k}">Allow</button></div>`).join('')}
      ${next()}`;
  if (n === 7) html = `<h1>Trusted people</h1><p class="muted">Optional. In the full app, they get an alert with your location when your shield is triggered and you have signal.</p>
      <label class="field">Name</label><input type="text" id="cname" placeholder="e.g. Sister, Lerato">
      <label class="field">Phone</label><input type="tel" id="cphone" placeholder="e.g. 072 000 0000">
      <button class="btn soft" id="addc" style="margin-top:10px">+ Add trusted person</button>
      <div id="clist">${S.contacts.map(c => `<div class="card row between"><span>👤 ${c.name}</span><span class="muted">${c.phone}</span></div>`).join('')}</div>
      <button class="btn" id="finish" style="margin-top:16px">Finish and arm my shield</button>
      <p class="muted small" style="text-align:center">Next time, HerShield opens as a calculator. Type your PIN then “=”.</p>`;
  view.innerHTML = bar + html;

  const nx = $('#next');
  if (nx) nx.onclick = () => {
    if (n === 3) { const p = $('#phrase').value.trim(); if (p.split(/\s+/).length < 3) return toast('Use at least 3 words'); S.phrase = p; save(); }
    if (n === 5) { const p = $('#pin').value; if (!/^\d{4,8}$/.test(p)) return toast('PIN must be 4 to 8 digits');
      const d = $('#dpin').value; if (d && (d === p || !/^\d{4,8}$/.test(d))) return toast('Duress PIN must be different, 4 to 8 digits'); S.pin = p; S.duressPin = d; save(); }
    go('onboard/' + (n + 1));
  };
  if (n === 3) $('#train').onclick = () => {
    const p = $('#phrase').value.trim(); if (!p) return toast('Type your phrase first');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const done = () => { ob.phraseReps = Math.min(3, ob.phraseReps + 1); const rp = $('#reps'); if (!rp) return; rp.textContent = ob.phraseReps + '/3'; toast(ob.phraseReps >= 3 ? 'Voice trained ✓' : 'Got it, say it again'); };
    if (!SR) return done();
    const r = new SR(); r.lang = 'en-ZA'; toast('Listening… say your phrase');
    r.onresult = e => { norm(e.results[0][0].transcript).includes(norm(p)) ? done() : toast('Heard “' + e.results[0][0].transcript + '”. Try again'); };
    r.onerror = done; try { r.start(); } catch { done(); }
  };
  if (n === 4) {
    view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const t = THEMES[b.dataset.t]; S.accent = t.a; S.accent2 = t.b; save(); render(); });
    $('#custom').oninput = e => { S.accent = e.target.value; S.accent2 = e.target.value; save(); };
    $('#dark').onchange = e => { S.dark = e.target.checked; save(); };
  }
  if (n === 5) view.querySelectorAll('[name=dis]').forEach(r => r.onchange = () => { S.disguise = r.value; save(); });
  if (n === 6) view.querySelectorAll('[data-perm]').forEach(b => b.onclick = async () => {
    const k = b.dataset.perm;
    try {
      if (k === 'mic') { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); }
      if (k === 'loc') await getLocation();
      if (k === 'note' && 'Notification' in window) await Notification.requestPermission();
    } catch {}
    b.textContent = '✓ Allowed'; b.disabled = true;
  });
  if (n === 7) {
    $('#addc').onclick = () => { const name = $('#cname').value.trim(), phone = $('#cphone').value.trim(); if (!name || !phone) return toast('Add a name and number'); S.contacts.push({ name, phone }); save(); render(); };
    $('#finish').onclick = () => { S.onboarded = true; S.armed = true; save(); toast('Your shield is armed'); go('home'); };
  }
};

/* Home / Shield */
screens.home = async () => {
  $('#tabbar').hidden = false;
  const sessions = decoy ? [] : await allSessions();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const armed = S.armed && !decoy;
  view.innerHTML = header('HerShield') + `
    <div class="status ${armed ? '' : 'off'}">
      <div class="pulse" id="logoTap"><img src="logo.svg" alt=""></div>
      <h2 style="margin:0">${armed ? 'Shield armed' : 'Shield paused'}</h2>
      <div class="small" style="opacity:.9">${armed ? 'Listening on-device for your secret phrase' : 'Your phrase will not trigger recording'}</div>
      <div class="small mono" id="heard" style="opacity:.75;margin-top:8px">${armed ? (SR ? '…' : 'Voice trigger needs Chrome/Safari speech. Use the buttons below') : ''}</div>
    </div>
    <div class="card row between"><div><h3>Shield</h3><span class="muted small">Pause when you're in a safe place</span></div>
      <label class="switch"><input type="checkbox" id="arm" ${armed ? 'checked' : ''}><span></span></label></div>
    <div class="grid2">
      <div class="card"><div class="muted small">Sealed recordings</div><h1>${sessions.length}</h1></div>
      <div class="card"><div class="muted small">Last capture</div><h3 style="margin-top:8px">${sessions[0] ? new Date(sessions[0].start).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '-'}</h3></div>
    </div>
    <div class="card"><h3>Your triggers</h3>
      <div class="muted small">🎙️ Secret phrase: <b>${decoy ? '-' : '“' + (S.phrase ? S.phrase.replace(/\S/g, (c, i) => i < 3 ? c : '•') : 'not set') + '”'}</b><br>
      📳 Shake ×3: ${S.shake ? 'on' : 'off'} · 👆 Triple-tap logo: ${S.tripleTap ? 'on' : 'off'}<br>
      🔘 Volume-button pattern · ⌚ Bracelet / watch: <span class="pill soon">full version</span></div></div>
    <button class="btn" id="sim">▶ Simulate trigger <span class="demo-tag">DEMO</span></button>
    <div class="grid2" style="margin-top:10px">
      <button class="btn soft" id="test">🎙️ Test my phrase</button>
      <button class="btn soft" id="hide">🧮 Hide app</button>
    </div>`;
  $('#arm').onchange = e => { if (decoy) return; S.armed = e.target.checked; save(); render(); };
  $('#sim').onclick = () => startRecording('Demo trigger');
  $('#hide').onclick = () => go('disguise');
  $('#test').onclick = () => {
    if (!SR) return toast('Speech recognition not available in this browser');
    stopListening(); const r = new SR(); r.lang = 'en-ZA'; toast('Say your phrase. This is a test, nothing will record');
    r.onresult = e => toast(norm(e.results[0][0].transcript).includes(norm(S.phrase)) ? '✓ Phrase recognised' : 'Heard “' + e.results[0][0].transcript + '”');
    r.onend = () => setTimeout(startListening, 300); try { r.start(); } catch {}
  };
  let taps = [];
  $('#logoTap').onclick = () => { if (!S.tripleTap) return; const now = Date.now(); taps = taps.filter(t => now - t < 900).concat(now); if (taps.length >= 3) startRecording('Triple-tap'); };
  if (armed) startListening(); else stopListening();
};

/* Covert recording screen */
let liveOpen = false, clockTimer;
screens.recording = () => {
  $('#tabbar').hidden = true;
  if (!rec) return go('home');
  let taps = [];
  view.innerHTML = `<div class="covert"><span class="dot"></span>
    <div class="clock" id="clk"></div><div class="date" id="dt"></div>
    <div id="liveWrap" style="width:100%"></div>
    <div class="hint">Screen looks locked. Tap the clock 5× for the live evidence view.</div></div>`;
  const tick = () => { const d = new Date(); const c = $('#clk'); if (!c) return clearInterval(clockTimer);
    c.textContent = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
    $('#dt').textContent = d.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }); renderLive(); };
  clearInterval(clockTimer); clockTimer = setInterval(tick, 1000); tick();
  $('#clk').onclick = () => { const now = Date.now(); taps = taps.filter(t => now - t < 1500).concat(now); if (taps.length >= 5) { liveOpen = !liveOpen; taps = []; renderLive(); } };
  renderLive();
};
function renderLive() {
  const w = $('#liveWrap'); if (!w || !rec) return;
  if (!liveOpen) { w.innerHTML = ''; return; }
  const s = rec.session, secs = Math.round((Date.now() - rec.startedAt) / 1000);
  w.innerHTML = `<div class="live">
    <div class="row between"><span class="rec">REC ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</span><span class="small">${s.chunks.length} sealed</span></div>
    <div class="small" style="opacity:.7;margin:6px 0">Trigger: ${s.trigger} · 📍 ${fmtLoc(rec.loc)}${s.synthetic ? ' · <b>no mic, synthetic audio</b>' : ''}</div>
    ${s.chunks.slice(-4).reverse().map(c => `<div class="mono" style="color:#86efac">#${c.i} ✓ ${new Date(c.ts).toLocaleTimeString('en-ZA')} · ${short(c.blockHash)}</div>`).join('') || '<div class="small">Sealing first piece…</div>'}
    <button class="btn danger" id="stop" style="margin-top:10px">■ Stop (PIN required)</button></div>`;
  $('#stop').onclick = () => askPin('Stop recording?', stopRecording);
}

/* Vault */
screens.vault = async () => {
  $('#tabbar').hidden = false;
  const list = decoy ? [] : await allSessions();
  view.innerHTML = header('Evidence Vault', 'Every recording is sealed the moment it is captured.') +
    (list.length ? list.map(s => `<div class="card" data-open="${s.id}" style="cursor:pointer">
      <div class="row between"><h3>${new Date(s.start).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</h3><span class="pill ok">🔒 Sealed</span></div>
      <div class="muted small">${new Date(s.start).toLocaleTimeString('en-ZA')} · ${dur(s)} · ${s.chunks.length} pieces · ${s.trigger}${s.sample ? ' · sample' : ''}</div>
      <div class="muted small">📍 ${fmtLoc(s.loc)}</div>
      <div class="mono muted" style="margin-top:4px">${s.id} · ${short(s.fileHash)}</div></div>`).join('')
      : `<div class="card" style="text-align:center"><p>No recordings yet.</p><p class="muted small">When your shield is triggered, sealed recordings appear here.</p>
        ${decoy ? '' : '<button class="btn soft" id="seed">Load sample evidence <span class="demo-tag">DEMO</span></button>'}</div>`) +
    `<div class="card" style="text-align:center"><span class="muted small">🔒 Recordings can't be deleted or edited, not by you and not by anyone who takes your phone. This protects the truth for everyone.</span></div>`;
  view.querySelectorAll('[data-open]').forEach(c => c.onclick = () => go('session/' + c.dataset.open));
  const sd = $('#seed'); if (sd) sd.onclick = async () => { sd.disabled = true; await seedSamples(); render(); };
};

/* Session detail */
screens.session = async id => {
  $('#tabbar').hidden = false;
  const s = await getSession(id);
  if (!s || decoy) return go('vault');
  const canPlay = S.playback === 'open' || (S.playback === 'pin' && unlockedPlayback === id);
  view.innerHTML = `<button class="iconbtn" id="back">← Vault</button>
    <h1 style="margin-top:12px">Evidence record</h1>
    <div class="card">
      <div class="row between"><span class="mono">${s.id}</span><span class="pill ok" id="sealPill">🔒 Sealed</span></div>
      <table class="small" style="width:100%;margin-top:8px;border-spacing:0 4px">
        <tr><td class="muted">Started</td><td>${when(s.start)}</td></tr>
        <tr><td class="muted">Duration</td><td>${dur(s)} · ${s.chunks.length} pieces of ${CHUNK_MS / 1000}s</td></tr>
        <tr><td class="muted">Trigger</td><td>${s.trigger}</td></tr>
        <tr><td class="muted">Location</td><td>${fmtLoc(s.loc)}</td></tr>
        <tr><td class="muted">Device</td><td class="mono">${s.device}</td></tr>
        <tr><td class="muted">File fingerprint</td><td class="mono">${s.fileHash || 'sealing…'}</td></tr>
      </table></div>
    <h2>Listen</h2><div class="card" id="play">${
      S.playback === 'sealed' ? `<span class="muted">🔐 Sealed mode: this recording can only be opened through an official release (SAPS, court or your lawyer). <span class="pill soon">full version</span></span>`
      : canPlay ? `<audio controls style="width:100%" id="aud"></audio><p class="muted small">Read-only playback. There is no edit, trim or delete.</p>`
      : `<button class="btn soft" id="unlock">🔑 Unlock with PIN to listen</button>`}</div>
    <h2>Chain of custody</h2>
    <button class="btn" id="check">Check seal integrity</button>
    <div id="chain">${s.chunks.map(c => `<div class="block" id="b${c.i}"><div class="row between"><b>Piece #${c.i}</b><span class="small">${new Date(c.ts).toLocaleTimeString('en-ZA')}</span></div>
      <div class="mono muted">audio ${short(c.chunkHash)} · links to ${short(c.prevHash)}</div><div class="mono">seal ${short(c.blockHash)}</div></div>${c.i < s.chunks.length - 1 ? '<div class="link">⛓</div>' : ''}`).join('')}</div>
    <h2>Share & release</h2>
    <div class="grid2">
      <button class="btn soft" id="export">⬇ Export package</button>
      <button class="btn soft" id="release">⚖ Release to…</button>
    </div>
    <button class="btn ghost" id="tamper" style="margin-top:10px">⚠ Simulate tampering <span class="demo-tag">DEMO</span></button>
    <p class="muted small">There is no delete button, by design.</p>`;
  $('#back').onclick = () => go('vault');
  if ($('#aud')) assembleFile(s).then(f => $('#aud').src = URL.createObjectURL(f));
  if ($('#unlock')) $('#unlock').onclick = () => askPin('Unlock playback', () => { unlockedPlayback = id; render(); });
  $('#check').onclick = async () => {
    $('#check').textContent = 'Re-computing fingerprints…';
    const r = await verifyChain(s); let broken = false;
    r.forEach(x => { const b = $('#b' + x.i); b.classList.toggle('broken', !x.ok || broken); if (!x.ok) broken = true; });
    $('#check').textContent = broken ? '✕ Seal broken: tampering detected' : '✓ All pieces intact';
    $('#check').className = 'btn ' + (broken ? 'danger' : '');
    $('#sealPill').className = 'pill ' + (broken ? 'bad' : 'ok'); $('#sealPill').textContent = broken ? '✕ Tampered' : '✓ Verified';
  };
  $('#export').onclick = async () => {
    const f = await assembleFile(s); const ext = s.mime.includes('wav') ? 'wav' : s.mime.includes('mp4') ? 'm4a' : 'webm';
    dl(f, `${s.id}.${ext}`);
    const manifest = { format: 'HerShield evidence manifest v0.1', id: s.id, device: s.device, start: new Date(s.start).toISOString(), end: s.end && new Date(s.end).toISOString(),
      trigger: s.trigger, location: s.loc, mime: s.mime, fileSha256: s.fileHash, genesis: s.genesis, chain: s.chunks.map(({ i, ts, size, chunkHash, prevHash, blockHash }) => ({ i, ts: new Date(ts).toISOString(), size, chunkHash, prevHash, blockHash })) };
    dl(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${s.id}.manifest.json`);
    toast('Exported original audio + manifest');
  };
  $('#release').onclick = () => modal(`<h3>Release evidence to…</h3><p class="muted small">In the full app, evidence is released through a secure link that can be verified and is logged.</p>
    ${['🚔 SAPS (case number)', '⚖ Magistrate court (protection order)', '👩‍⚖️ My lawyer / legal aid', '🏥 Thuthuzela Care Centre', '👤 Trusted person'].map(t => `<div class="option"><div style="flex:1">${t}</div><span class="pill soon">soon</span></div>`).join('')}
    <button class="btn" onclick="closeModal()">Close</button>`);
  $('#tamper').onclick = () => modal(`<h3>Simulate tampering</h3><p class="muted">For the demo only: this changes a single byte inside piece #${Math.min(1, s.chunks.length - 1)}, like someone cutting a word out, to show the seal breaking.</p>
    <div class="row"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn danger" id="doT">Tamper</button></div>`) && ($('#doT').onclick = async () => {
      const k = `${s.id}:${Math.min(1, s.chunks.length - 1)}`; const b = new Uint8Array(await (await getBlob(k)).arrayBuffer());
      b[Math.floor(b.length / 2)] ^= 0xff; await putBlob(k, new Blob([b], { type: s.mime })); closeModal(); toast('One byte changed. Now press “Check seal integrity”.');
    });
};
function dl(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }

/* Verify */
screens.verify = async () => {
  $('#tabbar').hidden = false;
  view.innerHTML = header('Verify evidence', 'For police, courts, lawyers, or anyone who doubts a recording.') + `
    <div class="card drop"><p><b>Check a recording</b></p><p class="muted small">Choose the audio file. Optionally add its manifest (.json). HerShield re-computes the fingerprint and compares it to the sealed record.</p>
      <label class="btn soft" style="margin:6px 0">🎧 Choose audio file<input type="file" id="fAudio" accept="audio/*,.webm,.wav,.m4a" hidden></label>
      <label class="btn ghost">📄 Add manifest (optional)<input type="file" id="fMan" accept=".json,application/json" hidden></label>
      <div class="small muted" id="picked" style="margin-top:6px"></div>
      <button class="btn" id="run" style="margin-top:8px">Verify</button></div>
    <div id="out"></div>
    <h2>Live demo <span class="demo-tag">DEMO</span></h2>
    <div class="grid2"><button class="btn soft" id="dOrig">✓ Check original</button><button class="btn soft" id="dEdit">✂ Check edited copy</button></div>
    <button class="btn ghost" id="dDl" style="margin-top:10px">⬇ Download an edited copy to try</button>
    <div class="card"><h3>How it works</h3><p class="muted small">A SHA-256 fingerprint changes completely if even one bit of a file changes. HerShield stores the fingerprint at the moment of recording, so an edited, trimmed or fabricated file can never match a genuine seal.</p></div>`;
  let audio, man;
  const pick = () => $('#picked').textContent = [audio && '🎧 ' + audio.name, man && '📄 ' + man.name].filter(Boolean).join('  ·  ');
  $('#fAudio').onchange = e => { audio = e.target.files[0]; pick(); };
  $('#fMan').onchange = e => { man = e.target.files[0]; pick(); };
  $('#run').onclick = async () => {
    if (!audio) return toast('Choose an audio file first');
    let manifest = null; if (man) try { manifest = JSON.parse(await man.text()); } catch { return toast('Manifest is not valid JSON'); }
    showResult(await sha256(await audio.arrayBuffer()), audio.name, manifest);
  };
  const latest = async () => (await allSessions()).find(s => s.fileHash);
  $('#dOrig').onclick = async () => { const s = await latest(); if (!s) return toast('Record something or load sample evidence first'); const f = await assembleFile(s); showResult(await sha256(await f.arrayBuffer()), s.id + ' (original)'); };
  $('#dEdit').onclick = async () => { const s = await latest(); if (!s) return toast('Record something or load sample evidence first'); showResult(await sha256(await edited(s)), s.id + ' (edited: 1 second removed)', null, s); };
  $('#dDl').onclick = async () => { const s = await latest(); if (!s) return toast('No recordings yet'); dl(new Blob([await edited(s)], { type: s.mime }), s.id + '-EDITED.' + (s.mime.includes('wav') ? 'wav' : 'webm')); };
};
async function edited(s) { const b = new Uint8Array(await (await assembleFile(s)).arrayBuffer()); const cut = Math.min(8000 * 2, Math.floor(b.length / 4)); const mid = Math.floor(b.length / 2); return new Uint8Array([...b.slice(0, mid), ...b.slice(mid + cut)]).buffer; }
async function showResult(hash, name, manifest, expected) {
  const match = (await allSessions()).find(s => s.fileHash === hash);
  const manOk = manifest ? manifest.fileSha256 === hash : null;
  const ok = !!match || manOk === true;
  const ref = match || expected;
  $('#out').innerHTML = `<div class="result ${ok ? 'ok' : 'bad'}"><div class="big">${ok ? '✓' : '✕'}</div>
    <h2 style="margin:0">${ok ? 'AUTHENTIC' : 'NOT AUTHENTIC'}</h2>
    <p class="small">${ok ? 'This file is byte-for-byte identical to the sealed original.' : 'This file does not match any sealed HerShield record. It has been edited, trimmed, or was not captured by HerShield.'}</p></div>
    <div class="card small"><div><b>File:</b> ${name}</div><div class="mono" style="margin:4px 0"><b>Fingerprint:</b> ${hash}</div>
    ${ref ? `<div class="mono"><b>Sealed:</b> ${ref.fileHash}</div><div class="muted" style="margin-top:4px">Record ${ref.id} · ${when(ref.start)} · 📍 ${fmtLoc(ref.loc)}</div>` : ''}
    ${manifest ? `<div style="margin-top:4px">Manifest ${manifest.id}: ${manOk ? '✓ matches' : '✕ does not match'}</div>` : ''}
    <p class="muted" style="margin-bottom:0">${ok ? 'HerShield does not judge what is said in the recording. It only proves the recording is genuine.' : 'A fabricated or edited recording can never pass this check. This protects people from false evidence too.'}</p></div>`;
  $('#out').scrollIntoView({ behavior: 'smooth' });
}

/* Help */
screens.help = () => {
  $('#tabbar').hidden = false;
  view.innerHTML = header('Get help now', 'Free South African helplines. Tap to call.') +
    [['🆘', 'GBV Command Centre', '0800 428 428', 'tel:0800428428', '24/7, free from any phone'],
     ['💬', 'GBV “Please call me”', '*120*7867#', 'tel:*120*7867%23', 'USSD, works without airtime'],
     ['🚔', 'SAPS emergency', '10111', 'tel:10111', 'Police'],
     ['🧒', 'Childline', '116', 'tel:116', 'If children are at risk']].map(([i, t, n, h, d]) =>
      `<a class="card row between" href="${h}" style="text-decoration:none;color:inherit"><div class="row"><span style="font-size:26px">${i}</span><div><h3>${t}</h3><span class="muted small">${d}</span></div></div><b style="color:var(--accent)">${n}</b></a>`).join('') + `
    <h2>Nearby</h2>
    <button class="btn soft" data-s="Nearest police station">📍 Nearest police station</button>
    <button class="btn soft" data-s="Thuthuzela Care Centres & shelters" style="margin-top:8px">🏥 Thuthuzela Care Centre / shelter</button>
    <button class="btn soft" data-s="Protection order guide" style="margin-top:8px">⚖ How to get a protection order</button>
    <button class="btn ghost" id="safety" style="margin-top:8px">📝 Make a safety plan</button>`;
  view.querySelectorAll('[data-s]').forEach(b => b.onclick = () => soon(b.dataset.s));
  $('#safety').onclick = () => soon('Personal safety plan');
};

/* Settings */
screens.settings = () => {
  $('#tabbar').hidden = false;
  const tog = (id, on) => `<label class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span></span></label>`;
  const rowS = (t, d, right) => `<div class="card row between"><div style="flex:1"><h3>${t}</h3><span class="muted small">${d}</span></div>${right}</div>`;
  view.innerHTML = header('Settings') + `
    <h2>Appearance</h2>
    <div class="card"><h3>Theme colour</h3><div class="swatches" style="margin-top:8px">${THEMES.map((t, i) => `<button class="swatch ${S.accent === t.a ? 'on' : ''}" data-t="${i}" title="${t.name}" style="background:linear-gradient(135deg,${t.a},${t.b})"></button>`).join('')}
      <label class="swatch" title="Custom" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"><input type="color" id="custom" value="${S.accent}" style="opacity:0;width:1px"></label></div></div>
    ${rowS('Dark mode', 'Dim screen for discreet use', tog('dark', S.dark))}
    <h2>Triggers</h2>
    ${rowS('Secret phrase', '“' + S.phrase.replace(/\S/g, (c, i) => i < 3 ? c : '•') + '”', '<button class="btn sm soft" id="chPhrase">Change</button>')}
    <div class="card"><div class="row between"><h3>Phrase sensitivity</h3><span class="muted small" id="sensV">${S.sensitivity}%</span></div>
      <input type="range" id="sens" min="30" max="100" value="${S.sensitivity}" style="width:100%;accent-color:var(--accent)">
      <span class="muted small">Higher = triggers more easily (more false starts, never a missed one).</span></div>
    ${rowS('Shake 3 times', 'Starts recording without speaking', tog('shake', S.shake))}
    ${rowS('Triple-tap the logo', 'Quick trigger from the Shield screen', tog('tap', S.tripleTap))}
    ${rowS('Volume-button pattern', 'e.g. up-down-up, works with the screen locked', '<span class="pill soon">full version</span>')}
    ${rowS('Bluetooth bracelet / smartwatch', 'Press a hidden button. The phone can stay in a bag', '<span class="pill soon">full version</span>')}
    <h2>Evidence</h2>
    <div class="card"><h3>Who can listen to recordings?</h3>
      ${[['pin', 'Me, after entering my PIN', 'Recommended. Read-only: no edit, no delete.'], ['open', 'Me, any time', 'Fastest, but less private if someone has your phone.'], ['sealed', 'Nobody until official release', 'Maximum protection. Only SAPS/court/lawyer release opens it.']].map(([v, t, d]) =>
        `<label class="option ${S.playback === v ? 'on' : ''}"><input type="radio" name="pb" value="${v}" ${S.playback === v ? 'checked' : ''}><div><h3>${t}</h3><span class="muted small">${d}</span></div></label>`).join('')}</div>
    ${rowS('Backup to secure cloud when online', 'Encrypted copy + fingerprint registered with a trusted timestamp', '<span class="pill soon">full version</span>')}
    ${rowS('Alert trusted people', S.contacts.length + ' contact(s) · SMS with location when triggered', '<span class="pill soon">full version</span>')}
    ${rowS('Delete recordings', 'Not available, by design. Evidence is permanent so it can be trusted.', '<span class="pill bad">🔒 Off</span>')}
    <h2>Privacy & security</h2>
    ${rowS('Change PIN', 'Used to open the app and stop recordings', '<button class="btn sm soft" id="chPin">Change</button>')}
    ${rowS('Duress PIN', S.duressPin ? 'Set. Opens an empty decoy' : 'Not set', '<button class="btn sm soft" id="chD">' + (S.duressPin ? 'Change' : 'Set') + '</button>')}
    ${rowS('Disguise', 'Calculator (Notes & Weather in full version)', '<span class="pill info">🧮</span>')}
    <div class="card"><h3>Language</h3><select id="lang" style="margin-top:8px">${LANGS.map(l => `<option ${S.language === l ? 'selected' : ''}>${l}${l === 'English' ? '' : ' (coming)'}</option>`).join('')}</select></div>
    <h2>Demo tools <span class="demo-tag">DEMO</span></h2>
    <div class="grid2"><button class="btn soft" id="seed2">Load samples</button><button class="btn soft" id="reob">Replay setup</button></div>
    <button class="btn ghost" id="reset" style="margin-top:10px">Reset demo device</button>
    <p class="muted small" style="text-align:center">HerShield demo v0.1 · Device ${S.deviceId}<br>Team HerShield · Rosebank International Polokwane · WEtTech 2026</p>`;
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const t = THEMES[b.dataset.t]; S.accent = t.a; S.accent2 = t.b; save(); render(); });
  $('#custom').oninput = e => { S.accent = e.target.value; S.accent2 = e.target.value; save(); };
  $('#dark').onchange = e => { S.dark = e.target.checked; save(); };
  $('#shake').onchange = e => { S.shake = e.target.checked; save(); };
  $('#tap').onchange = e => { S.tripleTap = e.target.checked; save(); };
  $('#sens').oninput = e => { S.sensitivity = +e.target.value; $('#sensV').textContent = S.sensitivity + '%'; save(); };
  view.querySelectorAll('[name=pb]').forEach(r => r.onchange = () => askPin('Change playback rule', () => { S.playback = r.value; save(); render(); }));
  $('#lang').onchange = e => { if (!e.target.value.startsWith('English')) { soon('HerShield in ' + e.target.value.replace(' (coming)', '')); e.target.value = 'English'; } };
  $('#chPhrase').onclick = () => askPin('Change secret phrase', () => { ob.phraseReps = 0; go('onboard/3'); });
  $('#chPin').onclick = () => askPin('Change PIN', () => go('onboard/5'));
  $('#chD').onclick = () => askPin('Duress PIN', () => go('onboard/5'));
  $('#seed2').onclick = async () => { await seedSamples(); toast('Sample evidence added to the Vault'); };
  $('#reob').onclick = () => go('onboard/1');
  $('#reset').onclick = () => modal(`<h3>Reset demo device?</h3><p class="muted">This wipes the demo so you can show the setup again. <b>The real app has no way to do this.</b></p>
    <div class="row"><button class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn danger" id="doR">Reset</button></div>`) && ($('#doR').onclick = async () => {
      localStorage.removeItem('hs.settings'); (await db()).close(); indexedDB.deleteDatabase('hershield'); location.hash = ''; location.reload(); });
};

/* ---------------- Router ---------------- */
async function render() {
  closeModal();
  const [name, arg] = (location.hash.slice(1) || '').split('/');
  let route = name;
  if (!S.onboarded && route !== 'onboard') route = 'onboard';
  if (S.onboarded && !route) route = 'disguise';
  if (route === 'recording' && !rec) route = 'home';
  if (rec && route !== 'recording') route = 'recording';
  if (route !== 'home') stopListening();
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.go === route || (route === 'session' && b.dataset.go === 'vault')));
  window.scrollTo(0, 0);
  await (screens[route] || screens.home)(arg || (route === 'onboard' ? '1' : undefined));
  const q = $('#qexit'); if (q) q.onclick = () => { unlockedPlayback = false; location.replace('#disguise'); };
}
document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => go(b.dataset.go));
window.addEventListener('hashchange', render);
applyTheme();
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
