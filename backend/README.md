# Marketplace backend

Backend modular monolith dengan Fastify, TypeScript strict, Drizzle/mysql2, Redis/Valkey, dan BullMQ. Acuan utama adalah arsitektur terbaru di root dan seluruh 56 tabel pada ERD. MySQL 8 adalah target staging/production; MariaDB XAMPP didukung untuk development.

## Menjalankan lokal

Butuh Node.js 22+, database XAMPP, dan Redis/Valkey. Jalankan perintah dari folder `backend`.

1. `npm ci`
2. Salin `.env.example` menjadi `.env`, lalu isi URL database dan secret sendiri. Contoh pembentukan secret: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. Hidupkan MySQL di XAMPP. Buat database dan dua user khusus menggunakan `scripts/bootstrap-database.sql.example` setelah mengganti placeholder password. Isi `DATABASE_URL` untuk user aplikasi dan `MIGRATION_DATABASE_URL` untuk user migrasi. Jangan gunakan root untuk runtime.
4. `docker compose up -d` menjalankan Valkey serta Mailpit lokal. Bila Redis sudah tersedia, cukup sesuaikan `REDIS_URL`. Docker tidak wajib untuk menjalankan Node dan XAMPP.
5. `npm run db:migrate`
6. Isi `SEED_ADMIN_PASSWORD`, `SEED_BUYER_PASSWORD`, dan `SEED_VENDOR_PASSWORD` pada `.env` sebelum `npm run db:seed`. Seed hanya menerima `NODE_ENV=development` dan tidak mengganti password akun yang sudah ada.
7. `npm run dev` dan, pada terminal lain, `npm run dev:worker`.

API: `http://127.0.0.1:3001/api/v1`. Dokumentasi route yang telah diimplementasikan: `http://127.0.0.1:3001/docs`. Mailpit: `http://127.0.0.1:8025`. Health check: `/health/live` dan `/health/ready`. API memeriksa koneksi database dan Redis saat startup.

Jika ingin memakai MySQL container sebagai alternatif XAMPP, isi `MYSQL_PASSWORD` dan `MYSQL_ROOT_PASSWORD`, lalu jalankan `docker compose -f compose.yaml -f compose.mysql.yaml up -d`. Database container memakai port host **3307**, sehingga tidak bentrok dengan XAMPP 3306.

## Cakupan implementasi

- Skema dan migrasi seluruh 56 tabel ERD; tambahan `upload_intents` mendukung direct upload. Pemetaan, constraint, dan batas implementasi dijelaskan di [docs/erd-implementation.md](docs/erd-implementation.md).
- Autentikasi Argon2id, registrasi, verifikasi email, reset password, logout, session Redis, CSRF sebelum/sesudah login, serta pemeriksaan hak admin/toko.
- Toko dan legal entity, moderasi admin, kategori dan kelas pajak; katalog, SKU, pencarian FULLTEXT, cursor pagination, HTML allowlist, dan stok dengan transaksi/row lock.
- Idempotensi mutation kritis, optimistic locking `If-Match`, audit append-only, dan internal service posting jurnal seimbang.
- Multipart dan direct upload S3/R2, pemindaian ClamAV, thumbnail/card/detail/zoom WebP tanpa metadata EXIF, outbox email/transaksi, retry terbatas, dan dead-letter queue.
- RFQ, cart, ongkir, checkout dan reservasi stok; Midtrans Snap, Biteship booking/tracking, kasus, refund, jurnal, payable, dan payout manual maker-checker.

Seluruh 121 operasi pada kontrak OpenAPI memiliki route aktif. Tiga endpoint tambahan mendukung direct upload, konfirmasi asinkron, dan unduhan dokumen bertanda tangan. Tarif pajak, komisi, batas kanal pembayaran, dan credential provider tidak pernah diasumsikan; endpoint terkait menolak proses sampai konfigurasi terverifikasi tersedia.

## Kontrak HTTP

Route memakai prefix `/api/v1`. Mulai dengan `GET /auth/csrf`, simpan cookie, lalu kirim `X-CSRF-Token` dan `Origin` sesuai `APP_ORIGINS` pada mutation termasuk login/register. Client frontend juga menandatangani mutation JSON memakai Web Crypto melalui header timestamp, nonce, dan HMAC; backend memvalidasi isi serta menolak replay lewat Redis. Login merotasi cookie; ambil token CSRF lagi sesudah login. Browser harus memakai `credentials: 'include'`. Rincian protokol, TLS, dan enkripsi data tersimpan ada di [docs/security.md](docs/security.md).

