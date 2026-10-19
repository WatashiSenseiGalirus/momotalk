#!/usr/bin/env python3
"""
Padanan Python dari bagian sed/awk di script bash (tanpa w3m): membaca murid/<Nama>/raw.html
dan menulis 01_profil.txt, 02_background.txt, 03_stats.txt, 04_skills.txt, 05_weapon_dan_gear.txt,
full_profile.txt. Dengan --merge, isinya juga dimasukkan ke public/data/students.json
(field `sections`) dan data profil lengkap (parse_student) ikut diperbarui.

    python tools/extract_sections.py murid            # folder hasil curl
    python tools/extract_sections.py murid --merge
"""
import sys, os, re, json, importlib.util
from bs4 import BeautifulSoup
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ih', os.path.join(HERE, 'import_har.py'))
ih = importlib.util.module_from_spec(spec); spec.loader.exec_module(ih)


ED = r'\n(?:\[\n)?edit(?:\n\])?'   # heading + 'edit' atau '[ edit ]'


def page_text(html):
    s = BeautifulSoup(html, 'lxml')
    c = s.select_one('#mw-content-text')
    if c is None:
        return ''
    for x in c(['style', 'script', 'noscript']):
        x.decompose()
    t = c.get_text('\n', strip=True)
    return '\n'.join(l for l in t.split('\n') if l.strip())


def cut(t, start, end, frm=0, include_end=False):
    m = re.compile(start).search(t, frm)
    if not m:
        return '', frm
    e = re.compile(end).search(t, m.end())
    stop = (e.end() if include_end else e.start()) if e else len(t)
    return t[m.start():stop].strip(), stop


def sections(t):
    out = {}
    out['profil'], _ = cut(t, r'^Full Name$', r'^Release Date GL$\n[^\n]*', 0, True) if False else ('', 0)
    m = re.search(r'(?m)^Full Name$', t)
    if m:
        e = re.compile(r'(?m)^Release Date GL$\n[^\n]*').search(t, m.end())
        out['profil'] = t[m.start():e.end() if e else m.end() + 300]
    # heading di isi artikel diikuti baris "edit"
    bg = re.search(r'(?m)^Background'+ED+'$', t)
    start = bg.start() if bg else 0
    out['background'], _ = cut(t, r'(?m)^Background'+ED+'$', r'(?m)^How to Obtain'+ED+'$', start)
    out['stats'], _ = cut(t, r'(?m)^Stats$', r'(?m)^Skills'+ED+'$', start)
    out['skills'], _ = cut(t, r'(?m)^EX Skill$', r'(?m)^Unique weapon'+ED+'$', start)
    out['weapon_dan_gear'], _ = cut(t, r'(?m)^Unique weapon'+ED+'$', r'(?m)^Resources'+ED+'$', start)
    return out


JP = re.compile(r'[\u3040-\u30ff\u4e00-\u9fff]')
STAT_LABELS = ['Attack', 'Defense', 'HP', 'Healing', 'Accuracy', 'Evasion', 'Critical Rate', 'Critical Damage', 'Stability',
               'Firing Range', 'CC Strength', 'CC Resistance', 'Attack speed', 'Movement speed', 'Cost Recovery', 'Ammo']


