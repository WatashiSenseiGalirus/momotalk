(() => {
'use strict';

/* ============ util ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
let toastT;
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms);
}

/* avatar bawaan (dipakai kalau foto wiki gagal dimuat) */
const AV_DEFAULT = 'data:image/svg+xml;utf8,' + encodeURIComponent(
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#cfdcea"/><circle cx="50" cy="38" r="17" fill="#fff"/><path d="M16 100c2-24 18-36 34-36s32 12 34 36z" fill="#fff"/><ellipse cx="50" cy="12" rx="15" ry="4" fill="none" stroke="#f991a1" stroke-width="2.4"/></svg>`);
const HEART = `<svg viewBox="0 0 40 36" aria-hidden="true"><path d="M20 34C8 25 2 18 2 11 2 6 6 2 11 2c4 0 7 2 9 5 2-3 5-5 9-5 5 0 9 4 9 9 0 7-6 14-18 23z" fill="#e6a0c4" stroke="#b9709a" stroke-width="2"/></svg>`;

/* ============ gambar: thumb -> asli -> proxy -> cadangan ============ */
const STATIC_RE = /^(https:\/\/static\.wikitide\.net\/bluearchivewiki)\/([0-9a-f]\/[0-9a-f]{2})\/([^/]+)$/;
const thumb = (url, w) => { const m = STATIC_RE.exec(url || ''); return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${w}px-${m[3]}` : url; };
const proxy = url => '/api/img?u=' + encodeURIComponent(url);
function chain(url, w) {
  if (!url) return [];
  if (!/^https?:/.test(url)) return [url];                 // data: URL
  const c = [];
  if (w && thumb(url, w) !== url) c.push(thumb(url, w));
  c.push(url);
  if (STATIC_RE.test(url)) c.push(proxy(url));
  return c;
}
function imgTag(urls, cls, alt = '', extra = '') {
  if (!urls.length) return `<img class="${cls}" src="${AV_DEFAULT}" alt="${esc(alt)}">`;
  return `<img class="${cls}" src="${esc(urls[0])}" data-c="${esc(urls.slice(1).join('|'))}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" ${extra}>`;
}
// error tidak menggelembung, jadi pakai fase capture
document.addEventListener('error', e => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG' || !el.dataset) return;
  const rest = (el.dataset.c || '').split('|').filter(Boolean);
  if (rest.length) { el.dataset.c = rest.slice(1).join('|'); el.src = rest[0]; return; }
  if (el.classList.contains('av') || el.classList.contains('pf-photo')) { if (el.src !== AV_DEFAULT) el.src = AV_DEFAULT; return; }
  const t = el.closest('.tile');
  if (t) {
    t.classList.add('gone');
    const g = t.parentElement;
    if (g && !g.querySelector('.tile:not(.gone)') && !g.nextElementSibling?.classList.contains('hint-fail')) {
      g.insertAdjacentHTML('afterend', '<div class="hint hint-fail">Gambar tidak bisa dimuat. Biasanya karena tidak ada internet atau wiki memblokir akses langsung. Coba lagi nanti, atau jalankan lewat <code>node server.js</code> agar proxy gambar aktif.</div>');
    }
  } else el.style.visibility = 'hidden';
}, true);
// video: asli -> proxy
document.addEventListener('error', e => {
  const v = e.target;
  if (!v || v.tagName !== 'VIDEO' || v.dataset.px) return;
  v.dataset.px = '1'; v.src = proxy(v.dataset.u); v.load();
}, true);

/* ============ data murid ============ */
const DB = { students: {}, names: [], story: {}, conv: {} };
let LIST = [];             // [{id,title,name,det}]
const byId = new Map();

async function loadData() {
  try {
    const r = await fetch('data/students.json', { cache: 'no-cache' });
    Object.assign(DB, await r.json());
  } catch { /* tanpa data: daftar kosong */ }
  const titles = new Set(DB.names);
  Object.keys(DB.students).forEach(t => titles.add(t));
  LIST = [...titles].map(title => {
    const det = DB.students[title] || null;
    return { id: det?.id || slug(title), title, name: det?.name || title, det, conv: DB.conv[title] || null, story: DB.story[title] || null };
  }).sort((a, b) => a.title.localeCompare(b.title));
  byId.clear(); LIST.forEach(s => byId.set(s.id, s));
}

/* ---- sesi per browser: semua data tersimpan di localStorage milik browser ini, diberi awalan ID sesi acak.
        Server tidak menyimpan apa pun; ID sesi hanya dikirim sebagai header untuk pembatasan laju. ---- */
const SID_KEY = 'momotalk:sid';
const newSid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));
const SID = (() => {
  try {
    let s = localStorage.getItem(SID_KEY);
    if (!/^[a-zA-Z0-9-]{16,64}$/.test(s || '')) { s = newSid(); localStorage.setItem(SID_KEY, s); }
    return s;
  } catch { return newSid(); }   // penyimpanan diblokir: sesi hanya hidup selama tab terbuka
})();
const NS = `momotalk:s:${SID}:`;
const LS_SET = NS + 'settings';
const roomKey = id => NS + 'room:' + id, chatKey = id => NS + 'chat:' + id, avKey = id => NS + 'avatar:' + id, timeKey = id => NS + 't:' + id;
const defaults = { model: '', temperature: 0.8, password: '', lang: 'auto', extra: '', events: true, eventEvery: 8, micLang: 'id-ID', micAuto: false, invites: true, maxRoom: 3 };
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* penyimpanan penuh */ } };

// migrasi data lama (tanpa sesi) ke sesi browser ini, sekali saja
try {
  if (!localStorage.getItem(NS + 'migrated')) {
    const moves = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); let to = null, m;
      if ((m = k.match(/^momotalk:(chat|avatar|t):(.+)$/))) to = NS + m[1] + ':' + m[2];
      else if (k === 'momotalk-aris:settings') to = LS_SET;
      else if (k === 'momotalk-aris:chat') to = chatKey('arisu');
      else if (k === 'momotalk-aris:avatar') to = avKey('arisu');
      if (to) moves.push([k, to]);
    }
    for (const [k, to] of moves) { if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k)); localStorage.removeItem(k); }
    localStorage.setItem(NS + 'migrated', '1');
  }
} catch { /* abaikan */ }

const state = {
  settings: { ...defaults, ...load(LS_SET, {}) },
  cur: null,                 // murid yang dibuka
  messages: [],              // pesan murid yang dibuka
  room: [],                  // id murid lain yang disambungkan ke ruang ini (selain murid tuan rumah)
  reply: null,               // pesan yang sedang dibalas {who,name,text}
  mention: [],               // nama murid yang baru disebut Sensei (petunjuk tawaran sambungan)
  private: null,             // mode berdua: { with: id } | null — murid lain senyap & tidak tahu isi
  tab: 'chat',
  busy: false, ctrl: null,
  server: { model: '', needsPassword: false },
};
const chatOf = id => load(chatKey(id), []);
const persist = () => state.cur && save(chatKey(state.cur.id), state.messages.filter(m => !m.live).slice(-200));
const saveRoom = () => state.cur && save(roomKey(state.cur.id), state.room);

/* foto profil: unggahan sendiri > foto wiki > tebakan pola nama > bawaan */
function avatarUrls(s, w = 128) {
  const custom = load(avKey(s.id), '');
  if (custom) return [custom];
  const prof = s.det?.images?.['Profile Image']?.[0]?.url || s.conv?.profile;
  return chain(prof, w);
}
const avImg = (s, cls = 'av', w = 128) => imgTag(avatarUrls(s, w), cls, s.name);

/* ============ ruang obrolan: anggota, nama, parsing ============ */
const personaOf = s => s.det || { id: s.id, name: s.name };
const promptName = s => (s.id === 'arisu' ? 'Aris' : s.name);
const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/* koreksi nama murid yang salah ketik: "lori" (huruf L kecil) -> "Iori" (huruf I besar) tampak sama di font sans.
   Hanya dipakai untuk teks yang dikirim ke AI dan deteksi sebutan nama; tampilan chat tidak berubah. */
const lI = t => String(t).toLowerCase().replace(/l/g, 'i');
let _nameFix = null;
function nameFixMap() {
  if (_nameFix && _nameFix.n === LIST.length) return _nameFix.m;
  const m = new Map();
  for (const s of LIST) {
    const base = promptName(s).replace(/\s*\(.*\)$/, '').trim();
    if (base.length >= 4 && !/\s/.test(base)) m.set(lI(base), base);
  }
  _nameFix = { n: LIST.length, m };
  return m;
}
/* daftar murid per sekolah untuk prompt AI (supaya karakter tahu siapa teman dan siapa murid sekolah lain) */
function schoolRoster() {
  const g = new Map();
  for (const s of LIST) { const sc = s.det?.school; if (!sc) continue; if (!g.has(sc)) g.set(sc, []); const n = promptName(s).replace(/\s*\(.*\)$/, ''); if (!g.get(sc).includes(n)) g.get(sc).push(n); }
  return [...g].map(([school, names]) => ({ school, names }));
}
function fixNames(text) {
  const m = nameFixMap();
  return String(text || '').replace(/\p{L}{4,}/gu, w => m.get(lI(w)) || w);
}
const members = () => (state.cur ? [state.cur, ...state.room.map(id => byId.get(id)).filter(Boolean)] : []);
const maxRoom = () => Math.min(4, Math.max(2, Number(state.settings.maxRoom) || 3));
// semua murid yang pernah ada di ruang ini (supaya pesan lama dari murid yang sudah keluar tetap terbaca)
function rosterIds(host, msgs, room) {
  const ids = new Set([host.id, ...(room || [])]);
  (msgs || []).forEach(m => m.who && ids.add(m.who));
  return [...ids].map(id => byId.get(id)).filter(Boolean);
}

/* ---- mode berdua / privasi grup ---- */
const PRIV_START_RE = /\b(berdua|privat|pribadi|rahasia|ngobrol\s*berdua|chat\s*(pribadi|privat|berdua)|urusan\s*berdua|cuma\s*(kita|kamu)|hanya\s*(kita|kamu)|kita\s*aja|kamu\s*aja|bisik|whisper|private)\b/i;
const PRIV_END_RE = /\b(selesai|udah\s*(selesai|dulu)?|sudah\s*(selesai)?|balik(\s*ke)?\s*(grup|semua)?|kembali(\s*ke)?\s*(grup|semua)?|open\s*grup|buka\s*grup|panggil\s*(yang\s*lain|semua)|ayo\s*(semua|bareng)|kita\s*semua)\b/i;
function privatePartner() {
  return state.private?.with ? byId.get(state.private.with) : null;
}
function isPrivateActive() {
  return !!(state.private && state.private.with && members().some(s => s.id === state.private.with));
}
function startPrivate(withId, reason = '') {
  if (!withId || withId === state.cur?.id && members().length < 2) return false;
  // partner harus ada di ruang
  if (!members().some(s => s.id === withId)) return false;
  state.private = { with: withId };
  return true;
}
function endPrivate(silent = false) {
  if (!state.private) return false;
  const partner = privatePartner();
  state.private = null;
  if (!silent && partner) {
    state.messages.push({
      role: 'user',
      content: `(Catatan sistem: percakapan pribadi Sensei dengan ${promptName(partner)} selesai. Murid lain kembali ke ruang dan tidak tahu sama sekali isi percakapan pribadi tersebut — mereka bersikap seolah tidak terjadi apa-apa dan tidak menyinggung topik berdua.)`,
      sys: true
    });
  }
  return true;
}
const rosterNow = () => (state.cur ? rosterIds(state.cur, state.messages, state.room) : []);
function aliasesOf(s) {
  const a = new Set();
  [s.name, s.title, String(s.name).split(/[\s(]/)[0], String(s.title).split(/[\s(]/)[0]].forEach(x => x && a.add(norm(x)));
  if (s.id === 'arisu') a.add('aris');
  return [...a];
}
// nama dari tag [[SAMBUNG: Nama]] -> murid
function findStudent(name) {
  const q = norm(name).replace(/\s*\(.*\)\s*$/, '');
  if (!q) return null;
  if (q === 'aris') return byId.get('arisu') || null;
  return LIST.find(s => norm(s.title) === q) || LIST.find(s => norm(s.name) === q) || LIST.find(s => norm(s.det?.fullName) === q)
    || LIST.find(s => norm(s.title).startsWith(q + ' (')) || null;
}
// murid lain yang baru disebut Sensei di pesannya
function mentionedNames(text) {
  text = fixNames(text);
  const out = [], inRoom = new Set(members().map(s => s.id));
  for (const s of LIST) {
    if (inRoom.has(s.id)) continue;
    const base = s.title.replace(/\s*\(.*\)$/, '');
    const names = [base, ...(s.id === 'arisu' ? ['Aris'] : [])];
    if (names.some(n => n.length >= 3 && new RegExp('(^|[^\\p{L}])' + escRe(n) + '(?![\\p{L}])', 'iu').test(text)) && !out.includes(base)) out.push(base);
    if (out.length >= 3) break;
  }
  return out;
}

/* ============ parsing balasan AI ============
   Hasil: items [{who, text}] (siapa yang bicara), choices, invite (nama dari [[SAMBUNG: ..]]).
   Di ruang grup, tiap baris berformat "Nama: pesan". Baris tanpa nama dianggap lanjutan pembicara sebelumnya. */
function parseAI(raw, host = state.cur, roster = null, live = false) {
  let t = String(raw || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
  let choices = [], invite = '';
  const m = t.match(/\[\[\s*PILIH\s*:([\s\S]*?)\]\]/i);
  if (m) choices = m[1].split('|').map(s => s.trim().replace(/^["“]|["”]$/g, '')).filter(Boolean).slice(0, 3);
  const iv = t.match(/\[\[\s*SAMBUNG\s*:([\s\S]*?)\]\]/i);
  if (iv) invite = iv[1].trim();
  t = t.replace(/\[\[[\s\S]*$/, '').replace(/\[$/, '');
  const people = roster && roster.length ? roster : [host];
  const look = new Map();
  people.forEach(s => aliasesOf(s).forEach(a => look.set(a, s)));
  if (host && host.id === 'arisu') look.set('aris', host);
  const keys = [...look.keys()].sort((a, b) => b.length - a.length).map(escRe);
  const re = keys.length ? new RegExp('^(' + keys.join('|') + ')\\s*[:：]\\s*', 'i') : null;
  let rows = t.split(/\n+/);
  // saat streaming, potongan baris pendek yang belum lengkap (mis. "Hi" dari "Hina:") ditahan dulu
  if (live && rows.length) { const lr = rows[rows.length - 1].trim(); if (lr && lr.length <= 16 && !/[:：.!?…]/.test(lr)) rows = rows.slice(0, -1); }
  let cur = host; const items = [];
  for (const raw of rows) {
    let l = raw.trim().replace(/^(?:[-*•]\s+)/, '').replace(/\*\*/g, '');
    if (!l) continue;
    const pm = re && l.match(re);
    if (pm) { cur = look.get(norm(pm[1])) || cur; l = l.slice(pm[0].length).trim(); }
    if (l) items.push({ who: cur, text: l });
  }
  const cap = people.length > 1 ? 9 : 6;
  const kept = items.slice(0, cap);
  return { items: kept, lines: kept.map(x => x.text), choices, invite };
}

/* ============ render chat ============ */
const list = $('#list'), scroller = $('#scroll'), choicesEl = $('#choices');
const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
const toBottom = (smooth = true) => scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

const aiRow = (inner, s = state.cur) => `<div class="row ai">${avImg(s, 'av', 96)}<div class="col"><div class="nm">${esc(s.name)}</div>${inner}</div></div>`;
const typingDots = '<div class="bub typing"><i></i><i></i><i></i></div>';
const typing = s => aiRow(typingDots, s);
/* multi-typing: avatar bertindihan kiri→kanan ala WhatsApp + gelembung typing */
function typingMulti(list) {
  if (!list || !list.length) return typing(state.cur);
  if (list.length === 1) return typing(list[0]);
  // kanan di atas (z lebih tinggi), kiri di belakang — mirip WhatsApp
  const stack = list.map((s, i) => avImg(s, 'av stack-av', 72).replace('<img ', `<img style="z-index:${i + 1}" `)).join('');
  return `<div class="row ai multi-type"><div class="av-stack">${stack}</div><div class="col">${typingDots}</div></div>`;
}
const quoteHtml = r => (r ? `<div class="quote"><b>${esc(r.name)}</b>${esc(r.text)}</div>` : '');

function blockInner(m, i) {
  if (m.role === 'user') {
    if (m.sys) return `<div class="sysmsg priv-end">${esc(m.content.replace(/^\(Catatan sistem:\s*/i, '').replace(/\)$/, ''))}</div>`;
    return `<div class="row me"><div class="bub">${quoteHtml(m.reply)}${esc(m.content)}</div></div>`;
  }
  if (m.role === 'join' || m.role === 'leave') {
    const s = byId.get(m.who);
    return `<div class="sysmsg">${esc(s ? s.name : '?')} ${m.role === 'join' ? 'bergabung ke percakapan' : 'keluar dari percakapan'}</div>`;
  }
  if (m.role === 'event') {
    return `<div class="box event"><div class="lbl">Relationship Event</div><button type="button" data-act="story">To ${esc(state.cur.name)}'s Relationship Story</button></div>`;
  }
  if (m.error) return aiRow(`<div class="bub err">${esc(m.error)}</div><button type="button" class="retry" data-act="retry">Coba lagi</button>`);
  const { items } = parseAI(m.content, state.cur, rosterNow(), !!m.live);
  if (!items.length) {
    if (!m.live) return '';
    // mode berdua → selalu hanya partner (anti typing rame)
    if (isPrivateActive() && state.private?.with) {
      return typing(byId.get(state.private.with) || state.cur);
    }
    // reply / typer tunggal → satu karakter; typers → stack multi (WhatsApp style)
    if (m.typer) return typing(byId.get(m.typer) || state.cur);
    if (m.typers && m.typers.length) {
      const list = m.typers.map(id => byId.get(id)).filter(Boolean);
      return list.length ? typingMulti(list) : typing(state.cur);
    }
    return typing(state.cur);
  }
  let html = '', k = 0;
  while (k < items.length) {
    const who = items[k].who; let j = k, inner = '';
    while (j < items.length && items[j].who === who) { inner += `<div class="bub" data-mi="${i}" data-li="${j}">${esc(items[j].text)}</div>`; j++; }
    html += aiRow(inner, who); k = j;
  }
  return html;
}

// tawaran sambungan dari karakter ([[SAMBUNG: Nama]]) yang belum dijawab
function pendingInvite(m) {
  if (!m || m.role !== 'assistant' || m.error || m.inv || m.live) return null;
  const { invite } = parseAI(m.content);
  if (!invite) return null;
  const s = findStudent(invite);
  if (!s || members().some(x => x.id === s.id) || members().length >= maxRoom()) return null;
  return s;
}

function renderChoices() {
  choicesEl.innerHTML = '';
  if (state.busy) return;
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== 'assistant' || last.error) return;
  const inv = pendingInvite(last);
  if (inv) {
    const en = state.settings.lang === 'en';
    choicesEl.innerHTML = `<div class="box reply"><div class="lbl">${en ? 'Connect' : 'Sambungkan'} ${esc(inv.name)}?</div>` +
      `<button type="button" data-inv="yes">${en ? 'Yes, connect ' : 'Ya, sambungkan '}${esc(inv.name)}</button>` +
      `<button type="button" data-inv="no">${en ? 'Not now' : 'Tidak usah dulu'}</button></div>`;
    return;
  }
  const { choices } = parseAI(last.content);
  if (!choices.length) return;
  choicesEl.innerHTML = `<div class="box reply"><div class="lbl">Reply</div>${choices.map((c, i) => `<button type="button" data-choice="${i}">${esc(c)}</button>`).join('')}</div>`;
}

function render(stick = true) {
  list.innerHTML = state.messages.map((m, i) => `<div class="blk" id="b${i}">${blockInner(m, i)}</div>`).join('');
  renderChoices();
  if (stick) requestAnimationFrame(() => toBottom(false));
}
function updateLive(i) {
  const el = $('#b' + i); if (!el) return render();
  const stick = nearBottom();
  el.innerHTML = blockInner(state.messages[i], i);
  if (stick) toBottom(false);
}

/* ---- bar ruang (anggota) & bar balasan ---- */
function updateHeaderTitle() {
  if (!state.cur) return;
  const mem = members();
  if (mem.length > 1) {
    $('#hTitle').textContent = 'mode GRUP';
    document.title = 'MomoTalk · mode GRUP';
  } else {
    $('#hTitle').textContent = state.cur.name;
    document.title = `MomoTalk · ${state.cur.name}`;
  }
}
function renderRoomBar() {
  const bar = $('#roomBar'); if (!bar || !state.cur) return;
  const mem = members(), full = mem.length >= maxRoom();
  bar.innerHTML = `<div class="room-chips">${mem.map((s, i) => `<span class="chip">${avImg(s, 'av', 48)}<b>${esc(s.name)}</b>` +
    (i ? `<button type="button" class="chip-x" data-kick="${esc(s.id)}" aria-label="Keluarkan ${esc(s.name)}" title="Keluarkan dari ruang">×</button>` : '') + '</span>').join('')}</div>` +
    (full ? '' : '<button type="button" class="room-add" id="btnInvite" title="Sambungkan murid lain ke percakapan ini">+ Sambungkan</button>');
  bar.classList.toggle('solo', mem.length < 2);
  updateHeaderTitle();
}
function renderReplyBar() {
  const b = $('#replyBar'), r = state.reply;
  b.hidden = !r;
  b.innerHTML = r ? `<div class="rq"><b>Membalas ${esc(r.name)}</b><span>${esc(r.text)}</span></div><button type="button" class="rx" data-replyx="1" aria-label="Batalkan balasan">×</button>` : '';
}
function renderPrivateBar() {
  const b = $('#privBar'); if (!b) return;
  const active = isPrivateActive();
  b.hidden = !active;
  if (!active) { b.innerHTML = ''; return; }
  const p = privatePartner();
  const nm = p ? p.name : '?';
  b.innerHTML = `<div class="pq"><b>Mode berdua dengan ${esc(nm)}</b><span>Karakter lain senyap & tidak tahu isi obrolan</span></div>` +
    `<button type="button" class="px" data-privend="1" aria-label="Akhiri mode berdua">Selesai</button>`;
}
function setReply(s, text) {
  state.reply = { who: s.id, name: s.name, text: String(text).slice(0, 140) };
  renderReplyBar(); $('#input').focus();
}

/* ============ jaringan ============ */
async function streamChat(messages, onDelta, signal) {
  const s = state.settings;
  const headers = { 'Content-Type': 'application/json', 'x-session-id': SID };
  if (s.password) headers['x-app-password'] = s.password;
  const body = { messages, stream: true, temperature: Number(s.temperature) };
  if (s.model) body.model = s.model;
  const res = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    let t = await res.text().catch(() => '');
    try { t = JSON.parse(t).error || t; } catch { /* bukan JSON */ }
    throw new Error(t || `Server membalas ${res.status}`);
  }
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    const j = await res.json();
    const txt = j.choices?.[0]?.message?.content || '';
    onDelta(txt); return txt;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        const c = j.choices?.[0]?.delta?.content ?? '';
        if (c) { full += c; onDelta(full); }
      } catch { /* potongan SSE tidak lengkap */ }
    }
  }
  return full;
}

