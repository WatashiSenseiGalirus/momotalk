#!/usr/bin/env python3
"""Gabungkan ba_dump.json (hasil tools/console_dump.js) ke public/data/students.json.
    python tools/import_dump.py ba_dump.json
"""
import sys, os, json, importlib.util
spec = importlib.util.spec_from_file_location('ih', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'import_har.py'))
ih = importlib.util.module_from_spec(spec); spec.loader.exec_module(ih)

def main(path):
    dump = json.load(open(path, encoding='utf-8'))
    db = {'students': {}, 'names': [], 'story': {}}
    if os.path.exists(ih.OUT):
        db.update(json.load(open(ih.OUT, encoding='utf-8')))
    if dump.get('Models'):
        db['names'] = ih.parse_models(dump['Models'])
    for page, html in dump.items():
        if page == 'Models' or not html:
            continue
        if page.endswith('/story'):
            db['story'][page[:-6]] = ih.parse_story(html)
        else:
            st = ih.parse_student(html, page)
            if st:
                st['id'] = ih.slugify(page); db['students'][page] = st
                print('Murid :', page)
    db['conv'] = {}
    for n in db['names']:
        u = n.replace(' ', '_')
        db['conv'][n] = {'profile': ih.file_url(f'{u}.png'), 'sprite': ih.file_url(f'{u}_00.png'),
                         'lobby': ih.file_url(f'Memorial_Lobby_{u}.jpg')}
    json.dump(db, open(ih.OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('Total terdetail:', len(db['students']))

main(sys.argv[1]) if len(sys.argv) > 1 else sys.exit(__doc__)
