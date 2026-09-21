# Deployment

## Topologi production yang disarankan

- Deploy `frontend` sebagai aplikasi Nuxt di Vercel.
- Deploy `backend` dan worker sebagai dua proses container dari image yang sama pada platform container.
- Gunakan MySQL/MariaDB dan Redis/Valkey terkelola, object storage S3-compatible, serta layanan ClamAV yang dapat dijangkau backend.
- Browser tetap mengakses `/api/v1`. Route server Nuxt meneruskan permintaan ke Fastify sehingga cookie sesi, CSRF, dan signature mutation tetap same-origin.

## Frontend di Vercel

Import repository ke Vercel dan atur **Root Directory** ke `frontend`. Nuxt akan terdeteksi otomatis. Tambahkan environment variable berikut untuk Production dan Preview:

```text
NUXT_API_SERVER_BASE=https://api.example.com/api/v1
NUXT_PUBLIC_API_BASE=/api/v1
NUXT_PUBLIC_OFFLINE_DEMO=false
NUXT_PUBLIC_CKEDITOR_LICENSE_KEY=GPL
```

Ganti license CKEditor bila distribusi aplikasi tidak memenuhi GPL. URL pada `NUXT_API_SERVER_BASE` hanya dipakai server Nuxt dan tidak diekspos ke browser.

## Backend dan worker

Gunakan `backend/Dockerfile` untuk service API dengan command bawaan dan image yang sama untuk worker dengan command `npm run start:worker`. Keduanya membutuhkan environment production dari `backend/.env.example`. Gunakan secret manager milik platform; jangan menaruh nilainya dalam repository atau image.

Setidaknya isi nilai production berikut:

```text
NODE_ENV=production
HOST=0.0.0.0
DATABASE_URL=...
REDIS_URL=...
SESSION_SECRET=...
AUTH_TOKEN_SECRET=...
DATA_ENCRYPTION_KEY=...
APP_ORIGINS=https://shop.example.com
PUBLIC_APP_URL=https://shop.example.com
PUBLIC_API_URL=https://shop.example.com
COOKIE_SECURE=true
TRUST_PROXY=true
```

Tambahkan konfigurasi SMTP, S3, payment, shipping, dan ClamAV sesuai fitur yang diaktifkan. Jalankan migrasi sekali sebagai release job sebelum mengalihkan trafik ke versi baru.

## GitHub Pages

GitHub Pages hanya menjalankan file statis. Workflow `Deploy frontend demo to GitHub Pages` membangun frontend dengan preset `github_pages` dan memaksa seed offline/localStorage. Hasilnya cocok untuk demo UI pada `https://b46usf.github.io/ecommerce/`, tetapi tidak menjalankan Fastify, worker, database, upload, payment, atau webhook.

Untuk menjalankannya, buka **Settings > Pages**, pilih **GitHub Actions** sebagai source, lalu jalankan workflow tersebut secara manual. Jika nama repository berubah, ubah `NUXT_APP_BASE_URL` di `.github/workflows/pages.yml`.

## Pemeriksaan sebelum release

```powershell
cd backend
npm ci
npm run check
npm run db:erd:check
npm run test:integration

cd ..\frontend
npm ci
npm run check
npm run test:integration
```

Aktifkan branch protection, Dependabot alerts, secret scanning, dan push protection dari pengaturan GitHub. Folder `.local` sebelumnya pernah tercatat dalam riwayat Git; rotasi semua secret atau sesi yang mungkin pernah tersimpan di sana sebelum deployment publik.