const personaStudent = () => state.cur && personaOf(state.cur);

// prompt sistem: murid tunggal, atau ruang grup kalau ada murid yang disambungkan
function systemPrompt() {
  const st = state.settings, mem = members(), msgs = state.messages;
  const turns = msgs.filter(m => m.role === 'user' && !m.sys).length;
  let since = Infinity, u = 0;
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].offered) { since = u; break; } if (msgs[i].role === 'user' && !msgs[i].sys) u++; }
  const mention = state.mention || [];
  const offer = st.invites !== false && mem.length < maxRoom() && !isPrivateActive() && (mention.length > 0 || (turns >= 2 && since >= 4));
  const avoid = msgs.filter(m => m.inv === 'no' && m.invWho).map(m => byId.get(m.invWho)?.name).filter(Boolean);
  const o = { offer, canInvite: offer, avoid, mention, roster: schoolRoster() };

  // mode berdua: hanya partner yang aktif; yang lain senyap & tidak tahu isi
  if (isPrivateActive()) {
    const partner = privatePartner();
    const others = mem.filter(s => s.id !== partner.id).map(s => promptName(s));
    const base = PERSONA.build(personaOf(partner), st.lang, st.extra, { offer: false, canInvite: false, avoid: [], mention: [], roster: schoolRoster() });
    const privRule = `\n\n# MODE BERDUA / PRIVASI (WAJIB DIPATUHI)
Saat ini Sensei sedang ngobrol berdua secara pribadi hanya dengan ${promptName(partner)}. Murid lain (${others.join(', ') || '—'}) sudah undur diri / mode senyap dan TIDAK boleh menulis bubble sama sekali.
- Hanya tulis bubble dari ${promptName(partner)} (format tetap "Nama: pesan" boleh, atau langsung isi kalau solo).
- Jangan menyinggung murid lain, jangan memanggil mereka, jangan mengutip apa yang mereka katakan sebelum mode berdua.
- Setelah mode berdua berakhir nanti, murid lain tidak akan tahu isi percakapan ini — anggap seperti tidak pernah terjadi di hadapan mereka.
- Tetap ada baris [[PILIH: ... | ...]] di akhir.`;
    return base + privRule;
  }

  if (mem.length > 1) {
    return PERSONA.buildGroup(mem.map(x => ({ st: personaOf(x), label: promptName(x) })), st.lang, st.extra, o);
  }
  return PERSONA.build(personaStudent(), st.lang, st.extra, o);
}

