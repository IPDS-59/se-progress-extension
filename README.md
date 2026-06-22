# FASIH SE Progress Extension

Chrome extension (Manifest V3) untuk mengekstrak data progres petugas Sensus Ekonomi 2026 dari [fasih-sm.bps.go.id/app](https://fasih-sm.bps.go.id/app).

## Fitur

- Pilih provinsi dari dropdown 38 provinsi BPS
- Pilih peran: Pengawas atau Pencacah
- Pilih kabupaten/kota yang ingin diekstrak
- Log progres real-time saat pengambilan data
- Halaman visualisasi hasil: tabel petugas, progress bar, filter & sort
- Unduh hasil sebagai JSON, CSV, atau Excel (.xlsx) dengan tabel pivot per petugas

## Cara Pakai

1. Buka `https://fasih-sm.bps.go.id/app` di Chrome dan pastikan sudah login
2. Pasang ekstensi (lihat bagian Instalasi)
3. Klik ikon ekstensi di toolbar
4. Pilih provinsi → pilih peran → pilih kabupaten → mulai ekstrak
5. Setelah selesai, klik **Lihat Hasil** untuk membuka halaman visualisasi

> **Catatan:** Ekstensi hanya berjalan di halaman `/app` (bukan halaman lama `/survey-collection`). Koneksi VPN BPS diperlukan.

## Instalasi

### Prasyarat

- Node.js ≥ 18
- Google Chrome

### Build hasil page

```bash
npm install
npm run build
```

### Muat ekstensi ke Chrome

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked**
4. Pilih folder repo ini

## Struktur Proyek

```
├── manifest.json       # Manifest V3
├── popup.html/js/css   # UI popup ekstensi
├── content.js          # Logic API (berjalan di halaman FASIH)
├── results.html        # Halaman visualisasi hasil
├── src/
│   ├── results.jsx     # Komponen React halaman hasil
│   └── results.css     # Tailwind CSS input
├── results.js          # Build output (esbuild)
└── results.css         # Build output (Tailwind)
```

## Stack

- Chrome Extension Manifest V3
- React 18 + Tailwind CSS 3 (halaman hasil)
- esbuild (bundler)

## Lisensi

Internal BPS Provinsi Sulawesi Tengah — tidak untuk distribusi publik.
