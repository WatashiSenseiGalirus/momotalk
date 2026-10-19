// Proxy gambar/video wiki (cadangan kalau hotlink langsung diblokir).
// Hanya host static.wikitide.net yang diizinkan, supaya tidak jadi open proxy.
export const config = { maxDuration: 30 };

const ALLOW = new Set(['static.wikitide.net']);

export default async function handler(req, res) {
  let target;
  try {
    const u = new URL(req.url, 'http://localhost').searchParams.get('u') || '';
    target = new URL(u);
  } catch { res.statusCode = 400; return res.end('bad url'); }
  if (target.protocol !== 'https:' || !ALLOW.has(target.hostname) || !target.pathname.startsWith('/bluearchivewiki/')) {
    res.statusCode = 403; return res.end('host tidak diizinkan');
  }
  const headers = { Referer: 'https://bluearchive.wiki/', 'User-Agent': 'Mozilla/5.0 (MomoTalk-Aris-AI)' };
  if (req.headers.range) headers.Range = req.headers.range;
  let up;
  try { up = await fetch(target, { headers }); }
  catch (e) { res.statusCode = 502; return res.end('gagal mengambil: ' + (e.cause?.code || e.message)); }
  res.statusCode = up.status;
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
    const v = up.headers.get(h); if (v) res.setHeader(h, v);
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  if (!up.body) return res.end();
  try {
    const reader = up.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); }
  } catch { /* klien putus */ }
  res.end();
}