function apiMessages() {
  const mem = members(), group = mem.length > 1, ro = rosterNow();
  const hist = [];
  const push = (role, content) => { const l = hist[hist.length - 1]; if (l && l.role === role) l.content += '\n' + content; else hist.push({ role, content }); };
  // saat private aktif: jangan kirim pesan private lama ke model sebagai konteks grup; filter sys notes dengan hati-hati
  const priv = isPrivateActive();
  const partnerId = state.private?.with;
  state.messages.filter(m => !m.error && !m.live && (m.content || m.role === 'join' || m.role === 'leave')).slice(-40).forEach(m => {
    // pesan pribadi (priv) hanya dimasukkan kalau masih dalam mode berdua yang sama
    if (m.priv && (!priv || m.privWith !== partnerId)) return;
    if (m.role === 'user') {
      if (m.sys) push('user', m.content);
      else push('user', (m.reply ? `(Sensei membalas pesan ${m.reply.name}: "${m.reply.text}")\n` : '') + fixNames(m.content));
    } else if (m.role === 'join') push('user', `(Catatan sistem: ${promptName(byId.get(m.who) || { name: '?' })} bergabung ke ruang obrolan.)`);
    else if (m.role === 'leave') push('user', `(Catatan sistem: ${promptName(byId.get(m.who) || { name: '?' })} keluar dari ruang obrolan.)`);
    else if (m.role === 'assistant') {
      if (group && !priv) push('assistant', parseAI(m.content, state.cur, ro).items.map(x => `${promptName(x.who)}: ${x.text}`).join('\n'));
      else if (priv) {
        // hanya bubble partner yang relevan
        const items = parseAI(m.content, state.cur, ro).items.filter(x => x.who?.id === partnerId);
        if (items.length) push('assistant', items.map(x => `${promptName(x.who)}: ${x.text}`).join('\n'));
        else if (!group) push('assistant', m.content);
      } else push('assistant', m.content);
    }
  });
  if (hist.length && hist[0].role === 'assistant') hist.unshift({ role: 'user', content: '(Sensei membuka MomoTalk.)' });
  return [{ role: 'system', content: systemPrompt() }, ...hist];
}

