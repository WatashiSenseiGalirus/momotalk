// backend.js — Cloudflare Worker: proxy ke 9router lewat URL cloudflared yang selalu berubah.
//
//   MomoTalk (Vercel /api/chat) -> Worker ini -> https://xxxx.trycloudflare.com -> 9router
//
// Cara ambil URL (real-time, hemat limit GitHub):
//   * Normal: pakai URL yang sudah diingat di memori Worker -> 0 request ke GitHub.
//   * Kalau tunnel mati / URL berubah (530, 502, timeout...): BARU baca url.txt lewat GitHub API
//     (bukan raw.githubusercontent yang di-cache ~5 menit), pakai ETag (balasan 304 tidak makan limit),
//     lalu coba lagi beberapa kali sampai tes.sh selesai nge-push URL baru.
//   * Vercel TIDAK perlu diubah / redeploy tiap URL ganti.
//
// Environment Variables / Secrets (Cloudflare > Workers > nama-worker > Settings > Variables and Secrets):
//   GITHUB_TOKEN     (Secret)  token GitHub read-only (wajib kalau repo 9router private; juga menaikkan limit jadi 5000/jam)
//   UPSTREAM_API_KEY (Secret)  API key 9router
//   PROXY_SECRET     (Secret)  kunci rahasia Vercel -> Worker
//   GH_USER / GH_REPO / GH_BRANCH / GH_FILE (Text, opsional)  default: WatashiSenseiGalirus / 9router / main / url.txt
//   RETRY_MS         (Text, opsional)  jeda tiap percobaan, default "0,2000,3000,4000"

const state = { url: '', etag: '', at: 0, checkedAt: 0 };
const KEEP_MS = 5 * 60_000;   // URL yang diingat dianggap segar 5 menit (insurance; biasanya diganti lewat jalur gagal)
const MIN_GAP = 1_000;        // jarak minimal antar request ke GitHub (anti-spam limit)

const DEAD = new Set([502, 503, 504, 521, 522, 523, 524, 530]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, obj, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*', ...extra } });

// Baca url.txt lewat GitHub API. Mengembalikan URL terbaru (atau yang lama kalau tidak berubah / gagal).
async function refreshUrl(env) {
  if (Date.now() - state.checkedAt < MIN_GAP) return state.url;
  state.checkedAt = Date.now();
  const user = env.GH_USER || 'WatashiSenseiGalirus';
  const repo = env.GH_REPO || '9router';
  const branch = env.GH_BRANCH || 'main';
  const file = env.GH_FILE || 'url.txt';
  const headers = { 'User-Agent': 'momotalk-backend', Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  if (state.etag) headers['If-None-Match'] = state.etag;
  try {
    const r = await fetch(`https://api.github.com/repos/${user}/${repo}/contents/${encodeURIComponent(file)}?ref=${encodeURIComponent(branch)}`, { headers });
    if (r.status === 304) { state.at = Date.now(); return state.url; }
    if (r.ok) {
      const raw = ((await r.text()).trim().split(/\s+/)[0] || '').replace(/\/+$/, '');
      if (/^https:\/\//i.test(raw)) {
        state.url = raw; state.etag = r.headers.get('etag') || ''; state.at = Date.now();
      }
    }
    // 403/429 (limit) atau error lain: diam-diam pakai URL yang sudah diingat
  } catch { /* pakai yang diingat */ }
  return state.url;
}

async function currentUrl(env) {
  if (state.url && Date.now() - state.at < KEEP_MS) return state.url;
  return refreshUrl(env);
}

function authorized(request, env) {
  if (!env.PROXY_SECRET) return true; // tidak disarankan: Worker jadi terbuka untuk umum
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return bearer === env.PROXY_SECRET || request.headers.get('x-proxy-secret') === env.PROXY_SECRET;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    }
    if (url.pathname === '/health') {
      state.checkedAt = 0;
      const t = await refreshUrl(env);
      return json(t ? 200 : 503, { ok: !!t, tunnel_known: !!t, age_s: t ? Math.round((Date.now() - state.at) / 1000) : null });
    }
    if (!authorized(request, env)) return json(401, { error: 'Unauthorized' });

    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    const headers = new Headers(request.headers);
    for (const h of ['host', 'authorization', 'x-proxy-secret', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'x-forwarded-for', 'x-real-ip']) headers.delete(h);
    if (env.UPSTREAM_API_KEY) headers.set('Authorization', `Bearer ${env.UPSTREAM_API_KEY}`);
    const send = (base) => fetch(base + url.pathname + url.search, { method: request.method, headers, body, redirect: 'manual' });

    const delays = String(env.RETRY_MS || '0,2000,3000,4000').split(',').map((n) => Math.max(0, Number(n) || 0));
    let base = await currentUrl(env);
    let lastErr = 'url.txt belum bisa dibaca dari repo (cek GITHUB_TOKEN / nama repo).';

    for (let i = 0; i < delays.length; i++) {
      if (i > 0) await sleep(delays[i]);
      if (!base) { base = await refreshUrl(env); if (!base) continue; }
      try {
        const res = await send(base);
        if (!DEAD.has(res.status)) {
          const out = new Headers(res.headers);
          out.set('cache-control', 'no-store');
          out.set('access-control-allow-origin', '*');
          return new Response(res.body, { status: res.status, headers: out });
        }
        lastErr = `Tunnel tidak merespons (kode ${res.status}). Pastikan tes.sh jalan dan 9router nyala.`;
        try { await res.body?.cancel(); } catch {}
      } catch (e) {
        lastErr = 'Tunnel tidak bisa dihubungi: ' + (e.message || e);
      }
      // tunnel mati / URL berubah -> ambil url.txt terbaru dan ulangi
      state.checkedAt = 0;
      const fresh = await refreshUrl(env);
      if (fresh) base = fresh;
    }
    return json(502, { error: lastErr }, { 'retry-after': '10' });
  },
};