def structured(sec):
    """Data terstruktur dari teks section: stats, ex skill, senjata unik, background."""
    out = {}
    L = [l.strip() for l in (sec.get('stats') or '').split('\n') if l.strip()]
    st = {}
    for i, l in enumerate(L[:-1]):
        if l.startswith('Total bonus'):
            break
        if l in STAT_LABELS and l not in st:
            st[l] = L[i + 1]
    if st:
        out['stats'] = st
    L = [l.strip() for l in (sec.get('skills') or '').split('\n') if l.strip()]
    if L and L[0] == 'EX Skill':
        ex = {}
        if len(L) > 1 and L[1].startswith('Cost'):
            ex['cost'] = L[1].replace('Cost', '').strip()
        if '•' in L:
            k = L.index('•')
            if k > 0:
                ex['nameJP'] = L[k - 1]
            if k + 1 < len(L):
                ex['name'] = L[k + 1]
            d = []
            for l in L[k + 2:]:
                if l == 'Lv.':
                    break
                d.append(l)
            ex['desc'] = re.sub(r' ([%.,~])', r'\1', ' '.join(d))
        out['exSkill'] = ex
    L = [l.strip() for l in (sec.get('weapon_dan_gear') or '').split('\n') if l.strip()]
    while L and L[0] in ('Unique weapon', '[', 'edit', ']'):
        L.pop(0)
    if len(L) > 2:
        w = {'name': L[0]}
        d = []
        started = False
        for l in L[1:]:
            if l == 'Japanese':
                started = True; continue
            if not started:
                continue
            if JP.search(l) or l in ('Rank', 'Stats'):
                break
            d.append(l)
        w['desc'] = ' '.join(d)
        out['weapon'] = w
    junk = ('Background', '[', 'edit', ']', 'English', 'Japanese', 'Official introduction')
    bl = [l.strip() for l in (sec.get('background') or '').split('\n') if l.strip() and l.strip() not in junk and not JP.search(l)]
    rel = []
    if 'Relationships' in bl:
        k = bl.index('Relationships')
        rel, bl = bl[k + 1:], bl[:k]
    fix = lambda xs: re.sub(r' ([.,;:!?)])', r'\1', re.sub(r'([(]) ', r'\1', ' '.join(xs))).strip()
    out['background'] = fix(bl)
    if rel:
        out['relText'] = fix(rel)
    return out


FILES = [('profil', '01_profil.txt'), ('background', '02_background.txt'), ('stats', '03_stats.txt'),
         ('skills', '04_skills.txt'), ('weapon_dan_gear', '05_weapon_dan_gear.txt')]


def main(folder, merge):
    db = {'students': {}, 'names': [], 'story': {}}
    if merge and os.path.exists(ih.OUT):
        db.update(json.load(open(ih.OUT, encoding='utf-8')))
    n = 0
    for fname in sorted(os.listdir(folder)):
        name = fname.replace('#Uff0a', '＊').replace('_', ' ')   # folder 'Misaka_Mikoto' -> 'Misaka Mikoto'
        raw = os.path.join(folder, fname, 'raw.html')
        if fname == 'mw-toc-heading' or not os.path.isfile(raw):
            continue
        html = open(raw, encoding='utf-8', errors='replace').read()
        if 'Checking your connection' in html[:3000] or len(html) < 5000:
            print(f'! {name}: halaman Cloudflare/kosong, lewati'); continue
        t = page_text(html)
        sec = sections(t)
        d = os.path.join(folder, fname)
        open(os.path.join(d, 'full_profile.txt'), 'w', encoding='utf-8').write(t)
        for k, fn in FILES:
            open(os.path.join(d, fn), 'w', encoding='utf-8').write(sec.get(k, '') + '\n')
        empty = [k for k, _ in FILES if not sec.get(k)]
        print(f'{name}: ok' + (f' (kosong: {", ".join(empty)})' if empty else ''))
        n += 1
        if merge:
            st = ih.parse_student(html, name)
            if st:
                st['id'] = ih.slugify(name)
                sx = structured(sec)
                rt = sx.pop('relText', '')
                st.update({k: v for k, v in sx.items() if v})
                if rt and not st.get('relationships'):
                    st['relationships'] = [rt]
                db['students'][name] = {**db['students'].get(name, {}), **st}
    if merge:
        for nm in list(db['students']):
            pass
        os.makedirs(os.path.dirname(ih.OUT), exist_ok=True)
        json.dump(db, open(ih.OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('students.json diperbarui:', len(db['students']), 'murid terdetail')
    print('Selesai:', n, 'folder diproses')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], '--merge' in sys.argv)