/* ============ alur chat ============ */
function setBusy(b) {
  state.busy = b;
  $('#btnSend').hidden = b; $('#btnStop').hidden = !b;
  syncSend();
}
function syncSend() { $('#btnSend').disabled = state.busy || !$('#input').value.trim(); }

async function runAI(opts = {}) {
  const owner = state.cur, msgs = state.messages;     // murid bisa berganti saat streaming
  setBusy(true);
  const msg = { role: 'assistant', content: '', live: true };
  // mode berdua → typing HANYA partner (jangan pernah multi)
  if (isPrivateActive()) {
    msg.typer = state.private.with;
  } else if (opts.typer) {
    msg.typer = opts.typer;
  } else if (opts.typers) {
    msg.typers = opts.typers;
  }
  // tandai bubble AI saat mode berdua agar tidak bocor ke konteks grup setelah selesai
  if (isPrivateActive()) {
    msg.priv = true;
    msg.privWith = state.private.with;
  }
  msgs.push(msg);
  const idx = msgs.length - 1;
  render();
  const ctrl = state.ctrl = new AbortController();
  const here = () => state.cur === owner && state.messages === msgs;
  const ro = rosterNow();
  try {
    const history = apiMessages();
    await streamChat(history, txt => { msg.content = txt; if (here()) updateLive(idx); }, ctrl.signal);
    delete msg.live;
    const res = parseAI(msg.content, owner, ro);
    if (!res.items.length) throw new Error(`${owner.name} tidak membalas (jawaban kosong). Coba kirim lagi.`);
    if (res.invite) msg.offered = true;
    maybeEvent(msgs);
  } catch (e) {
    delete msg.live;
    if (e.name === 'AbortError') {
      if (!parseAI(msg.content, owner, ro).items.length) msgs.splice(idx, 1);
    } else {
      msg.content = ''; msg.error = String(e.message || e);
    }
  } finally {
    delete msg.typer; delete msg.typers; state.mention = [];
    save(chatKey(owner.id), msgs.filter(m => !m.live).slice(-200));
    if (state.ctrl === ctrl) { state.ctrl = null; setBusy(false); }
    if (here()) render();
  }
}

function maybeEvent(msgs) {
  const s = state.settings; if (!s.events || isPrivateActive()) return;
  const turns = msgs.filter(m => m.role === 'user' && !m.sys).length;
  if (turns > 0 && turns % Math.max(3, Number(s.eventEvery) || 8) === 0) msgs.push({ role: 'event' });
}

const NEG_RE = /\b(tidak|nggak|enggak|engga|ngga|gak|ga|jangan|nanti|belum|no|nope|not)\b/i;
const YES_RE = /\b(ya|iya|yap|yup|yes|yeah|boleh|mau|ok|oke|okay|gas|yuk|ayo|sambungkan|sambungin|sambung|hubungkan|connect|sure)\b/i;
const touchTime = () => { try { localStorage.setItem(timeKey(state.cur.id), String(Date.now())); } catch { /* abaikan */ } };

/* ---- anggota ruang ---- */
function addGuest(id) {
  if (!id || id === state.cur.id || state.room.includes(id)) return false;
  state.room.push(id); saveRoom();
  state.messages.push({ role: 'join', who: id });
  renderRoomBar();
  return true;
}
function inviteManual(id) {
  const s = byId.get(id); if (!s) return;
  if (state.busy) return toast('Tunggu balasan selesai dulu.');
  if (members().length >= maxRoom()) return toast(`Ruang sudah penuh (maks ${maxRoom()} karakter).`);
  if (!addGuest(id)) return;
  persist(); touchTime(); render(); runAI({ typer: id });
}
function kick(id) {
  const s = byId.get(id); if (!s || !state.room.includes(id)) return;
  if (state.busy) return toast('Tunggu balasan selesai dulu.');
  if (state.private?.with === id) endPrivate(true);
  state.room = state.room.filter(x => x !== id); saveRoom();
  state.messages.push({ role: 'leave', who: id });
  persist(); renderRoomBar(); render(); renderPrivateBar();
}

