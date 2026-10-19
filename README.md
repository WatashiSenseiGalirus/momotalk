# MomoTalk · Blue Archive AI (multi murid)

Web chat bergaya **MomoTalk** dengan AI yang berperan sebagai murid Blue Archive. Pilih murid dari daftar (145 nama dari halaman *Models* wiki), lalu ngobrol, lihat profil, trivia cerita, dan gallery.

## Fitur

- **Daftar murid** (cari + urut Nama/Terbaru). Tiap murid punya riwayat chat sendiri, foto profil dari wiki, dan lencana hati (naik tiap 5 pesan Sensei).
- **Chat**: bubble abu-abu murid, bubble biru Sensei, kotak *Reply* (pilihan jawaban), kartu *Relationship Event* yang membuat adegan cerita pendek.
- **Profil**: foto, nama lengkap/JP, sekolah, peran, usia, ulang tahun, tinggi, hobi, desainer, ilustrator, pengisi suara, perkenalan resmi, hubungan.
- **Trivia**: fakta trivia + kemunculan di cerita utama (Main Story), Relationship Story, event, dan grup, dari halaman `/story` wiki.
- **Gallery**: Sprites, Video, dan gambar lain (kartu, Memorial Lobby, CG). Tap gambar untuk memperbesar.
- **Sambungkan karakter (ruang obrolan grup)**: sampai 3 karakter (bisa diatur 2–4 di Pengaturan) + Sensei dalam satu percakapan.
  - Karakter bisa menawarkan sendiri secara wajar, mis. Hina: "Sensei mau ngobrol sama Aru juga? Aku sambungkan, ya?" (tag `[[SAMBUNG: Aru]]`). Muncul tombol *Ya, sambungkan* / *Tidak usah dulu*, atau jawab dengan mengetik ("iya", "boleh", dst.). Tawaran dibatasi supaya tidak spam (minimal 4 giliran antar tawaran) dan lebih mungkin muncul saat Sensei menyebut nama murid lain. Bisa dimatikan di Pengaturan.
  - Bisa juga manual: tombol **+ Sambungkan** di atas chat (pilih murid), atau tahan pesan karakter lalu pilih *Sambungkan karakter lain…*. Chip anggota di atas chat punya tombol × untuk mengeluarkan.
  - Di ruang grup, para karakter saling menanggapi dan menyambung satu sama lain, bukan hanya ke Sensei. Karakter yang baru masuk menyapa dulu.
  - **Tahan (atau klik kanan) pesan salah satu karakter**: *Balas* (pesan dikutip, karakter itu menjawab dulu lalu yang lain menyambung), *Minta [karakter lain] menanggapi* (karakter lain langsung menanggapi pesan itu), *Sambungkan karakter lain…*, *Salin pesan*.
  - Seluruh ruang tersimpan di browser (sama seperti chat), dan ikut ekspor/impor sesi.
- Persona murid dibuat otomatis dari data profilnya. **Aris** tetap memakai prompt khusus (`public/persona.js`).


## Mikrofon (dikte suara)

Tombol mikrofon di samping tombol kirim memakai Web Speech API milik browser (Chrome/Edge/Safari; Firefox belum mendukung, tombolnya otomatis disembunyikan). Tekan sekali untuk bicara, hasilnya muncul di kotak pesan; tekan lagi untuk berhenti. Di Pengaturan: bahasa mikrofon (Indonesia/English/日本語) dan opsi "kirim otomatis setelah selesai bicara". Butuh HTTPS atau `localhost` (akses lewat `http://192.168.x.x` akan diblokir browser), dan koneksi internet karena pengenalan suara dikerjakan oleh layanan browser.

## Sesi per browser

Tiap browser membuat ID sesi acak sendiri (`momotalk:sid`). Chat, foto, dan pengaturan disimpan di `localStorage` browser itu dengan awalan sesi, jadi **server tidak menyimpan riwayat apa pun** dan pengguna lain tidak bisa melihat sesi kita. ID sesi hanya dikirim ke server sebagai header `x-session-id` untuk pembatasan laju (per sesi dan per IP, di memori, tanpa log isi pesan): atur lewat `.env` (`RATE_LIMIT_PER_MIN`, `RATE_LIMIT_PER_IP_MIN`, `MAX_CONCURRENT`, `MAX_BODY_KB`). Pengaturan > "Sesi browser ini" menyediakan ekspor, impor, dan hapus-semua sesi. Data lama (tanpa sesi) otomatis dipindah ke sesi pertama.

## Struktur

```
public/index.html style.css app.js persona.js
public/data/students.json   data murid hasil impor (profil, gambar, video, cerita)
api/chat.js                 proxy ke endpoint OpenAI-compatible
api/img.js                  proxy gambar/video wiki (cadangan kalau hotlink diblokir)
tools/import_har.py         importer HAR wiki -> students.json
server.js                   server lokal (handler yang sama dengan Vercel)
```

## Jalanin lokal

```bash
cp .env.example .env      # isi AI_BASE_URL, AI_API_KEY, AI_MODEL, APP_PASSWORD (opsional)
node server.js            # Node 18+
# buka http://localhost:3004
```

