#!/usr/bin/env python3
"""
Importer data murid dari bluearchive.wiki.

Pakai (di folder proyek):
    pip install beautifulsoup4 lxml
    python tools/import_har.py file1.har [file2.har ...]

Input : HAR yang direkam saat halaman wiki benar-benar termuat (bukan layar
        "Checking your connection"). Halaman yang dikenali:
          /wiki/<Murid>            -> profil, intro, relasi, sprites, gambar lain, video
          /wiki/<Murid>/story      -> daftar kemunculan cerita (untuk tab Trivia)
          /wiki/Models             -> daftar semua nama murid
Output: public/data/students.json (digabung dengan isi yang sudah ada, jadi
        bisa dijalankan berkali-kali dengan HAR lain).
"""
import sys, json, re, hashlib, base64, os, urllib.parse
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'data', 'students.json')
STATIC = 'https://static.wikitide.net/bluearchivewiki'


def file_url(name):
    """URL file wiki dari nama file (aturan penyimpanan MediaWiki: md5 nama berspasi-garis-bawah)."""
    n = name.replace(' ', '_')
    h = hashlib.md5(n.encode('utf-8')).hexdigest()
    return f"{STATIC}/{h[0]}/{h[:2]}/{urllib.parse.quote(n, safe='()_.-,')}"


def slugify(t):
    return re.sub(r'[^a-z0-9]+', '-', t.lower()).strip('-')


def clean(t):
    t = re.sub(r'\s+', ' ', t or '').strip()
    return re.sub(r' ([.,;:!?])', r'\1', t)


def section(c, title):
    """Elemen-elemen di bawah heading `title` sampai heading selevel/lebih tinggi berikutnya."""
    for hd in c.find_all(['h1', 'h2', 'h3']):
        if clean(hd.get_text()) == title:
            node = hd.parent if 'mw-heading' in (hd.parent.get('class') or []) else hd
            lvl = int(hd.name[1])
            out = []
            for x in node.find_next_siblings():
                h = x.find(re.compile('^h[1-3]$')) if x.name == 'div' else (x if re.match('^h[1-3]$', x.name or '') else None)
                if h is not None and int(h.name[1]) <= lvl:
                    break
                out.append(x)
            return out
    return []