function send(text, opts = {}) {
  text = String(text || '').trim();
  if (!text || state.busy) return;
  const last = state.messages[state.messages.length - 1];
  let joinId = null;
  const pend = pendingInvite(last);
  if (pend) {          // pesan ini menjawab tawaran sambungan
    const yes = opts.accept === true || (opts.decline !== true && !NEG_RE.test(text) && YES_RE.test(text));
    last.inv = yes ? 'yes' : 'no'; last.invWho = pend.id;
    if (yes) joinId = pend.id;
  }
  const msg = { role: 'user', content: text };
  const rp = opts.reply || state.reply;
  if (rp) msg.reply = rp;
  if (state.reply) { state.reply = null; renderReplyBar(); }

  // ---- deteksi mulai / selesai mode berdua ----
  const mem = members();
  const inGroup = mem.length > 1;
  let justStartedPrivate = false;

  if (isPrivateActive()) {
    // sudah berdua: cek apakah Sensei mengakhiri
    if (PRIV_END_RE.test(text) || (rp && rp.who && rp.who !== state.private.with)) {
      endPrivate(false);
      msg.priv = false;
    } else {
      msg.priv = true;
      msg.privWith = state.private.with;
    }
  } else if (inGroup && PRIV_START_RE.test(text)) {
    // minta berdua: tentukan partner (dari reply, mention, atau host)
    let partnerId = null;
    if (rp && rp.who) partnerId = rp.who;
    else {
      const names = mentionedNames(text);
      const hit = mem.find(s => names.some(n => norm(n) === norm(s.name) || norm(n) === norm(promptName(s))));
      if (hit) partnerId = hit.id;
      else if (mem.length === 2) partnerId = mem.find(s => s.id !== state.cur.id)?.id || state.cur.id;
      else partnerId = state.cur.id; // default host
    }
    if (partnerId && startPrivate(partnerId)) {
      justStartedPrivate = true;
      msg.priv = true;
      msg.privWith = partnerId;
    }
  }

  state.messages.push(msg);

  // saat baru mulai berdua: karakter lain langsung undur (pesan sistem), tanpa typing rame
  if (justStartedPrivate) {
    const partner = privatePartner();
    const others = mem.filter(s => s.id !== partner?.id).map(s => s.name);
    if (others.length && partner) {
      state.messages.push({
        role: 'user',
        sys: true,
        content: `(Catatan sistem: ${others.join(', ')} mengalah dan undur diri sejenak. Sensei sedang ngobrol berdua dengan ${partner.name}. Mereka tidak akan mendengar atau tahu isi percakapan ini.)`
      });
    }
  }

  if (joinId) addGuest(joinId);
  state.mention = mentionedNames(text);
  persist(); touchTime();
  micCancel();                       // hentikan dikte & buang hasil sisa, supaya pesan berikutnya benar-benar baru
  $('#input').value = ''; autosize(); syncSend();
  if (joinId || justStartedPrivate) render();
  renderPrivateBar();

  // typing:
  // - mode berdua → HANYA partner (tidak pernah multi)
  // - reply ke 1 karakter → hanya dia
  // - join → dia
  // - tanpa reply di grup → semua bareng
  let aiOpts = {};
  if (isPrivateActive()) {
    aiOpts.typer = state.private.with;
  } else if (joinId) {
    aiOpts.typer = joinId;
  } else if (rp && rp.who) {
    aiOpts.typer = rp.who;
  } else if (mem.length > 1) {
    aiOpts.typers = mem.map(s => s.id);
  }
  runAI(aiOpts);
}

function greeting(s) {
  const en = state.settings.lang === 'en';
  if (s.id === 'arisu') {
    return { role: 'assistant', content: en
      ? 'Ba-ba-ba-bam! Bam bam!\nI leveled up! I am much stronger than before.\n[[PILIH: I-Is that so? | Congratulations on leveling up!]]'
      : 'Ba-ba-ba-bam! Bam bam!\nAku naik level! Aku jauh lebih kuat dari sebelumnya.\n[[PILIH: E-Eh, benarkah? | Selamat sudah naik level!]]' };
  }
  return { role: 'assistant', content: en
    ? `Oh, Sensei. Did you want to talk about something?\n[[PILIH: Hi, ${s.name}! | What are you up to?]]`
    : `Oh, Sensei. Ada yang ingin dibicarakan?\n[[PILIH: Halo, ${s.name}! | Lagi ngapain?]]` };
}

function resetChat() {
  if (state.ctrl) state.ctrl.abort();
  state.messages = [greeting(state.cur)];
  state.room = []; saveRoom(); state.reply = null; state.private = null; closeMenu();
  persist(); render(); renderRoomBar(); renderReplyBar(); renderPrivateBar();
}

/* ============ Relationship Story ============ */
let storyCtrl = null;
function renderStory(txt) {
  const nm = state.cur?.name || '';
  const body = $('#storyBody');
  const lines = String(txt).replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').split(/\n+/).map(l => l.trim()).filter(Boolean);
  const re = new RegExp('^(' + escRe(nm) + '|Aris|Arisu|Sensei)\\s*:\\s*(.*)$', 'i');
  body.innerHTML = lines.map(l => {
    const d = l.match(re);
    if (d) return `<p><span class="who ${/^sensei$/i.test(d[1]) ? '' : 'aris'}">${esc(d[1][0].toUpperCase() + d[1].slice(1))}</span><br>${esc(d[2])}</p>`;
    return `<p class="nar">${esc(l)}</p>`;
  }).join('') || '<p class="nar">…</p>';
}
async function openStory() {
  const nm = state.cur.name;
  $('#storyTitle').textContent = `${nm}'s Relationship Story`;
  const dlg = $('#story'); dlg.showModal();
  $('#storyBody').innerHTML = `<p class="nar">${esc(nm)} sedang menyiapkan ceritanya…</p>`;
  if (storyCtrl) storyCtrl.abort();
  const ctrl = storyCtrl = new AbortController();
  const ro = rosterNow();
  const recent = state.messages.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.error)).slice(-10)
    .map(m => (m.role === 'user' ? 'Sensei: ' + m.content : parseAI(m.content, state.cur, ro).items.map(x => x.who.name + ': ' + x.text).join('\n'))).join('\n');
  const msgs = [
    { role: 'system', content: PERSONA.buildStory(personaStudent(), state.settings.lang) },
    { role: 'user', content: `Percakapan MomoTalk terakhir:\n${recent || '(belum ada)'}\n\nTulis Relationship Story-nya sekarang.` },
  ];
  try { await streamChat(msgs, renderStory, ctrl.signal); }
  catch (e) { if (e.name !== 'AbortError') $('#storyBody').innerHTML = `<p class="nar">${esc(e.message || e)}</p>`; }
}

/* ============ daftar murid ============ */
function lastPreview(s) {
  const m = chatOf(s.id), ro = rosterIds(s, m, load(roomKey(s.id), []));
  for (let i = m.length - 1; i >= 0; i--) {
    const x = m[i];
    if (x.role === 'user') return 'Sensei: ' + x.content;
    if (x.role === 'assistant' && !x.error) { const it = parseAI(x.content, s, ro).items; if (it.length) return (it[0].who.id !== s.id ? it[0].who.name + ': ' : '') + it[0].text; }
  }
  return '';
}
const turnsOf = s => chatOf(s.id).filter(m => m.role === 'user').length;
const lastTime = s => { try { return Number(localStorage.getItem(timeKey(s.id))) || 0; } catch { return 0; } };

function renderList() {
  const q = $('#q').value.trim().toLowerCase();
  let rows = LIST.filter(s => !q || s.title.toLowerCase().includes(q) || (s.det?.fullName || '').toLowerCase().includes(q) || (s.det?.school || '').toLowerCase().includes(q));
  if ($('#sortBy').value === 'recent') rows = rows.slice().sort((a, b) => lastTime(b) - lastTime(a) || a.title.localeCompare(b.title));
  $('#cnt').textContent = `(${rows.length})`;
  $('#students').innerHTML = rows.map(s => {
    const p = lastPreview(s) || [s.det?.school, s.det?.role].filter(Boolean).join(' · ');
    return `<div class="st-row" data-id="${esc(s.id)}" role="button" tabindex="0">${avImg(s, 'av', 128)}<div class="meta"><div class="n">${esc(s.title)}</div><div class="p">${esc(p)}</div></div><div class="heart" title="Peringkat hubungan">${HEART}<b>${Math.floor(turnsOf(s) / 5)}</b></div></div>`;
  }).join('') || '<div class="empty">Tidak ada murid yang cocok.</div>';
}

/* ============ tab: profil, trivia, gallery ============ */
const importHint = `<div class="hint">Data lengkap murid ini belum diimpor. Rekam HAR halaman wikinya di Chrome (sampai halaman termuat), lalu jalankan <code>python tools/import_har.py file.har</code>.</div>`;