## Menambah data murid (penting)

### Data diri + background + stats + skill + senjata (script bash)

```bash
COOKIE="cf_clearance=xxxx" UA="<user-agent Chrome>" bash tools/ambil_murid.sh
```

Mengunduh halaman tiap murid ke `murid/<Nama>/raw.html`, menulis `01_profil.txt` ... `05_weapon_dan_gear.txt` (lewat `tools/extract_sections.py`, tanpa perlu w3m) dan menggabungkannya ke `students.json` (field `sections`).

### Jalur Chrome (paling andal kalau Cloudflare memblokir curl)

1. Buka `https://bluearchive.wiki/wiki/Models` di Chrome sampai halaman termuat.
2. F12 > Console, tempel isi `tools/console_dump.js`, Enter. Tunggu sampai `ba_dump.json` terunduh.
3. `python tools/import_dump.py ba_dump.json`

### Cara cepat: tarik semua murid sekaligus (curl + User-Agent)

```bash
pip install beautifulsoup4 lxml
python tools/fetch_wiki.py                      # semua 145 nama dari /wiki/Models (+ /story + varian)
python tools/fetch_wiki.py Shiroko Hoshino      # hanya murid tertentu
python tools/fetch_wiki.py --cookie "cf_clearance=...; ..."   # kalau kena Cloudflare
```

Skrip memakai `curl -L -A "Mozilla/5.0 ..."`, cache halaman di `tools/cache/`, jeda 1,5 detik antar request, dan menggabungkan hasilnya ke `public/data/students.json`. Kalau wiki membalas 403/503 atau "Checking your connection", salin cookie `cf_clearance` dari Chrome (DevTools > Application > Cookies) dan user-agent yang sama ke opsi `--cookie`, atau pakai jalur HAR di bawah.

Data **lengkap** (profil, perkenalan resmi, stats, EX skill, senjata unik, trivia) sudah ada untuk **144 murid** (diimpor dari folder `murid/*/raw.html` lewat `python tools/extract_sections.py murid --merge`) plus Hina (Dress). Murid lain tetap bisa dichat (persona memakai pengetahuan model tentang karakternya) dan fotonya ditebak dari pola nama file wiki, tetapi profil/trivia/sprite/video baru terisi setelah diimpor:

1. Di Chrome, buka halaman murid (mis. `bluearchive.wiki/wiki/Shiroko`) dan halaman `.../Shiroko/story` sampai benar-benar termuat (bukan layar "Checking your connection").
2. Rekam HAR (*Save all as HAR with content*).
3. Jalankan:
   ```bash
   pip install beautifulsoup4 lxml
   python tools/import_har.py file1.har file2.har
   ```
   Hasil digabung ke `public/data/students.json` (bisa diulang dengan HAR lain, data lama tidak hilang). Muat ulang web.

Satu HAR boleh berisi banyak halaman sekaligus (buka beberapa murid berurutan sebelum menyimpan).

## Catatan gambar

URL gambar dihitung dari nama file (aturan penyimpanan MediaWiki: md5 nama file), lalu dimuat langsung dari `static.wikitide.net`. Urutan percobaan: thumbnail, gambar asli, lalu `/api/img` (proxy server yang mengirim Referer wiki). Gambar yang tetap gagal disembunyikan. Foto bisa diganti sendiri di Pengaturan.

## Deploy ke Vercel

Push ke GitHub (`.env` sudah di-`.gitignore`), import di Vercel (Framework: Other), isi Environment Variables `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `APP_PASSWORD`. `localhost` tidak bisa dijangkau dari Vercel; pakai URL publik/tunnel. Proxy video lewat `/api/img` dibatasi ukuran respons Vercel, jadi video sebaiknya dimuat langsung.

## Backend proxy (Cloudflare Worker): `backend.js`

Worker kecil yang membaca URL cloudflared dari `url.txt` di repo GitHub 9router, lalu meneruskan request ke tunnel itu. Token GitHub dan API key 9router cuma disimpan di Cloudflare.

1. Cloudflare Dashboard > **Workers & Pages > Create > Create Worker** (Hello World) > Deploy > **Edit code** > tempel isi `backend.js` > Deploy.
2. Worker > **Settings > Variables and Secrets**, tambah:
   - `GITHUB_TOKEN` (Secret) token GitHub read-only (wajib kalau repo 9router private)
   - `UPSTREAM_API_KEY` (Secret) API key 9router (kosongkan kalau tidak pakai key)
   - `PROXY_SECRET` (Secret) kunci rahasia buatan sendiri (Vercel memakai ini)
   - opsional (Text): `GH_USER`, `GH_REPO`, `GH_BRANCH`, `GH_FILE`
3. Cek `https://NAMA-WORKER.USERNAME.workers.dev/health` harus menampilkan `{"ok":true,"tunnel":"https://..."}`.
4. Di Vercel isi env: `AI_BASE_URL=https://NAMA-WORKER.USERNAME.workers.dev/v1`, `AI_API_KEY=<isi PROXY_SECRET>`, `AI_URL_SOURCE=off`, `AI_MODEL=Akunfree`, `APP_PASSWORD=...`.