def parse_student(html, title):
    s = BeautifulSoup(html, 'lxml')
    for junk in s.find_all(['style', 'script', 'noscript']):
        junk.decompose()
    c = s.select_one('#mw-content-text')
    tbl = c.select_one('table.ba-template-character')
    if not tbl:
        return None
    th = tbl.select_one('th.character-name')
    info = {'title': title, 'name': clean(th.get_text())}
    m = re.search(r'CharacterId:\s*(\d+)', th.get('title', ''))
    if m:
        info['characterId'] = int(m.group(1))
    info['rarity'] = int((tbl.select_one('.character-rarity') or {}).get('data-value', 0) or 0)

    # baris label/nilai
    rows = {}
    cells = [clean(x.get_text(' ')) for x in tbl.find_all(['th', 'td'])]
    labels = ['School', 'Role', 'Damage Type', 'Armor Type', 'Combat Class', 'Full Name', 'Age',
              'Birthday', 'Height', 'Hobbies', 'Designer', 'Illustrator', 'Voice',
              'Release Date JP', 'Release Date GL']
    for i, v in enumerate(cells):
        if v == 'School' and i + 3 < len(cells) and cells[i + 1] == 'Role':
            rows['School'], rows['Role'] = cells[i + 2], cells[i + 3]
        elif v in labels and v not in rows and i + 1 < len(cells) and cells[i + 1] not in labels:
            rows[v] = cells[i + 1]
    key = {'School': 'school', 'Role': 'role', 'Damage Type': 'damageType', 'Armor Type': 'armorType',
           'Combat Class': 'combatClass', 'Full Name': 'fullName', 'Age': 'age', 'Birthday': 'birthday',
           'Height': 'height', 'Hobbies': 'hobbies', 'Designer': 'designer', 'Illustrator': 'illustrator',
           'Voice': 'voice', 'Release Date JP': 'releaseJP', 'Release Date GL': 'releaseGL'}
    for k, v in rows.items():
        info[key[k]] = v
    # nama JP: sel setelah "Full Name" berisi "Sorasaki Hina 空崎 ヒナ"
    if 'fullName' in info:
        jp = re.findall(r'[\u3040-\u30ff\u4e00-\u9fff]+', info['fullName'])
        info['nameJP'] = ' '.join(jp)
        info['fullName'] = clean(re.sub(r'[\u3040-\u30ff\u4e00-\u9fff]+', '', info['fullName']))

    # kalimat pembuka halaman (sebelum infobox)
    lead = []
    for p in c.find_all('p'):
        t = clean(re.sub(r'\[\s*\d+\s*\]', '', p.get_text(' ')))
        t = re.sub(r' ([.,])', r'\1', t)
        if len(t) > 40:
            lead.append(t)
        if len(lead) >= 1:
            break
    info['lead'] = ' '.join(lead)

    # intro resmi (Inggris): panel tab pertama di .character-background
    intro = ''
    bg = c.select_one('.character-background')
    if bg:
        panel = bg.select_one('article.tabber__panel') or bg
        lines = [x.strip() for x in panel.get_text('\n').split('\n') if x.strip()]
        lines = [x for x in lines if x not in ('English', 'Japanese') and not re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', x)]
        intro = ' '.join(lines)
    info['intro'] = clean(intro)

    # relasi
    rel = []
    for el in section(c, 'Relationships'):
        for p in (el.find_all('p') if el.name != 'p' else [el]):
            t = clean(re.sub(r'\[\s*\d+\s*\]', '', p.get_text(' ')))
            if t:
                rel.append(t)
        for li in el.find_all('li'):
            t = clean(re.sub(r'\[\s*\d+\s*\]', '', li.get_text(' ')))
            if t:
                rel.append(t)
    info['relationships'] = rel

    # trivia (kalau halaman punya)
    triv = []
    for el in section(c, 'Trivia'):
        for li in el.find_all('li'):
            t = clean(re.sub(r'\[\s*\d+\s*\]', '', li.get_text(' ')))
            if t and len(t) > 3 and not t.startswith('↑') and t not in triv:
                triv.append(t)
    info['trivia'] = triv

    # gambar: sprites, misc, profil, artwork, potret
    def files_in(els):
        out = []
        for el in els:
            for a in el.find_all('a', href=True):
                mm = re.match(r'/wiki/File:(.+)$', a['href'])
                if mm:
                    n = urllib.parse.unquote(mm.group(1))
                    if n not in out:
                        out.append(n)
        return out

    def captions(els):
        # nama versi tiap sprite (teks di bawah gambar)
        return [clean(x.get_text(' ')) for el in els for x in el.select('figcaption, .gallerytext') if clean(x.get_text(' '))]

    sp_els = section(c, 'Sprites')
    sprites = files_in(sp_els)
    caps = captions(sp_els)
    info['sprites'] = [{'file': f, 'url': file_url(f), 'label': (caps[i] if i < len(caps) else f.rsplit('.', 1)[0].replace('_', ' '))}
                       for i, f in enumerate(sprites)]
    info['misc'] = [{'file': f, 'url': file_url(f), 'label': f.rsplit('.', 1)[0].replace('_', ' ')} for f in files_in(section(c, 'Misc images'))]

    imgs = {}
    for panel in tbl.select('article.tabber__panel'):
        nm = clean((s.select_one(f'#{panel.get("aria-labelledby")}') or panel).get_text())
        fl = files_in([panel])
        if fl:
            imgs[nm] = fl
    info['images'] = {k: [{'file': f, 'url': file_url(f)} for f in v] for k, v in imgs.items()}

    # video & audio di halaman ini
    vids = []
    for v in c.find_all('video'):
        t = v.get('data-mwtitle')
        if t:
            poster = v.get('poster', '')
            vids.append({'file': t, 'url': file_url(t), 'poster': ('https:' + poster) if poster.startswith('//') else poster,
                         'label': t.rsplit('.', 1)[0].replace('_', ' ')})
    for el in c.find_all(attrs={'data-mwtitle': True}):
        t = el['data-mwtitle']
        if t.endswith('.webm') and not any(x['file'] == t for x in vids):
            vids.append({'file': t, 'url': file_url(t), 'poster': '', 'label': t.rsplit('.', 1)[0].replace('_', ' ')})
    for mm in re.finditer(r'(?:https:)?//static\.wikitide\.net/bluearchivewiki/[0-9a-f]/[0-9a-f]{2}/([^"\'\s]+?\.(?:webm|mp4))', html):
        n = urllib.parse.unquote(mm.group(1))
        if not any(x['file'] == n for x in vids):
            vids.append({'file': n, 'url': file_url(n), 'poster': '', 'label': n.rsplit('.', 1)[0].replace('_', ' ')})
    info['videos'] = vids

    # varian
    var = []
    for a in c.select('a[href^="/wiki/"]'):
        t = clean(a.get_text())
        if re.match(re.escape(info['name']) + r' \(', t) and t not in var:
            var.append(t)
    info['variants'] = var
    return info


def parse_story(html):
    s = BeautifulSoup(html, 'lxml')
    c = s.select_one('#mw-content-text')
    out = {'relationship': [], 'main': [], 'event': []}
    for el in section(c, 'Relationship stories'):
        for t in re.split(r'\n', el.get_text('\n', strip=True)):
            pass
    # relationship stories: baris setelah label "Relationship stories :" sampai heading berikut
    txt = c.get_text('\n', strip=True)
    m = re.search(r'Relationship stories\n:\n(.*?)\nMomoTalk\n', txt, re.S)
    if m:
        out['relationship'] = [x for x in m.group(1).split('\n') if x.strip() and x != ',']
    m = re.search(r'Below is a list of [^\n]*main stories:\n(.*?)\nEvent story\n', txt, re.S)
    if m:
        blob = m.group(1).replace('\n,\n', ', ').replace('\n', ' ')
        out['main'] = [clean(x) for x in re.split(r'(?=Volume )', blob) if clean(x)]
    m = re.search(r'Below is a list of [^\n]*event stories:\n(.*?)\nOther stories\n', txt, re.S)
    if m:
        blob = m.group(1)
        out['event'] = [clean(x.replace('\n', ' ')) for x in re.split(r'\n(?=[^\n:]+\n: stor)', '\n' + blob) if clean(x)]
    k = txt.rfind('Other stories\n')
    e = txt.find('\nRetrieved from', k)
    if k >= 0 and e > k:
        out['other'] = clean(txt[k + 14:e].replace('\n,\n', ', ').replace('\n', ' '))
        out['other'] = re.sub(r'\bedit\b ?', '', out['other']).strip()
    return out


def parse_models(html):
    s = BeautifulSoup(html, 'lxml')
    c = s.select_one('#mw-content-text')
    names = []
    for a in c.find_all('a', href=True):
        if a['href'].startswith('#') and re.match(r'^\d+', a.get_text(strip=True)):
            names.append(re.sub(r'^\d+', '', a.get_text(strip=True)))
    return names


def har_pages(path):
    h = json.load(open(path, encoding='utf-8'))
    for e in h['log']['entries']:
        u = e['request']['url']
        c = e['response']['content']
        t = c.get('text') or ''
        if (c.get('mimeType') or '').startswith('text/html') and len(t) > 5000 and 'bluearchive.wiki/wiki/' in u:
            if c.get('encoding') == 'base64':
                t = base64.b64decode(t).decode('utf-8', 'replace')
            if 'Checking your connection' in t[:3000]:
                continue
            yield u, t


def main(paths):
    db = {'students': {}, 'names': [], 'story': {}}
    if os.path.exists(OUT):
        db.update(json.load(open(OUT, encoding='utf-8')))
    for p in paths:
        for url, html in har_pages(p):
            path = urllib.parse.unquote(urllib.parse.urlparse(url).path.replace('/wiki/', '', 1)).replace('_', ' ')
            q = urllib.parse.urlparse(url).query
            if path.startswith('Special:') or q:
                continue
            if path == 'Models':
                db['names'] = parse_models(html)
                print('Models:', len(db['names']), 'nama')
            elif path.endswith('/story'):
                db['story'][path[:-6]] = parse_story(html)
                print('Story :', path[:-6])
            elif '/' not in path and path != 'Main Page':
                st = parse_student(html, path)
                if st:
                    st['id'] = slugify(path)
                    db['students'][path] = st
                    print('Murid :', path, '| sprites', len(st['sprites']), '| video', len(st['videos']), '| misc', len(st['misc']))
    # URL gambar murid yang belum punya data lengkap: ditebak dari pola nama file wiki
    # (Nama.png, Nama_00.png, Memorial_Lobby_Nama.jpg). Yang gagal dimuat disembunyikan app.
    db['conv'] = {}
    for n in db['names']:
        u = n.replace(' ', '_')
        db['conv'][n] = {'profile': file_url(f'{u}.png'), 'sprite': file_url(f'{u}_00.png'),
                         'lobby': file_url(f'Memorial_Lobby_{u}.jpg')}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(db, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('Ditulis', OUT, '-', len(db['students']), 'murid terdetail,', len(db['names']), 'nama')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