function renderProfil(s) {
  const d = s.det;
  const prof = d?.images?.['Profile Image']?.[0]?.url || s.conv?.profile;
  const rows = d ? [['Nama lengkap', [d.fullName, d.nameJP].filter(Boolean).join(' · ')], ['Sekolah', d.school], ['Peran', d.role], ['Kelas tempur', d.combatClass],
    ['Damage', d.damageType], ['Armor', d.armorType], ['Usia', d.age], ['Ulang tahun', d.birthday], ['Tinggi', d.height], ['Hobi', d.hobbies],
    ['Desainer', d.designer], ['Ilustrator', d.illustrator], ['Pengisi suara', d.voice], ['Rilis JP', d.releaseJP], ['Rilis Global', d.releaseGL]].filter(r => r[1]) : [];
  const stars = d?.rarity ? '★'.repeat(d.rarity) : '';
  $('#pProfil').innerHTML =
    `<div class="pf-top">${imgTag(chain(prof, 266), 'pf-photo', s.name)}<div class="pf-id"><h2>${esc(s.name)}</h2>` +
    `<div class="sub">${esc([d?.fullName, d?.nameJP].filter(Boolean).join(' · '))}</div>${stars ? `<div class="stars">${stars}</div>` : ''}</div></div>` +
    (rows.length ? `<div class="kv">${rows.map(r => `<div class="k">${esc(r[0])}</div><div>${esc(r[1])}</div>`).join('')}</div>` : '') +
    (d?.lead ? `<div class="sec-h">Tentang</div><p class="txt">${esc(d.lead)}</p>` : '') +
    (d?.intro && d.intro !== d.lead ? `<div class="sec-h">Perkenalan resmi</div><p class="txt">${esc(d.intro)}</p>` : '') +
    (d?.relationships?.length ? `<div class="sec-h">Hubungan</div>${d.relationships.map(r => `<div class="rel">${esc(r)}</div>`).join('')}` : '') +
    (d?.exSkill?.name ? `<div class="sec-h">EX Skill</div><div class="rel"><b>${esc(d.exSkill.name)}</b>${d.exSkill.nameJP ? ' · ' + esc(d.exSkill.nameJP) : ''}${d.exSkill.cost ? ' · Cost ' + esc(d.exSkill.cost) : ''}<br>${esc(d.exSkill.desc || '')}</div>` : '') +
    (d?.weapon?.name ? `<div class="sec-h">Senjata unik</div><div class="rel"><b>${esc(d.weapon.name)}</b><br>${esc(d.weapon.desc || '')}</div>` : '') +
    (d?.stats ? `<div class="sec-h">Statistik (Lv.1 / Lv.100)</div><div class="kv">${Object.entries(d.stats).map(([k, v]) => `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>` : '') +
    (d ? '' : importHint);
}

function renderTrivia(s) {
  const d = s.det, st = s.story;
  const ul = (arr, cls = '') => `<ul class="tv ${cls}">${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  let h = '';
  if (d?.trivia?.length) h += `<div class="sec-h">Trivia</div>${ul(d.trivia)}`;
  if (st?.main?.length) h += `<div class="sec-h">Cerita utama (Main Story)</div>${ul(st.main)}`;
  if (st?.relationship?.length) h += `<div class="sec-h">Relationship Story</div>${ul(st.relationship, 'pink')}`;
  if (st?.event?.length) h += `<div class="sec-h">Cerita event</div>${ul(st.event)}`;
  if (st?.other) h += `<div class="sec-h">Cerita grup lain</div><p class="txt">${esc(st.other)}</p>`;
  if (st?.note) h += `<div class="hint">${esc(st.note)}</div>`;
  if (d) {
    const facts = [d.school && `Bersekolah di ${d.school}.`, d.birthday && `Ulang tahun: ${d.birthday}.`, d.height && `Tinggi badan ${d.height}.`,
      d.hobbies && `Hobi: ${d.hobbies}.`, d.voice && `Pengisi suara: ${d.voice}.`, d.designer && `Desainer karakter: ${d.designer}.`,
      d.releaseGL && `Rilis di server Global pada ${d.releaseGL}.`].filter(Boolean);
    if (!d.trivia?.length && facts.length) h = `<div class="sec-h">Fakta singkat</div>${ul(facts)}` + h;
    if (d.background && d.background !== d.intro) h += `<div class="sec-h">Latar belakang</div><p class="txt">${esc(d.background)}</p>`;
    if (d.weapon?.name) h += `<div class="sec-h">Senjata unik</div><p class="txt"><b>${esc(d.weapon.name)}</b>. ${esc(d.weapon.desc || '')}</p>`;
    if (!st) h += `<div class="hint">Cerita (Main Story, Relationship Story, event) murid ini belum diimpor dari halaman <b>/story</b>-nya.</div>`;
  }
  $('#pTrivia').innerHTML = h || `<div class="empty">Belum ada data trivia/cerita untuk ${esc(s.name)}.</div>${importHint.replace('halaman wikinya', 'halaman wikinya dan halaman <b>/story</b>-nya')}`;
}

let galTab = 'sprites';
function renderGallery(s) {
  const d = s.det;
  const sprites = d?.sprites?.length ? d.sprites : (s.conv ? [{ url: s.conv.sprite, label: s.name }] : []);
  const misc = d?.misc?.length ? d.misc : (s.conv ? [{ url: s.conv.lobby, label: 'Memorial Lobby ' + s.name }] : []);
  const videos = d?.videos || [];
  const tile = (it, wide) => `<figure class="tile ${wide ? 'wide' : ''}" data-full="${esc(it.url)}" data-cap="${esc(it.label)}">${imgTag(chain(it.url, wide ? 320 : 240), '', it.label)}<figcaption>${esc(it.label)}</figcaption></figure>`;
  let body = '';
  if (galTab === 'sprites') body = sprites.length ? `<div class="grid">${sprites.map(x => tile(x, false)).join('')}</div>` : '<div class="empty">Belum ada sprite.</div>';
  if (galTab === 'video') body = videos.length
    ? videos.map(v => `<div class="vid"><video controls preload="none" playsinline ${v.poster ? `poster="${esc(v.poster)}"` : ''} src="${esc(v.url)}" data-u="${esc(v.url)}"></video><div class="cap">${esc(v.label)}</div></div>`).join('')
    : `<div class="empty">Belum ada video untuk ${esc(s.name)}.</div>${d ? '' : importHint}`;
  if (galTab === 'lain') body = misc.length ? `<div class="grid">${misc.map(x => tile(x, true)).join('')}</div>` : '<div class="empty">Belum ada gambar lain.</div>';
  $('#pGallery').innerHTML =
    `<div class="pills">${[['sprites', `Sprites (${sprites.length})`], ['video', `Video (${videos.length})`], ['lain', `Lainnya (${misc.length})`]]
      .map(([k, l]) => `<button type="button" data-gal="${k}" class="${k === galTab ? 'on' : ''}">${l}</button>`).join('')}</div>` +
    body + (d ? '' : (galTab === 'video' ? '' : importHint));
}

function showTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const map = { chat: '#pChat', profil: '#pProfil', trivia: '#pTrivia', gallery: '#pGallery' };
  Object.entries(map).forEach(([k, sel]) => ($(sel).hidden = k !== tab));
  $('#btnReset').hidden = tab !== 'chat';
  const s = state.cur; if (!s) return;
  if (tab === 'profil') renderProfil(s);
  if (tab === 'trivia') renderTrivia(s);
  if (tab === 'gallery') renderGallery(s);
  if (tab === 'chat') requestAnimationFrame(() => toBottom(false));
}

/* ============ navigasi (hash: #/id atau #/id/tab) ============ */
function route() {
  const m = location.hash.match(/^#\/([^/]+)(?:\/(\w+))?/);
  const s = m && byId.get(decodeURIComponent(m[1]));
  if (!s) {
    state.cur = null;
    $('#vList').hidden = false; $('#vStudent').hidden = true;
    $('#btnBack').hidden = true; $('#btnReset').hidden = true; $('#hTitle').textContent = 'MomoTalk';
    document.title = 'MomoTalk';
    renderList();
    return;
  }
  if (state.cur !== s) {
    if (state.ctrl) state.ctrl.abort();
    state.cur = s;
    state.room = load(roomKey(s.id), []).filter(id => id !== s.id && byId.has(id)).slice(0, 3);
    state.reply = null; state.private = null; closeMenu();
    state.messages = chatOf(s.id).filter(x => !x.live);
    if (!state.messages.length) { state.messages = [greeting(s)]; persist(); }
    galTab = 'sprites';
    setBusy(false);
    render(); renderRoomBar(); renderReplyBar(); renderPrivateBar();
  }
  $('#vList').hidden = true; $('#vStudent').hidden = false;
  $('#btnBack').hidden = false;
  updateHeaderTitle();
  showTab(['chat', 'profil', 'trivia', 'gallery'].includes(m[2]) ? m[2] : 'chat');
}
const hashFor = (id, tab) => '#/' + encodeURIComponent(id) + (tab && tab !== 'chat' ? '/' + tab : '');
const go = (id, tab) => { location.hash = hashFor(id, tab); };
// pindah tab tidak menambah riwayat, supaya tombol Kembali langsung ke daftar murid
const goTab = (id, tab) => { history.replaceState(null, '', hashFor(id, tab)); route(); };

/* ============ pengaturan & foto ============ */
function openSettings() {
  const s = state.settings, c = state.cur;
  $('#setLang').value = s.lang; $('#setModel').value = s.model; $('#setModel').placeholder = state.server.model || 'Akunfree';
  $('#setTemp').value = s.temperature; $('#tempVal').textContent = s.temperature;
  $('#setEvents').checked = !!s.events; $('#setExtra').value = s.extra; $('#setPass').value = s.password;
  $('#setMicLang').value = s.micLang || 'id-ID'; $('#setMicAuto').checked = !!s.micAuto;
  $('#setInvites').checked = s.invites !== false; $('#setMaxRoom').value = String(maxRoom()); $('#sessId').textContent = SID.slice(0, 8);
  $('#avRow').hidden = !c; $('#personaBox').hidden = !c;
  if (c) {
    $('#avPreview').outerHTML = imgTag(avatarUrls(c, 128), 'av big', c.name, 'id="avPreview"');
    $('#personaView').value = systemPrompt();
  }
  $('#settings').showModal();
}
function saveSettings() {
  const s = state.settings;
  s.lang = $('#setLang').value; s.model = $('#setModel').value.trim();
  s.temperature = Number($('#setTemp').value); s.events = $('#setEvents').checked;
  s.extra = $('#setExtra').value.trim(); s.password = $('#setPass').value;
  s.micLang = $('#setMicLang').value; s.micAuto = $('#setMicAuto').checked;
  s.invites = $('#setInvites').checked; s.maxRoom = Number($('#setMaxRoom').value) || 3;
  save(LS_SET, s);
  if (state.cur) renderRoomBar();
  toast('Pengaturan disimpan');
}
function resizeAvatar(file) {
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const n = 192, c = document.createElement('canvas'); c.width = c.height = n;
      const side = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, n, n);
      URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('Gambar tidak bisa dibaca')); };
    img.src = url;
  });
}

