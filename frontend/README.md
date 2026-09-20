# Marketplace frontend

Frontend Nuxt 4 untuk backend marketplace. Client API dibangkitkan dari kontrak OpenAPI root dan menangani cookie session, CSRF, idempotency key, request ID error, serta optimistic locking `If-Match`.

Tahap 1 dan 2 wireframe telah menerapkan app shell responsif, autentikasi, katalog, detail produk/toko, keranjang multi-vendor, alamat, RFQ, ongkir per toko, checkout, pesanan, payment handoff/status, tracking, komplain, dan refund. Audit per layar dan pekerjaan tahap berikutnya tersedia di [docs/wireframe-audit-2026-09-14.md](docs/wireframe-audit-2026-09-14.md).

## Menjalankan lokal

1. Gunakan Node.js 22.19 atau lebih baru dan pastikan backend berjalan pada `http://127.0.0.1:3001`.
2. Salin `.env.example` menjadi `.env` bila alamat backend berbeda.
3. Jalankan `npm install` lalu `npm run dev`.
4. Buka `http://localhost:3000`.

Browser memanggil `/api/v1` pada origin Nuxt. Development proxy meneruskan request ke Fastify dengan `Origin` browser tetap dipertahankan, sehingga cookie HttpOnly dan pemeriksaan CSRF bekerja seperti deployment same-origin. Pada production, reverse proxy/CDN harus meneruskan `/api/v1` ke backend.

## Mode offline lokal

Client API otomatis memakai `localStorage` dengan key `niaga:offline:v1` ketika backend tidak dapat dijangkau atau mengembalikan error 5xx. Respons GET katalog publik yang pernah berhasil diprioritaskan sebagai cache terakhir. Bila cache belum ada, seed lokal menyediakan 6 kategori, 18 produk, toko demo, akun pembeli demo, keranjang, dan alamat. Banner di bagian atas halaman menunjukkan sumber data serta jumlah perubahan yang menunggu sinkronisasi.

Perubahan profil, keranjang, dan alamat berbasis JSON dapat dikerjakan secara lokal dan masuk antrean. Ketika backend pulih, frontend mengambil CSRF baru, membuat ulang HMAC request, mempertahankan `Idempotency-Key`, lalu mengirim antrean secara berurutan. Konflik autentikasi atau versi tetap berada di antrean agar tidak menimpa data server. Upload file, checkout, pembayaran, refund, dan operasi finansial tidak dijalankan offline.

Jalankan `npm run check` untuk membangkitkan ulang tipe OpenAPI, memeriksa TypeScript, menjalankan unit test client, dan membangun output Nuxt production. Alur pembeli tahap 2 tersedia pada `/akun/keranjang`, `/akun/checkout`, `/akun/alamat`, `/akun/rfq`, `/akun/pesanan`, `/akun/pembayaran/{id}`, `/akun/pengiriman/{id}`, `/akun/kasus/{id}`, dan `/akun/refund`.

Smoke test HTTP browser-like tersedia melalui `npm run test:integration`. Isi `TEST_DATABASE_URL` dengan database terisolasi berakhiran `_test` yang sudah dimigrasikan. Tes menjalankan Fastify pada port acak dan memeriksa register, rotasi cookie saat login, `/me`, pembaruan CSRF, serta logout.

Gunakan `useMarketplaceApi()` untuk akses penuh yang typed. `useAuth()` menyediakan `load`, `login`, `register`, dan `logout`. Mutation otomatis mengambil CSRF bila belum tersedia dan mengirim `credentials: include`; client mempertahankan `Idempotency-Key` yang diberikan caller atau membuat UUID baru. Gunakan `versionHeaders(rowVersion)` saat endpoint meminta `If-Match`.
