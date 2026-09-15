# Audit frontend terhadap wireframe v0.1 — diperbarui 2026-09-15

Sumber: `Wireframe-UI-UX-Marketplace-Lengkap-v0.1.md`, `Marketplace-API-OpenAPI-v0.1.yaml`, dan implementasi pada folder `frontend`.

## Hasil

Seluruh layar MVP pada inventaris wireframe sudah memiliki route atau komponen sistem, state loading/empty/error yang relevan, layout responsif, dan binding ke kontrak backend. Audit otomatis dapat diulang dengan `npm run audit:wireframe`.

| Status | Jumlah | Arti |
| --- | ---: | --- |
| Lengkap untuk MVP | 46 | Route/komponen dan fungsi utama tersedia serta terhubung ke endpoint kontrak |
| Parsial | 0 | Tidak ada alur MVP yang berhenti pada placeholder |
| Belum ada | 0 | Tidak ada layar inventaris yang hilang |
| Total | 46 | 4 publik, 15 pembeli, 12 vendor, 12 admin, dan 3 sistem |

## Matriks layar

| ID | Status | Implementasi utama |
| --- | --- | --- |
| PUB-01 Registrasi | Lengkap | Validasi, consent, visibilitas password, error/request ID, dan verifikasi email |
| PUB-02 Login dan pemulihan | Lengkap | Login, safe redirect, lupa/reset password, dan session handoff |
| PUB-03 Kebijakan | Lengkap | Syarat/privasi berversi, daftar isi, dan tampilan cetak |
| PUB-04 Status layanan | Lengkap | Pemeriksaan API langsung, latency, status komponen, dan riwayat insiden |
| BUY-01 Beranda dan katalog | Lengkap | Hero, kategori, pencarian, kartu produk, stok, rekomendasi, dan pagination |
| BUY-02 Pencarian dan filter | Lengkap | Query URL, kategori, harga, sort, chip aktif, pagination, dan state universal |
| BUY-03 Detail produk | Lengkap | Galeri/lightbox, SKU, stok, jumlah, spesifikasi, cart, dan RFQ handoff |
| BUY-04 Profil toko | Lengkap | Identitas/status toko, metrik katalog, pencarian lokal, dan produk toko |
| BUY-05 Keranjang | Lengkap | Multi-vendor, seleksi, quantity, invalid stock/status, quote lock, dan total |
| BUY-06 Checkout | Lengkap | Konteks buyer, alamat, ongkir per toko, preview totals, consent, dan confirm |
| BUY-07 Pembayaran | Lengkap | Metode, session, redirect, countdown, polling, cancel, terminal, dan review |
| BUY-08 Daftar pesanan | Lengkap | Filter, status group/vendor/payment, total, dan cursor pagination |
| BUY-09 Detail pesanan | Lengkap | Item snapshot, recipient, rincian uang, payment, cancel, tracking, dan komplain |
| BUY-10 Tracking | Lengkap | Kurir, resi/copy, status, timeline event, dan actual shipping notice |
| BUY-11 Daftar/detail RFQ | Lengkap | Filter, kebutuhan awal, riwayat versi, expiry, accept, dan decline |
| BUY-12 Buat RFQ | Lengkap | Satu vendor, multi-line SKU, alamat, catatan, validasi, dan idempotensi |
| BUY-13 Komplain/refund | Lengkap | Pembuatan kasus, keputusan kasus, daftar refund, dan state proses/unknown |
| BUY-14 Alamat | Lengkap | CRUD, default, archive, area/koordinat, masker telepon, dan optimistic locking |
| BUY-15 Organisasi | Lengkap | Pembuatan profil organisasi, tipe sekolah/perusahaan, dan pemilih konteks buyer |
| VEN-01 Onboarding | Lengkap | Wizard entitas, dokumen, toko, origin, rekening, ringkasan, dan submit review |
| VEN-02 Dashboard toko | Lengkap | Store switcher serta widget produk, RFQ, order, payable, dan blocked balance |
| VEN-03 Daftar produk | Lengkap | Search/filter, status, edit, publish, dan archive |
| VEN-04 Tambah/edit produk | Lengkap | Profil, deskripsi aman, atribut, gambar 1–8, drag/drop, preview, SKU, dan checklist publish |
| VEN-05 Persediaan | Lengkap | On-hand, reserved, available, reason/reference, dan adjustment versioned |
| VEN-06 Daftar/detail RFQ | Lengkap | Inbox/filter serta detail kebutuhan dan riwayat penawaran |
| VEN-07 Versi penawaran | Lengkap | Harga per item, quantity, expiry, konfirmasi, dan reject reason |
| VEN-08 Pesanan vendor | Lengkap | Daftar/detail, item/recipient snapshot, financials, dokumen, dan action |
| VEN-09 Siap kirim/tracking | Lengkap | Ready-to-ship asynchronous operation serta tracking vendor |
| VEN-10 Hak penerimaan/payout | Lengkap | Saldo, reserved, eligibility, blocked state, dan riwayat payout |
| VEN-11 Profil/origin | Lengkap | Edit profil, status/submit moderation, pickup address, dan koordinat |
| VEN-12 Rekening | Lengkap | Daftar masked account, status verifikasi, dan pengajuan rekening |
| ADM-01 Dashboard | Lengkap | Widget antrean operasional/keuangan dan role context |
| ADM-02 Moderasi | Lengkap | Queue toko/entitas, decision/suspend reason, dan protected document viewer |
| ADM-03 Kategori/pajak | Lengkap | Tree editor kategori, JSON schema, kelas pajak, dan activation |
| ADM-04 Profil/kebijakan pajak | Lengkap | Tax profile, evidence IDs, validity, verification, dan collector state |
| ADM-05 Kebijakan komisi | Lengkap | Scope, periode, rate/fee, margin simulation, dan activation reason |
| ADM-06 Payment review | Lengkap | Receipt/allocation table dan reconciliation operation per attempt |
| ADM-07 Rekonsiliasi | Lengkap | Period run, source evidence, operation polling, dan mismatch detail |
| ADM-08 Refund | Lengkap | Maker create, approver action, polling, unknown, dan hasil manual/proof |
| ADM-09 Kasus | Lengkap | Kanban/filter, detail reason/resolution, dan resolution action |
| ADM-10 Pengiriman review | Lengkap | Reconciliation request, reason, serta asynchronous status |
| ADM-11 Payout | Lengkap | Maker draft, locked allocation input, checker approve, transfer, dan proof result |
| ADM-12 Jurnal/audit | Lengkap | Read-only balanced totals serta viewer perubahan yang disensor backend |
| SYS-01 Notifikasi | Lengkap | Unread badge, drawer, empty state, deep link, dan mark-as-read versioned |
| SYS-02 Operation status | Lengkap | Reusable polling untuk queued/processing/succeeded/failed/review |
| SYS-03 Error/maintenance | Lengkap | 404/403/503, request error, offline banner, maintenance, retry, dan status link |