/* ============ event & init ============ */
function autosize() {
  const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px';
}
const coarse = matchMedia('(pointer: coarse)').matches;

$('#composer').addEventListener('submit', e => { e.preventDefault(); const t = $('#input').value; micCancel(); send(t); });
$('#input').addEventListener('input', () => { autosize(); syncSend(); });
$('#input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); }
});
$('#btnStop').addEventListener('click', () => state.ctrl && state.ctrl.abort());
$('#btnReset').addEventListener('click', () => { if (confirm(`Mulai ulang percakapan dengan ${state.cur.name}? Riwayat chat murid ini akan dihapus.`)) resetChat(); });
$('#btnBack').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = ''; });
$('#btnSettings').addEventListener('click', openSettings);
$('#setTemp').addEventListener('input', e => ($('#tempVal').textContent = e.target.value));
$('#settings').addEventListener('close', () => { if ($('#settings').returnValue === 'save') saveSettings(); $('#settings').returnValue = ''; });
$('#avFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f || !state.cur) return;
  try { const a = await resizeAvatar(f); save(avKey(state.cur.id), a); $('#avPreview').outerHTML = imgTag([a], 'av big', state.cur.name, 'id="avPreview"'); render(false); toast('Foto diganti'); }
  catch (err) { toast(err.message); }
});
$('#avReset').addEventListener('click', () => { if (!state.cur) return; try { localStorage.removeItem(avKey(state.cur.id)); } catch {} $('#avPreview').outerHTML = imgTag(avatarUrls(state.cur, 128), 'av big', state.cur.name, 'id="avPreview"'); render(false); toast('Memakai foto wiki'); });
$('#storyClose').addEventListener('click', () => { if (storyCtrl) storyCtrl.abort(); $('#story').close(); });
$('#q').addEventListener('input', renderList);
$('#sortBy').addEventListener('change', renderList);
$('#lightbox').addEventListener('click', () => $('#lightbox').close());
window.addEventListener('hashchange', route);

