#!/usr/bin/env python3
"""
Ambil data SEMUA murid langsung dari bluearchive.wiki lewat curl (+ User-Agent),
lalu gabungkan ke public/data/students.json memakai parser import_har.py.

    pip install beautifulsoup4 lxml
    python tools/fetch_wiki.py                 # semua nama dari /wiki/Models
    python tools/fetch_wiki.py Shiroko Hina    # hanya murid tertentu
    python tools/fetch_wiki.py --force         # unduh ulang cache

Halaman disimpan di tools/cache/ (bisa dilanjutkan kalau terputus).
Kalau wiki membalas tantangan Cloudflare ("Checking your connection" / 403 / 503),
curl biasa tidak bisa lewat: pakai cookie browser lewat --cookie "cf_clearance=..."
atau rekam HAR dan jalankan tools/import_har.py.
"""
import sys, os, json, time, subprocess, urllib.parse, importlib.util, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
spec = importlib.util.spec_from_file_location('import_har', os.path.join(HERE, 'import_har.py'))
ih = importlib.util.module_from_spec(spec); spec.loader.exec_module(ih)


def fetch(base, page, cache, force, cookie, delay):
    fn = os.path.join(cache, urllib.parse.quote(page, safe='') + '.html')
    if os.path.exists(fn) and not force and os.path.getsize(fn) > 5000:
        return open(fn, encoding='utf-8').read()
    url = f"{base}/wiki/{urllib.parse.quote(page.replace(' ', '_'), safe='/()_,-')}"
    cmd = ['curl', '-sS', '-L', '-m', '60', '-A', UA, '-H', 'Accept-Language: en-US,en;q=0.9',
           '-H', 'Accept: text/html,application/xhtml+xml', url, '-w', '\n%{http_code}']
    if cookie:
        cmd += ['-H', f'Cookie: {cookie}']
    r = subprocess.run(cmd, capture_output=True, text=True)
    body, _, code = r.stdout.rpartition('\n')
    time.sleep(delay)
    if code != '200' or 'Checking your connection' in body[:3000] or len(body) < 5000:
        print(f'  ! gagal {page}: HTTP {code} {r.stderr.strip()[:80]}')
        return None
    os.makedirs(cache, exist_ok=True)
    open(fn, 'w', encoding='utf-8').write(body)
    return body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='*')
    ap.add_argument('--base', default='https://bluearchive.wiki')
    ap.add_argument('--cookie', default='')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--delay', type=float, default=1.5)
    a = ap.parse_args()
    cache = os.path.join(HERE, 'cache')
    db = {'students': {}, 'names': [], 'story': {}}
    if os.path.exists(ih.OUT):
        db.update(json.load(open(ih.OUT, encoding='utf-8')))
    html = fetch(a.base, 'Models', cache, a.force, a.cookie, a.delay)
    if html:
        db['names'] = ih.parse_models(html)
    names = a.names or db['names']
    if not names:
        sys.exit('Daftar nama kosong: /wiki/Models tidak terambil.')
    ok = 0
    for i, n in enumerate(names, 1):
        print(f'[{i}/{len(names)}] {n}')
        h = fetch(a.base, n, cache, a.force, a.cookie, a.delay)
        if not h:
            continue
        st = ih.parse_student(h, n)
        if not st:
            print('  ! bukan halaman murid'); continue
        st['id'] = ih.slugify(n)
        db['students'][n] = st; ok += 1
        s = fetch(a.base, n + '/story', cache, a.force, a.cookie, a.delay)
        if s:
            db['story'][n] = ih.parse_story(s)
        # varian (Dress, Swimsuit, dst.) yang tertaut di halaman murid
        for v in st.get('variants', []):
            vh = fetch(a.base, v, cache, a.force, a.cookie, a.delay)
            vs = vh and ih.parse_student(vh, v)
            if vs:
                vs['id'] = ih.slugify(v); db['students'][v] = vs
    db['conv'] = {}
    for n in db['names']:
        u = n.replace(' ', '_')
        db['conv'][n] = {'profile': ih.file_url(f'{u}.png'), 'sprite': ih.file_url(f'{u}_00.png'),
                         'lobby': ih.file_url(f'Memorial_Lobby_{u}.jpg')}
    json.dump(db, open(ih.OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'Selesai: {ok} murid baru/terbarui, total {len(db["students"])} terdetail.')


if __name__ == '__main__':
    main()