## Kesesuaian lintas layar

| Area | Status | Bukti |
| --- | --- | --- |
| Integrasi OpenAPI | Sesuai | Tipe dibangkitkan dari kontrak root; client mengelola cookie, CSRF, idempotensi, request ID, dan `If-Match` |
| Navigasi per peran | Sesuai | Buyer, vendor, dan admin memiliki navigasi serta store/context switcher |
| Responsive | Sesuai | Grid, table overflow, form, wizard, kanban, dialog gambar, dan navigasi memiliki aturan desktop/tablet/mobile |
| Aksesibilitas dasar | Sesuai | Landmark, skip link, label, focus-visible, keyboard dropzone/dialog/table, live region, dan reduced motion |
| Upload | Sesuai | Tipe/ukuran diperiksa per file, drag/drop dan keyboard tersedia, serta payload multipart memakai CSRF/idempotensi |
| Analytics | Sesuai | Event bisnis diambil pada response sukses dengan allow-list; body, alamat, identitas pajak, rekening, dokumen, dan provider payload tidak dikirim |
| Kejujuran state | Sesuai | Payment, shipment, refund, payout, dan operation menampilkan pending/unknown/review tanpa menganggap sukses lebih awal |

## Batas kontrak MVP

Beberapa hiasan data pada sketsa tidak mempunyai field atau read model di OpenAPI v0.1: rating/lokasi publik, instruksi VA/QR terstruktur, histori pergantian resi, percakapan kasus, dan queue list untuk beberapa aksi admin berbasis ID. UI memakai fallback yang jujur dan tetap menyediakan seluruh tindakan yang didukung kontrak; tidak ada data contoh yang ditampilkan sebagai data produksi.

## Validasi terakhir

- `npm run audit:wireframe`: 46/46 lolos.
- `vue-tsc --noEmit -p .nuxt/tsconfig.json`: lolos dalam strict mode.
- Frontend unit: 7/7 lolos.
- Frontend production build: lolos; OpenAPI types dibangkitkan ulang sebelum build.
- Backend unit: 51/51 lolos.
- Backend contract copy: sinkron dengan OpenAPI root.
- ERD check: 56 tabel dan 424 kolom terdokumentasi, plus satu tabel infrastruktur.
- Integration browser–Fastify tersedia dan akan berjalan bila `TEST_DATABASE_URL` menunjuk database khusus berakhiran `_test`; pada validasi ini dilewati karena variabel tersebut tidak disediakan.