$('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b && state.cur) goTab(state.cur.id, b.dataset.tab); });

/* ---- tahan pesan karakter: balas / minta tanggapan karakter lain / sambungkan ---- */
const menu = $('#msgMenu');
let menuCtx = null, menuLock = 0, lpTimer = null, lpPos = null;
function closeMenu() {
  menu.hidden = true; menuCtx = null;
  list.querySelectorAll('.bub.sel').forEach(b => b.classList.remove('sel'));
}
function openMenu(b) {
  const mi = Number(b.dataset.mi), li = Number(b.dataset.li), m = state.messages[mi];
  if (!m || state.tab !== 'chat') return;
  const it = parseAI(m.content, state.cur, rosterNow()).items[li];
  if (!it) return;
  if (menuCtx && menuCtx.mi === mi && menuCtx.li === li) return;
  closeMenu();
  menuCtx = { mi, li, who: it.who, text: it.text };
  b.classList.add('sel');
  const mem = members(), others = mem.filter(x => x.id !== it.who.id);
  const btn = (act, label) => `<button type="button" data-mm="${esc(act)}">${label}</button>`;
  let h = btn('reply', `Balas ${esc(it.who.name)}`);
  if (!state.busy) {
    others.forEach(o => { h += btn('ask:' + o.id, `Minta ${esc(o.name)} menanggapi`); });
    if (mem.length < maxRoom()) h += btn('invite', 'Sambungkan karakter lain…');
  }
  h += btn('copy', 'Salin pesan');
  menu.innerHTML = h; menu.hidden = false; menuLock = Date.now() + 700;
  const r = b.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
  const x = Math.min(Math.max(8, r.left), innerWidth - mw - 8);
  let y = r.bottom + 6; if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  try { navigator.vibrate && navigator.vibrate(12); } catch { /* abaikan */ }
}
function menuAct(act) {
  const c = menuCtx; closeMenu(); if (!c) return;
  if (act === 'reply') return setReply(c.who, c.text);
  if (act === 'invite') return openPicker();
  if (act === 'copy') {
    const done = () => toast('Pesan disalin');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(c.text).then(done, () => toast('Tidak bisa menyalin'));
    else toast('Tidak bisa menyalin');
    return;
  }
  if (act.startsWith('ask:')) {
    const o = byId.get(act.slice(4)); if (!o || state.busy) return;
    const en = state.settings.lang === 'en';
    send(en ? `${o.name}, what do you think about this?` : `${o.name}, menurutmu gimana soal ini?`, { reply: { who: c.who.id, name: c.who.name, text: c.text.slice(0, 140) } });
  }
}
const lpCancel = () => { clearTimeout(lpTimer); lpTimer = null; };
list.addEventListener('pointerdown', e => {
  const b = e.target.closest('.row.ai .bub[data-mi]');
  if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
  lpCancel(); lpPos = [e.clientX, e.clientY];
  lpTimer = setTimeout(() => { lpTimer = null; openMenu(b); }, 450);
});
list.addEventListener('pointermove', e => { if (lpTimer && lpPos && Math.hypot(e.clientX - lpPos[0], e.clientY - lpPos[1]) > 10) lpCancel(); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => list.addEventListener(t, lpCancel));
document.addEventListener('pointerup', () => { if (!menu.hidden) menuLock = Math.max(menuLock, Date.now() + 350); });
list.addEventListener('contextmenu', e => { const b = e.target.closest('.row.ai .bub[data-mi]'); if (b) { e.preventDefault(); lpCancel(); openMenu(b); } });
scroller.addEventListener('scroll', () => { if (!menu.hidden && Date.now() > menuLock) closeMenu(); }, { passive: true });

/* ---- pilih murid untuk disambungkan ---- */
function renderPicker() {
  const q = norm($('#pkQ').value), taken = new Set(members().map(x => x.id));
  const rows = LIST.filter(s => !taken.has(s.id) && (!q || norm(s.title).includes(q) || norm(s.det?.fullName).includes(q) || norm(s.det?.school).includes(q)));
  $('#pkList').innerHTML = rows.map(s => `<div class="pk-row" data-pick="${esc(s.id)}" role="button" tabindex="0">${avImg(s, 'av', 96)}<div class="meta"><div class="n">${esc(s.title)}</div><div class="p">${esc([s.det?.school, s.det?.role].filter(Boolean).join(' · '))}</div></div></div>`).join('') || '<div class="empty">Tidak ada murid yang cocok.</div>';
}
function openPicker() {
  if (state.busy) return toast('Tunggu balasan selesai dulu.');
  if (members().length >= maxRoom()) return toast(`Ruang sudah penuh (maks ${maxRoom()} karakter). Keluarkan salah satu dulu.`);
  $('#pkQ').value = ''; renderPicker(); $('#picker').showModal();
}
$('#pkQ').addEventListener('input', renderPicker);
$('#pkClose').addEventListener('click', () => $('#picker').close());

document.addEventListener('click', e => {
  if (!menu.hidden && Date.now() > menuLock && !e.target.closest('#msgMenu')) closeMenu();
  const mm = e.target.closest('[data-mm]');
  if (mm) return menuAct(mm.dataset.mm);
  if (e.target.closest('#btnInvite')) return openPicker();
  const kk = e.target.closest('[data-kick]');
  if (kk) { const s = byId.get(kk.dataset.kick); if (s && confirm(`Keluarkan ${s.name} dari ruang obrolan ini?`)) kick(s.id); return; }
  if (e.target.closest('[data-replyx]')) { state.reply = null; return renderReplyBar(); }
  if (e.target.closest('[data-privend]')) {
    if (state.busy) return toast('Tunggu balasan selesai dulu.');
    if (endPrivate(false)) {
      persist(); renderPrivateBar(); render();
      // biar karakter lain sempat "kembali" tanpa tahu isi
      runAI({ typers: members().map(s => s.id) });
    }
    return;
  }
  const pk = e.target.closest('[data-pick]');
  if (pk) { $('#picker').close(); return inviteManual(pk.dataset.pick); }
  const iv = e.target.closest('[data-inv]');
  if (iv) {
    const s = pendingInvite(state.messages[state.messages.length - 1]); if (!s) return;
    const en = state.settings.lang === 'en', yes = iv.dataset.inv === 'yes';
    return send(yes ? (en ? `Yes, please connect ${s.name}!` : `Boleh, sambungkan ${s.name} ya!`) : (en ? 'Not now, thanks.' : 'Nggak usah dulu, makasih.'), yes ? { accept: true } : { decline: true });
  }
  const row = e.target.closest('.st-row');
  if (row) return go(row.dataset.id);
  const g = e.target.closest('[data-gal]');
  if (g) { galTab = g.dataset.gal; return renderGallery(state.cur); }
  const tl = e.target.closest('.tile');
  if (tl) {
    const lb = $('#lightbox');
    $('#lbImg').outerHTML = imgTag([tl.dataset.full, proxy(tl.dataset.full)], '', tl.dataset.cap, 'id="lbImg"');
    $('#lbCap').textContent = tl.dataset.cap; lb.showModal(); return;
  }
  const c = e.target.closest('[data-choice]');
  if (c) {
    const last = state.messages[state.messages.length - 1];
    const ch = parseAI(last && last.content).choices[Number(c.dataset.choice)];
    if (ch) send(ch);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'story') openStory();
  if (a.dataset.act === 'retry' && !state.busy) {
    while (state.messages.length && state.messages[state.messages.length - 1].error) state.messages.pop();
    runAI();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !menu.hidden) closeMenu();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('st-row')) { e.preventDefault(); go(e.target.dataset.id); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('pk-row')) { e.preventDefault(); $('#picker').close(); inviteManual(e.target.dataset.pick); }
});

/* ============ sesi: ekspor / impor / hapus ============ */
const sessionKeys = () => { const r = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(NS)) r.push(k); } return r; };
$('#sessExport').addEventListener('click', () => {
  const data = {}; sessionKeys().forEach(k => { data[k.slice(NS.length)] = localStorage.getItem(k); });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: 'momotalk', v: 1, data })], { type: 'application/json' }));
  a.download = `momotalk-sesi-${SID.slice(0, 8)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#sessImport').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'momotalk' || typeof j.data !== 'object') throw 0;
    if (!confirm('Ganti semua chat dan pengaturan di sesi ini dengan isi file?')) return;
    sessionKeys().forEach(k => localStorage.removeItem(k));
    Object.entries(j.data).forEach(([k, v]) => { if (typeof v === 'string' && /^[\w:.-]{1,80}$/.test(k)) localStorage.setItem(NS + k, v); });
    localStorage.setItem(NS + 'migrated', '1'); location.reload();
  } catch { toast('File sesi tidak valid'); }
});
$('#sessWipe').addEventListener('click', () => {
  if (!confirm('Hapus SEMUA chat, foto, dan pengaturan di browser ini lalu mulai sesi baru? Tidak bisa dibatalkan.')) return;
  try { sessionKeys().forEach(k => localStorage.removeItem(k)); localStorage.removeItem(SID_KEY); } catch { /* abaikan */ }
  location.reload();
});

/* ============ mikrofon (dikte suara -> kotak pesan) ============ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const MIC_ERR = {
  'not-allowed': 'Izin mikrofon ditolak. Aktifkan lewat ikon gembok di address bar, lalu coba lagi.',
  'service-not-allowed': 'Izin mikrofon ditolak. Aktifkan lewat ikon gembok di address bar, lalu coba lagi.',
  'audio-capture': 'Mikrofon tidak ditemukan.', 'network': 'Pengenalan suara butuh koneksi internet.',
  'language-not-supported': 'Bahasa mikrofon ini tidak didukung browser.',
};
const mic = { rec: null, on: false, gen: 0 };   // gen = nomor sesi dikte; hasil dari sesi lama diabaikan
function setMicUI(on) { const b = $('#btnMic'); b.classList.toggle('rec', on); b.setAttribute('aria-pressed', on); b.title = on ? 'Berhenti' : 'Bicara'; }
function micStop() { try { mic.rec && mic.rec.stop(); } catch { /* abaikan */ } }
// Batalkan dikte TANPA menunggu hasil terakhir: dipakai saat kirim pesan / pindah chat,
// supaya teks lama tidak ditulis balik ke kotak pesan (dan tidak terkirim dua kali).
function micCancel() {
  mic.gen++;
  const r = mic.rec; mic.rec = null; mic.on = false; setMicUI(false);
  if (r) { r.onresult = r.onerror = r.onend = r.onstart = null; try { r.abort(); } catch { /* abaikan */ } }
}
function micToggle() {
  if (mic.on) return micStop();
  if (state.busy) return;
  if (!window.isSecureContext) return toast('Mikrofon hanya jalan lewat HTTPS atau localhost.', 5000);
  const r = new SR(), inp = $('#input'), gen = ++mic.gen;
  mic.rec = r; r.lang = state.settings.micLang || 'id-ID'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  const base = inp.value ? inp.value.replace(/\s+$/, '') + ' ' : '';
  let err = '';
  r.onstart = () => { if (gen !== mic.gen) return; mic.on = true; setMicUI(true); };
  r.onresult = e => {
    if (gen !== mic.gen) return;
    let fin = '', tmp = '';
    for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
    inp.value = base + (fin + tmp).trim(); autosize(); syncSend();
  };
  r.onerror = e => { if (gen !== mic.gen) return; err = e.error; };
  r.onend = () => {
    if (gen !== mic.gen) return;
    mic.on = false; mic.rec = null; setMicUI(false);
    if (err === 'no-speech') toast('Suara tidak terdeteksi');
    else if (err && err !== 'aborted') toast(MIC_ERR[err] || 'Mikrofon error: ' + err, 5000);
    else if (!err && state.settings.micAuto && inp.value.trim() && !state.busy) $('#composer').requestSubmit();
  };
  try { r.start(); } catch { toast('Mikrofon tidak bisa dimulai'); }
}
if (SR) { $('#btnMic').hidden = false; $('#btnMic').addEventListener('click', micToggle); }
window.addEventListener('hashchange', micCancel);

(async function init() {
  await loadData();
  route();
  try {
    const r = await fetch('/api/chat'); const j = await r.json();
    state.server = j;
    if (j.needsPassword && !state.settings.password) toast('Server meminta kata sandi. Isi di Pengaturan.', 5000);
  } catch { /* server belum siap */ }
})();
})();
