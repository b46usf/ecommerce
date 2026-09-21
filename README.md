# Niaga marketplace

Implementasi terdiri dari backend modular monolith Fastify dan fondasi frontend Nuxt. Backend mengimplementasikan 121 operasi OpenAPI v0.1 dan seluruh 56 tabel ERD. Frontend membangkitkan tipe langsung dari kontrak yang sama, sehingga path, parameter, request body, dan response diverifikasi oleh TypeScript.

## Menjalankan development

Gunakan Node.js 22.19 atau lebih baru untuk menjalankan kedua aplikasi.

1. Siapkan backend mengikuti `backend/README.md`, termasuk database MySQL/MariaDB, Valkey/Redis, migrasi, dan seed development.
2. Jalankan API dari `backend` dengan `npm run dev`.
3. Jalankan worker dari terminal kedua di `backend` dengan `npm run dev:worker`.
4. Salin `frontend/.env.example` menjadi `frontend/.env` bila alamat API berbeda.
5. Jalankan frontend dari `frontend` dengan `npm install` dan `npm run dev`.
6. Buka `http://localhost:3000`; Swagger tersedia di `http://127.0.0.1:3001/docs`.

Nuxt meneruskan `/api/v1` ke Fastify pada development. Client selalu memakai `credentials: include`, memperoleh CSRF sebelum mutation, menandatangani path/query/body mutation dengan Web Crypto, memperbarui token setelah rotasi session, membuat `Idempotency-Key` bila caller belum menyediakannya, dan menyediakan helper `If-Match` untuk optimistic locking.

## Routing production

Gunakan satu origin publik. Reverse proxy meneruskan `/api/v1/**` ke Fastify dan route lain ke Nuxt. Dengan pola ini cookie HttpOnly tetap same-origin dan JavaScript tidak perlu mengetahui alamat private API.

Konfigurasi yang harus selaras:

| Komponen | Nilai |
| --- | --- |
| Frontend `NUXT_PUBLIC_API_BASE` | `/api/v1` |
| Frontend `NUXT_API_SERVER_BASE` | URL internal API, misalnya `http://api:3001/api/v1` |
| Backend `APP_ORIGINS` | origin publik frontend |
| Backend `PUBLIC_APP_URL` | origin publik frontend |
| Backend `PUBLIC_API_URL` | origin publik dengan routing `/api/v1` |
| Backend `COOKIE_SECURE` | `true` pada HTTPS production |
| Backend `TRUST_PROXY` | `true` ketika Fastify hanya dapat diakses melalui reverse proxy |

Reverse proxy harus mempertahankan `Origin`, `X-Forwarded-Proto`, `X-Request-ID`, `Set-Cookie`, `X-CSRF-Token`, `X-Request-Timestamp`, `X-Request-Nonce`, `X-Request-Signature`, `Idempotency-Key`, dan `If-Match`. Endpoint provider `/api/v1/webhooks/midtrans` dan `/api/v1/webhooks/biteship` diteruskan langsung ke API.

Panduan Vercel, container backend, dan GitHub Pages tersedia di [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Verifikasi

```powershell
cd backend
npm run check
npm run db:erd:check
npm run test:integration

cd ..\frontend
npm run typecheck
npm test
npm run build
npm run test:integration
```

Integration test membutuhkan `TEST_DATABASE_URL` ke database terisolasi dengan nama berakhiran `_test`. Smoke test frontend menjalankan Fastify melalui HTTP dan memverifikasi register, rotasi cookie saat login, `/me`, CSRF baru, serta logout.

Fondasi frontend saat ini menyediakan client typed, session/auth composable, halaman katalog awal, dan halaman login. Seluruh layar pembeli, vendor, dan admin pada dokumen wireframe masih merupakan pekerjaan implementasi frontend berikutnya.
