// Proxy ke endpoint OpenAI-compatible (mis. localhost:20128/v1).
// Dipakai oleh Vercel (serverless function) DAN server.js (lokal).
// API key TIDAK pernah dikirim ke browser — cuma ada di environment variable server.

export const config = { maxDuration: 60 };

const env = (k, d = '') => process.env[k] || d;

/* ---- URL AI dinamis: baca url.txt (URL cloudflared) dari repo GitHub, cache 30 dtk.
        Kalau gagal/kosong, jatuh ke AI_BASE_URL. Jadi tiap tunnel ganti URL, Vercel tidak perlu redeploy/ganti env. ---- */
const URL_SOURCE = env('AI_URL_SOURCE', 'https://raw.githubusercontent.com/WatashiSenseiGalirus/9router/main/url.txt');
const URL_TTL = 30000;
let urlCache = { v: '', t: 0 };

async function resolveBase(force = false) {
  const fallback = env('AI_BASE_URL', 'http://localhost:20128/v1').replace(/\/+$/, '');
  if (!URL_SOURCE || URL_SOURCE === 'off') return fallback;
  if (!force && urlCache.v && Date.now() - urlCache.t < URL_TTL) return urlCache.v;
  try {
    const token = env('GITHUB_TOKEN'); // opsional, hanya kalau repo private
    const r = await fetch(URL_SOURCE + (URL_SOURCE.includes('?') ? '&' : '?') + 't=' + Date.now(), {
      headers: { 'Cache-Control': 'no-cache', ...(token ? { Authorization: `token ${token}` } : {}) },
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const raw = (await r.text()).trim().split(/\s+/)[0] || '';
      if (/^https?:\/\//i.test(raw)) {
        const b = raw.replace(/\/+$/, '');
        urlCache = { v: /\/v1$/.test(b) ? b : b + '/v1', t: Date.now() };
        return urlCache.v;
      }
    }
  } catch { /* pakai cache lama / fallback */ }
  return urlCache.v || fallback;
}

/* ---- pembatasan laju per sesi browser (+ per IP) supaya server tidak terbebani.
        Server TIDAK menyimpan chat/isi pesan; hanya hitungan permintaan di memori (hilang saat restart).
        Di Vercel hitungan ini per-instance (best effort). ---- */
const SID_RE = /^[a-zA-Z0-9-]{16,64}$/;
const num = (k, d) => Math.max(1, Number(env(k)) || d);
const LIMITS = { perSession: num('RATE_LIMIT_PER_MIN', 20), perIp: num('RATE_LIMIT_PER_IP_MIN', 60), concurrent: num('MAX_CONCURRENT', 2), bodyKB: num('MAX_BODY_KB', 512) };
const hits = new Map();     // kunci -> timestamp permintaan (60 dtk terakhir)
const active = new Map();   // kunci sesi -> jumlah stream yang sedang jalan
setInterval(() => { const c = Date.now() - 60000; for (const [k, a] of hits) { while (a.length && a[0] < c) a.shift(); if (!a.length) hits.delete(k); } }, 30000).unref?.();

function over(key, max) {
  const now = Date.now(), a = hits.get(key) || [];
  while (a.length && a[0] < now - 60000) a.shift();
  if (a.length >= max) { hits.set(key, a); return Math.max(1, Math.ceil((a[0] + 60000 - now) / 1000)); }
  a.push(now); hits.set(key, a); return 0;
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > LIMITS.bodyKB * 1024) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req, res) {
  let base = await resolveBase();
  const apiKey = env('AI_API_KEY');
  const defaultModel = env('AI_MODEL', 'Akunfree');
  const appPassword = env('APP_PASSWORD');

  // GET = info konfigurasi publik (tanpa rahasia)
  if (req.method === 'GET') {
    return sendJson(res, 200, { model: defaultModel, needsPassword: !!appPassword });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (appPassword && req.headers['x-app-password'] !== appPassword) {
    return sendJson(res, 401, { error: 'Password salah atau belum diisi (Pengaturan).' });
  }

  // identitas sesi: ID acak dari browser + IP; tanpa akun, tanpa penyimpanan
  const sidRaw = String(req.headers['x-session-id'] || '');
  const sid = SID_RE.test(sidRaw) ? sidRaw : 'anon';
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || '?';
  const skey = sid + '|' + ip;
  if (Number(req.headers['content-length']) > LIMITS.bodyKB * 1024) return sendJson(res, 413, { error: 'Pesan terlalu besar.' });
  const wait = over('s:' + skey, sid === 'anon' ? Math.ceil(LIMITS.perSession / 2) : LIMITS.perSession) || over('ip:' + ip, LIMITS.perIp);
  if (wait) { res.setHeader('Retry-After', String(wait)); return sendJson(res, 429, { error: `Terlalu banyak permintaan dari sesi ini. Coba lagi ${wait} detik lagi.` }); }
  if ((active.get(skey) || 0) >= LIMITS.concurrent) return sendJson(res, 429, { error: 'Masih ada balasan yang sedang diproses di sesi ini. Tunggu sebentar.' });
  active.set(skey, (active.get(skey) || 0) + 1);
  let released = false;
  const release = () => { if (released) return; released = true; const n = (active.get(skey) || 1) - 1; if (n > 0) active.set(skey, n); else active.delete(skey); };
  res.on('close', release);

  let body = req.body;
  try {
    if (body === undefined) body = await readBody(req);
    if (typeof body === 'string') body = JSON.parse(body || '{}');
  } catch {
    return sendJson(res, 400, { error: 'Body bukan JSON valid' });
  }
  if (!body || !Array.isArray(body.messages) || !body.messages.length) {
    return sendJson(res, 400, { error: 'messages kosong' });
  }

  const stream = body.stream !== false;
  const payload = {
    model: body.model || defaultModel,
    messages: body.messages,
    stream,
  };
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;

  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });

  const callUpstream = (b) => fetch(`${b}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: ac.signal,
  });

  let upstream;
  try {
    try {
      upstream = await callUpstream(base);
      // tunnel mati / URL lama (530, 502, 404 dari cloudflare) -> ambil url.txt terbaru lalu coba sekali lagi
      if ([502, 503, 504, 521, 522, 523, 524, 530, 404].includes(upstream.status)) throw new Error('retry');
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      const fresh = await resolveBase(true);
      if (fresh !== base || !upstream) { base = fresh; upstream = await callUpstream(base); }
    }
  } catch (e) {
    if (e.name === 'AbortError') return res.end();
    return sendJson(res, 502, {
      error: `Gagal konek ke AI di ${base} — ${e.cause?.code || e.message}. ` +
        'Pastikan 9router + cloudflared lagi jalan dan url.txt di repo 9router sudah ke-update.',
    });
  }

  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    return sendJson(res, upstream.status, { error: t.slice(0, 600) || `Upstream ${upstream.status}` });
  }

  if (!stream) {
    const t = await upstream.text();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(t);
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  try {
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch { /* client putus / abort */ }
  res.end();
}
