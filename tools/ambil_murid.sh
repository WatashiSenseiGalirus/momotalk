#!/bin/bash
# Unduh semua halaman murid (curl + User-Agent), lalu ekstrak data diri ke murid/<Nama>/*.txt
# dan gabungkan ke public/data/students.json.
#   COOKIE="cf_clearance=xxxx" UA="<user-agent Chrome lu>" bash tools/ambil_murid.sh
# Kalau models.html belum ada, akan diunduh otomatis.
cd "$(dirname "$0")/.." || exit 1
UA="${UA:-Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36}"
dl() { # $1=url $2=file
  curl -sL -m 60 -A "$UA" ${COOKIE:+-H "Cookie: $COOKIE"} "$1" -o "$2"
  if [ ! -s "$2" ] || head -c 4000 "$2" | grep -q "Checking your connection\|Just a moment"; then
    rm -f "$2"; return 1; fi
}

[ -f models.html ] || dl "https://bluearchive.wiki/wiki/Models" models.html || {
  echo "[!] models.html gagal (Cloudflare/403). Isi COOKIE=\"cf_clearance=...\" dan UA sama dengan Chrome."; exit 1; }

# <h2 id="Nama"> tanpa "mw-toc-heading" dan "Material Development Club Member"
grep -oP '(?<=<h2 id=")[^"]+' models.html | grep -v -e "^mw-toc-heading$" -e "Material" > daftar_murid.txt
TOTAL=$(wc -l < daftar_murid.txt); echo "[*] $TOTAL murid"
C=1; GAGAL=0
while IFS= read -r murid; do
  URL_MURID=$(echo "$murid" | sed 's/ /_/g; s/＊/%EF%BC%8A/g')
  F="murid/$murid"; mkdir -p "$F"
  echo "[$C/$TOTAL] $murid"
  [ -s "$F/raw.html" ] || { dl "https://bluearchive.wiki/wiki/$URL_MURID" "$F/raw.html" || { echo "  ! gagal"; GAGAL=$((GAGAL+1)); rmdir "$F" 2>/dev/null; }; sleep 1.5; }
  C=$((C+1))
done < daftar_murid.txt
echo "[*] gagal unduh: $GAGAL"
python3 tools/extract_sections.py murid --merge
