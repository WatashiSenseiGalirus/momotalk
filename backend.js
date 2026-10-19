// backend.js — Cloudflare Worker: proxy ke 9router lewat URL cloudflared yang selalu berubah.
//
// Alur:  MomoTalk (Vercel /api/chat)  ->  Worker ini  ->  https://xxxx.trycloudflare.com  ->  9router
// URL tunnel dibaca dari url.txt di repo GitHub (diisi oleh tunnel_push.sh), jadi tiap URL ganti
// Vercel TIDAK perlu diubah. Token GitHub & key 9router cuma ada di Cloudflare.
//
// Environment Variables / Secrets (Cloudflare > Workers > nama-worker > Settings > Variables and Secrets):
//   GITHUB_TOKEN     (Secret)  token GitHub read-only, wajib kalau repo 9router private
//   UPSTREAM_API_KEY (Secret)  API key 9router (kosongkan kalau 9router tidak pakai key)
//   PROXY_SECRET     (Secret)  kunci rahasia buat Vercel -> Worker (karang sendiri, panjang & acak)
//   GH_USER          (Text)    default: WatashiSenseiGalirus
//   GH_REPO          (Text)    default: 9router
//   GH_BRANCH        (Text)    default: main
//   GH_FILE          (Text)    default: url.txt

const TTL = 30_000;                 // cache URL tunnel 30 dtk (per instance Worker)
let cache = { url: '', at: 0 };

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function getTunnelUrl(env, force = false) {
  if (!force && cache.url && Date.now() - cache.at < TTL) return cache.url;
  const user = env.GH_USER || 'WatashiSenseiGalirus';
  const repo = env.GH_REPO || '9router';
  const branch = env.GH_BRANCH || 'main';
  const file = env.GH_FILE || 'url.txt';
  const headers = { 'User-Agent': 'momotalk-backend', Accept: 'application/vnd.github.raw+json' };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  try {
    const r = await fetch(
      `https://api.github.com/repos/${user}/${repo}/contents/${encodeURIComponent(file)}?ref=${encodeURIComponent(branch)}&t=${Date.now()}`,
      { headers, cf: { cacheTtl: 0, cacheEverything: false } },
    );
    if (r.ok) {
      const raw = ((await r.text()).trim().split(/\s+/)[0] || '').replace(/\/+$/, '');
      if (/^https:\/\//i.test(raw)) { cache = { url: raw, at: Date.now() }; return raw; }
    }
  } catch { /* pakai cache lama */ }
  return cache.url; // bisa '' kalau belum pernah berhasil
}

function authorized(request, env) {
  if (!env.PROXY_SECRET) return true; // tidak disarankan: Worker jadi terbuka untuk umum
  const h = request.headers.get('authorization') || '';
  const bearer = h.replace(/^Bearer\s+/i, '');
  return bearer === env.PROXY_SECRET || request.headers.get('x-proxy-secret') === env.PROXY_SECRET;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
    }
    if (url.pathname === '/health') {
      const t = await getTunnelUrl(env, true);
      return json(t ? 200 : 503, { ok: !!t, tunnel: t || null });
    }
    if (!authorized(request, env)) return json(401, { error: 'Unauthorized' });

    // body dibuffer supaya bisa dikirim ulang kalau tunnel lama sudah mati
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();

    const headers = new Headers(request.headers);
    for (const h of ['host', 'authorization', 'x-proxy-secret', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-ipcountry', 'x-forwarded-for', 'x-real-ip']) headers.delete(h);
    if (env.UPSTREAM_API_KEY) headers.set('Authorization', `Bearer ${env.UPSTREAM_API_KEY}`);

    const send = (base) => fetch(base + url.pathname + url.search, { method: request.method, headers, body, redirect: 'manual' });
    const dead = (s) => [404, 502, 503, 504, 521, 522, 523, 524, 530].includes(s);

    let base = await getTunnelUrl(env);
    if (!base) return json(503, { error: 'url.txt belum bisa dibaca dari repo. Cek GITHUB_TOKEN / nama repo, dan pastikan tunnel_push.sh sudah jalan.' });

    let res;
    try {
      res = await send(base);
      if (dead(res.status)) throw new Error('tunnel mati');
    } catch {
      const fresh = await getTunnelUrl(env, true);
      if (fresh && fresh !== base) {
        try { res = await send(fresh); } catch (e) { return json(502, { error: 'Tunnel tidak bisa dihubungi: ' + (e.message || e) }); }
      } else if (!res) {
        return json(502, { error: 'Tunnel tidak bisa dihubungi. Pastikan 9router dan cloudflared sedang jalan di PC lu.' });
      }
    }

    // teruskan apa adanya (streaming SSE tetap jalan)
    const out = new Headers(res.headers);
    out.set('cache-control', 'no-store');
    out.set('access-control-allow-origin', '*');
    return new Response(res.body, { status: res.status, headers: out });
  },
};
