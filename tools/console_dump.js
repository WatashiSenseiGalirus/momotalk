// Tempel di Console Chrome saat membuka https://bluearchive.wiki/wiki/Models (sudah lolos Cloudflare).
// Mengunduh file ba_dump.json berisi HTML halaman semua murid + /story. Butuh beberapa menit.
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const get = async p => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch('/wiki/' + encodeURIComponent(p.replace(/ /g, '_')).replace(/%2F/g, '/').replace(/%28/g, '(').replace(/%29/g, ')'), { credentials: 'include' });
      const t = await r.text();
      if (r.ok && !t.includes('Checking your connection') && t.length > 5000) return t;
      await sleep(2000 * (i + 1));
    }
    return null;
  };
  const dump = {};
  const models = await get('Models'); dump['Models'] = models;
  const doc = new DOMParser().parseFromString(models, 'text/html');
  const names = [...doc.querySelectorAll('#mw-content-text a[href^="#"]')]
    .map(a => a.textContent.trim()).filter(t => /^\d+/.test(t)).map(t => t.replace(/^\d+/, ''));
  console.log(names.length, 'murid');
  for (const [i, n] of names.entries()) {
    for (const page of [n, n + '/story']) {
      const h = await get(page); if (h) dump[page] = h; else console.warn('gagal', page);
      await sleep(1200);
    }
    console.log(`${i + 1}/${names.length} ${n}`);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(dump)], { type: 'application/json' }));
  a.download = 'ba_dump.json'; a.click();
})();
