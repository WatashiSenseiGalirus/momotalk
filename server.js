// Server lokal tanpa dependency:  node server.js
// Serve folder /public + route /api/chat (handler yang sama dengan Vercel).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env sederhana
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch { /* .env opsional */ }

const { default: chatHandler } = await import('./api/chat.js');
const { default: imgHandler } = await import('./api/img.js');

const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/chat') {
    try { return await chatHandler(req, res); }
    catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ error: String(e.message || e) })); }
  }
  if (url.pathname === '/api/img') {
    try { return await imgHandler(req, res); }
    catch (e) { res.statusCode = 500; return res.end(String(e.message || e)); }
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.statusCode = 403; return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});

const PORT = Number(process.env.PORT) || 3004;
server.listen(PORT, () => {
  console.log(`MomoTalk AI jalan di http://localhost:${PORT}`);
  console.log(`AI upstream: ${process.env.AI_BASE_URL || 'http://localhost:20128/v1'} (model ${process.env.AI_MODEL || 'Akunfree'})`);
});
