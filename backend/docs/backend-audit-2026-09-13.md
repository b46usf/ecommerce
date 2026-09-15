# Audit backend marketplace — 2026-09-13

## Hasil

Implementasi backend memenuhi cakupan fungsi MVP pada kontrak OpenAPI v0.1 dan model data ERD v0.1. Seluruh operasi kontrak terdaftar sebagai route Fastify, schema database mencakup seluruh tabel dan kolom ERD, serta alur transaksi utama lulus terhadap MariaDB/InnoDB yang terisolasi.

Status ini belum menyatakan kesiapan production penuh. Kontrol dan infrastruktur production pada dokumen arsitektur tetap perlu diselesaikan dan diuji di lingkungan production-like.

## Cakupan yang diverifikasi

| Area | Hasil | Bukti |
| --- | --- | --- |
| OpenAPI | 121/121 `operationId` memiliki route aktif | `tests/app.test.ts` membandingkan dokumen kontrak dengan route yang diregistrasikan Fastify |
| Ekstensi API | 3 endpoint tambahan | direct upload media, konfirmasi upload asinkron, dan unduhan dokumen bertanda tangan |
| Swagger UI | Aktif | Dokumen statis berasal dari `contracts/openapi.yaml` dan tersedia melalui `/docs` |
| ERD | 56/56 tabel dan 424/424 kolom dokumen | `npm run db:erd:check` |
| Tabel infrastruktur | 1 tabel tambahan | `upload_intents`, untuk lifecycle direct upload |
| Database nyata | Lulus | 33 integration test terhadap MariaDB 10.4/InnoDB terisolasi |
| Unit/HTTP | Lulus | 51 test dalam 8 file |
| Kualitas build | Lulus | ESLint, TypeScript strict, dan production build |
| Dependency | Lulus | `npm audit --audit-level=high`: 0 vulnerability |
| Integrasi frontend | Lulus | Client Nuxt typed menjalankan register, login, `/me`, pembaruan CSRF, dan logout melalui HTTP nyata |

Alur database yang diuji mencakup migrasi idempotent, foreign key, constraint stok, transaksi dan rollback, lock konkurensi, append-only audit/ledger, idempotency request, isolasi tenant, pajak/komisi, refund, payout dengan dua approver, dispute, serta transisi order.

Alur provider yang diuji mencakup verifikasi signature dan nominal pembayaran, proteksi event duplikat/regresif, settlement atomik sampai receipt/jurnal/payable dan konsumsi stok, pembuatan shipment, serta rekonsiliasi. HTTP Midtrans dan Biteship menggunakan respons tiruan yang mengikuti payload provider; credential sandbox nyata tidak tersedia dalam audit lokal ini.

## Kesesuaian arsitektur

Backend menggunakan modular monolith Fastify dan satu worker BullMQ. MySQL/MariaDB melalui `mysql2` dan Drizzle menjadi sumber data utama. Redis/Valkey menangani session, rate limit, cache, dan antrean. File privat dan media menggunakan API S3-compatible; pipeline media mendukung validasi file, ClamAV, dan turunan gambar. Integrasi pembayaran dan pengiriman berjalan melalui outbox/worker dengan idempotency dan rekonsiliasi.

Docker Compose tersedia untuk Valkey dan MySQL 8, sedangkan development lokal dapat memakai XAMPP MariaDB. Konfigurasi production menolak origin non-HTTPS, cookie tidak aman, dan secret default.

## Gap menuju production

- MFA untuk admin sensitif dan checker payout belum mempunyai kontrak endpoint pada OpenAPI v0.1 dan belum diimplementasikan.
- OpenTelemetry, metrics, dashboard, alert, serta error tracking belum dipasang.
- Backup/PITR dan prosedur restore belum dijalankan serta dibuktikan.
- Integration suite lokal memakai MariaDB 10.4. Validasi ulang pada MySQL 8 yang sama dengan target production tetap diperlukan.
- Redis/Valkey, BullMQ, S3-compatible storage, SMTP, ClamAV, Midtrans sandbox, dan Biteship sandbox belum diuji end-to-end bersama sebagai stack eksternal nyata pada audit ini.
- Load test, security review, dan UAT production-like masih diperlukan sesuai checklist arsitektur.

## Integrasi frontend

Frontend menggunakan `openapi-typescript` dan `openapi-fetch` dengan sumber kontrak root. Tipe dibangkitkan ulang pada typecheck dan build. Client mempertahankan cookie browser, mengelola pre-session CSRF serta rotasi session, menambahkan idempotency key, menormalisasi error beserta request ID, dan menyediakan header versi untuk optimistic locking. Backend memuat kontrak relatif terhadap modul sehingga API dapat dijalankan dari working directory frontend, test, container, atau process manager.

## Perintah reproduksi

```powershell
npm run check
npm run db:erd:check
npm audit --audit-level=high
node --env-file=.local/test-database.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
```

`TEST_DATABASE_URL` harus menunjuk database khusus dengan nama berakhiran `_test` agar integration test tidak dapat diarahkan ke database aplikasi.