Mutation create/kritis menggunakan `Idempotency-Key` 16–128 karakter. Payload berbeda pada key sama ditolak 409. Otorisasi diperiksa sebelum replay. Resource berversi memakai `If-Match: "0"`; header hilang 428 dan versi lama 412. Waktu ISO UTC; uang integer IDR dengan batas safe integer API, perhitungan jurnal menggunakan bigint.

Kontrak sumber disalin ke `contracts/openapi.yaml`, dipakai untuk validasi request dan respons sukses, dan ditampilkan utuh pada `/docs`. Multipart kontrak dan direct upload sama-sama dibatasi **5 MiB** agar worker dan ingress konsisten:

1. `POST /vendor/stores/{storeId}/products/{productId}/media/upload-url` dengan `{ "content_type": "image/jpeg", "size_bytes": 12345 }` mengembalikan URL PUT sementara.
2. Browser PUT byte gambar langsung ke URL tersebut dengan Content-Type yang diberikan.
3. `POST /vendor/stores/{storeId}/products/{productId}/media/confirm` dengan `{ "upload_id": "UUID", "alt_text": "Foto produk", "sort_order": 0 }` mengembalikan 202; poll `status_url` sampai selesai. Gambar baru masuk katalog setelah validasi worker.

Isi seluruh variabel S3 untuk memakai media. Bucket harus privat; hanya prefix `products/` yang boleh disajikan CDN. Prefix `quarantine/` tidak boleh publik. Konfigurasikan CORS bucket untuk PUT dari origin frontend dan lifecycle untuk menghapus objek quarantine/objek tanpa referensi. URL expired memerlukan permintaan baru dengan idempotency key baru. PNG/JPEG/WebP satu frame saja; maksimal 40 juta pixel dan 10 gambar per produk.

## Worker dan operasi

Outbox MySQL menyimpan ID dan payload minimum yang diperlukan. Token email direkonstruksi worker menggunakan HMAC; token mentah tidak disimpan ke database/queue/log. SMTP memiliki timeout; delivery email bersifat at least once dengan Message-ID tetap. Jangan menganggap SMTP menjamin tepat satu email ketika proses terhenti sesudah pengiriman.

Worker menangani email, media, pembayaran, expiry order, refund API, shipment, rekonsiliasi, dan penyelesaian order setelah masa sengketa.

BullMQ menjalankan maksimal lima percobaan dengan exponential backoff dan job ID dari event UUID. Request provider/S3 dibatasi timeout; pemrosesan gambar dibatasi pixel/ukuran/waktu. Event selesai ditandai `DONE`; event gagal permanen `DEAD` dan masuk `marketplace-dead-letter`. Replay manual memerlukan pemeriksaan penyebab, mempertahankan event ID, dan tidak mengulang efek finansial.

## Validasi dan build

Hasil audit terakhir, cakupan yang sudah dibuktikan, dan gap menuju production dicatat di [docs/backend-audit-2026-09-13.md](docs/backend-audit-2026-09-13.md).

```sh
npm run check
npm run db:erd:check
npm run test:integration
npm audit
```

Integration test memerlukan `TEST_DATABASE_URL` ke database khusus dengan nama berakhiran `_test`; tanpa variabel tersebut suite integrasi dilewati. Migrasikan database uji dahulu menggunakan URL yang sama. Test menggunakan MySQL/MariaDB asli untuk constraint, rollback, idempotensi dan konkurensi. Beberapa test HTTP memakai pengganti Redis yang terbatas untuk isolasi pengujian; ini bukan pengganti verifikasi Redis/BullMQ di staging.

Workflow CI di root `.github/workflows/backend.yml` memvalidasi lint, TypeScript, unit/integration test pada MySQL 8 dan MariaDB, audit dependency runtime, serta build image. `npm run build` menyalin SQL migrasi ke `dist/database/migrations`; `npm start` menjalankan hasil build. Worker memakai image yang sama dengan perintah `node dist/worker.js`. Jalankan migrasi sebagai job terpisah sebelum menaikkan aplikasi.

Production memerlukan HTTPS, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, secret terpisah untuk session/token/enkripsi, private database/Redis, SMTP/object storage/ClamAV/provider yang telah dikonfigurasi, backup/restore, observability, dan review keamanan. MFA admin sensitif belum memiliki endpoint dalam kontrak OpenAPI v0.1 dan tetap harus ditambahkan sebelum transaksi nyata.
