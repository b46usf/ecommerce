# Implementasi ERD v0.1 untuk MySQL

Sumber: `../../ERD-Struktur-Tabel-Marketplace-v0.1.md`. Keputusan stack mengikuti `../../Arsitektur-Teknologi-Marketplace-Ringan-v0.1.md` versi isi 0.2: MySQL 8/InnoDB untuk production, MariaDB/XAMPP untuk development.

## Pemetaan domain

| Domain | Tabel ERD |
| --- | --- |
| Identitas dan kepemilikan | users, auth_tokens, admin_grants, organizations, buyer_accounts, addresses, legal_entities, stores, store_members, store_origins |
| Pajak dan dokumen | tax_profiles, documents, tax_classes, tax_policies, fee_policies |
| Katalog dan persediaan | categories, products, product_media, skus, inventory_balances, inventory_movements |
| Penawaran dan keranjang | quote_requests, quote_request_lines, quote_versions, quote_lines, carts, cart_items |
| Checkout dan order | shipping_quotes, checkout_groups, vendor_orders, order_items, quote_redemptions, stock_reservations |
| Pembayaran dan pengiriman | provider_accounts, payment_attempts, payment_events, payment_receipts, payment_allocations, shipments, shipment_events |
| Refund dan kasus | refunds, refund_lines, order_cases |
| Ledger dan payout | ledger_accounts, journal_entries, journal_lines, vendor_payables, bank_accounts, payouts, payout_lines |
| Rekonsiliasi dan operasional | reconciliation_runs, reconciliation_items, idempotency_keys, outbox_events, audit_logs, notifications |

`src/database/schema.ts` mengekspor tabel dengan nama TypeScript camelCase dan nama SQL snake_case. `npm run db:erd:check` membandingkan seluruh nama tabel dan kolom kamus data dengan skema. Pemeriksaan ini menguji cakupan struktur; kebenaran transaksi diuji terpisah.

## Adaptasi tipe dan indeks

| ERD PostgreSQL | Implementasi |
| --- | --- |
| UUID | CHAR(36), UUID dibuat aplikasi |
| TIMESTAMPTZ | DATETIME(3); koneksi dan aplikasi UTC |
| JSONB | JSON, decoder kompatibel JSON native MySQL dan teks JSON MariaDB |
| BYTEA rahasia | Ciphertext AES-256-GCM tersimpan; HMAC terpisah untuk deduplikasi |
| Uang BIGINT | BIGINT; integer rupiah, dibatasi safe integer untuk API |
| NUMERIC rate/dimensi | DECIMAL dengan hasil driver string |
| Partial unique index | Kolom generated nullable ditambah unique index |
| PostgreSQL full text | FULLTEXT MySQL pada nama/deskripsi produk |
| Deferred constraint | Transaksi terkunci atau trigger pada titik finalisasi yang didukung |

Semua tabel memakai InnoDB dan utf8mb4_unicode_ci. FK tidak melakukan penghapusan transaksi secara cascade. Foreign key siklik dibuat setelah seluruh tabel tersedia. SQL custom disimpan sebagai migrasi Drizzle bersama snapshot; jangan memakai `drizzle-kit push` untuk melewati trigger dan migrasi custom.

## Tambahan implementasi

- `legal_entities.created_by` memberikan pemeriksaan ownership sebelum sebuah entitas memiliki toko.
- `upload_intents` menyimpan kepemilikan, ukuran, MIME, checksum, expiry, dan hasil verifikasi direct upload.
- Kolom generated mendukung keunikan bersyarat pada MySQL/MariaDB; kolom ini bukan input API.
- `idempotency_keys` menyimpan status HTTP, response terenkripsi, dan header untuk replay; referensi event bisnis tetap unik permanen.

## Batas transaksi

Skema, FK, CHECK, unique index, dan trigger merupakan fondasi. Aturan agregasi antartabel yang dijelaskan ERD tidak boleh diasumsikan selesai hanya karena tabel tersedia.

Sudah ada service transaksi untuk mutation katalog/stok/idempotensi dan posting jurnal internal. Posting jurnal memvalidasi debit/kredit dengan bigint dan memfinalisasi dalam satu transaksi. SQL menjaga log append-only dan imutabilitas jurnal setelah POSTED.

Endpoint RFQ, cart, checkout, payment, shipping, refund, kasus, jurnal, payable, dan payout memakai tabel ERD terkait. Alur kritis memeriksa scope buyer/vendor, snapshot historis, kapasitas refund/payout, status UNKNOWN provider, dan urutan lock transaksi. Periode kebijakan pajak/komisi dikunci dan diperiksa overlap saat diaktifkan. Migrasi tetap tidak menciptakan tarif bisnis default.

## Menjalankan migrasi

Isi `MIGRATION_DATABASE_URL` menggunakan user DDL yang terpisah, atau gunakan `DATABASE_URL` pada database development yang terisolasi. Jalankan `npm run db:migrate`; migrasi tercatat di `__drizzle_migrations` dan aman dijalankan kembali. MySQL menjalankan sebagian DDL dengan implicit commit: backup/checkpoint dan pemeriksaan hasil tetap diperlukan untuk migrasi production.

User runtime cukup mendapat SELECT/INSERT/UPDATE/DELETE pada database aplikasi. User migrasi memerlukan CREATE/ALTER/INDEX/REFERENCES/TRIGGER serta izin migrasi lainnya pada database tersebut. Jika binary logging MySQL membatasi pembuatan trigger, operator database harus mengatur izin/`log_bin_trust_function_creators` untuk job migrasi; aplikasi tidak mengubah konfigurasi server.

Integration test memakai database `_test` terpisah. Suite mengecek migrasi ulang, engine/collation/UTC, FK lintas toko, partial uniqueness, rollback, race stok, konsumsi token sekali pakai, audit, dan posting jurnal. Konfigurasi CI menyediakan MySQL 8 dan MariaDB; hasil lokal tidak boleh disebut sebagai hasil pengujian MySQL 8 jika hanya MariaDB yang dijalankan.
