# Arsitektur Teknologi Marketplace Multi-vendor yang Ringan

**Web app responsif untuk pembeli, vendor, dan admin**  
Versi 0.2 · 6 September 2026  
Acuan: SRS v0.2, ERD v0.1, OpenAPI v0.1, dan Wireframe UI/UX v0.1

Dokumen ini mendefinisikan teknologi, bentuk arsitektur, pola deployment, optimasi performa, keamanan, observability, serta rencana scaling untuk marketplace multi-vendor. Sasaran utamanya adalah akses cepat dari Indonesia dengan beban origin server serendah mungkin tanpa mengurangi konsistensi transaksi.

## 1. Keputusan arsitektur

Gunakan **modular monolith** pada fase awal. Aplikasi dibagi menjadi modul bisnis yang jelas, tetapi masih dijalankan sebagai satu API dan satu worker. Pendekatan ini lebih ringan dan lebih mudah dioperasikan daripada microservices.

Keputusan utama:

| Area | Pilihan |
| --- | --- |
| Frontend | Nuxt + Vue + TypeScript |
| UI | Tailwind CSS |
| Backend REST API | Node.js + Fastify + TypeScript |
| Arsitektur aplikasi | Modular monolith |
| ORM/query builder | Drizzle ORM dengan driver `mysql2` |
| Database development | MySQL-compatible melalui XAMPP |
| Database staging/production | MySQL 8 dengan InnoDB |
| Connection pool | Pool bawaan `mysql2`; ProxySQL opsional saat skala besar |
| Cache dan session | Redis atau Valkey |
| Background job | BullMQ |
| Penyimpanan file | Object storage kompatibel S3, misalnya Cloudflare R2 |
| Distribusi aset | CDN + image resizing |
| Reverse proxy | Caddy atau Nginx |
| Container | Docker Compose |
| CI/CD | GitHub Actions |
| Monitoring | OpenTelemetry, metrics, logs, dan error tracking |

## 2. Tujuan nonfungsional

| Sasaran | Target awal |
| --- | --- |
| Availability | Minimal 99,5% pada fase awal |
| Waktu respons API baca | p95 ≤ 500 ms di luar waktu provider eksternal |
| Waktu respons API tulis | p95 ≤ 800 ms di luar waktu provider eksternal |
| Largest Contentful Paint | ≤ 2,5 detik pada koneksi mobile yang wajar |
| Interaction to Next Paint | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0,1 |
| Error rate aplikasi | < 1% dari request valid |
| Recovery Point Objective | Maksimal kehilangan data 15 menit |
| Recovery Time Objective | Pemulihan layanan utama ≤ 4 jam |

Target diukur dari production monitoring dan dapat diperketat setelah baseline trafik tersedia.

## 3. Topologi sistem

```mermaid
flowchart TD
    U["Browser pengguna"] --> E["CDN, DNS, WAF"]
    E --> WEB["Nuxt Web"]
    WEB --> API["Fastify REST API"]
    API --> POOL["mysql2 Connection Pool"]
    POOL --> DB["MySQL / XAMPP Development"]
    API --> CACHE["Redis atau Valkey"]
    API --> QUEUE["BullMQ"]
    QUEUE --> WORKER["Background Worker"]
    API --> OBJ["Object Storage"]
    WORKER --> EXT["Payment, kurir, email"]
```

Prinsip aliran request:

1. CDN melayani aset statis, gambar, dan halaman yang dapat di-cache.
2. Nuxt hanya melakukan server rendering untuk halaman publik yang memerlukannya.
3. Dashboard pembeli, vendor, dan admin bekerja sebagai aplikasi client-side setelah autentikasi.
4. Fastify menangani aturan bisnis dan transaksi.
5. Pekerjaan lambat dijalankan oleh worker.
6. Gambar diunggah langsung dari browser ke object storage.

## 4. Frontend web

### 4.1 Teknologi

- Nuxt dan Vue untuk web app.
- TypeScript dengan mode strict.
- Tailwind CSS untuk sistem styling.
- Pinia hanya untuk state lintas halaman yang benar-benar diperlukan.
- TanStack Query atau `useFetch` Nuxt untuk server state dan cache browser.
- Zod atau schema yang dihasilkan dari OpenAPI untuk validasi client.
- TipTap sebagai rich text editor deskripsi produk.
- Uppy atau FilePond untuk multiple upload drag-and-drop.

### 4.2 Strategi rendering

Jangan menjalankan SSR pada semua route.

| Route | Mode | Cache awal |
| --- | --- | --- |
| `/` | Prerender | CDN panjang, revalidate saat konten berubah |
| `/kategori/**` | SSR dengan SWR | 1–5 menit |
| `/produk/**` | SSR dengan SWR | 1–5 menit |
| `/toko/**` | SSR dengan SWR | 5–15 menit |
| `/kebijakan/**` | Prerender | Sampai versi konten berubah |
| `/login`, `/register` | CSR/static shell | Tidak menyimpan data sensitif di cache publik |
| `/akun/**` | CSR | `private, no-store` untuk transaksi sensitif |
| `/vendor/**` | CSR | `private, no-store` |
| `/admin/**` | CSR | `private, no-store` |

Nuxt mendukung prerender dan hybrid rendering melalui route rules. Dokumentasi: [Nuxt Prerendering](https://nuxt.com/docs/4.x/getting-started/prerendering) dan [Nuxt Performance](https://nuxt.com/docs/4.x/guide/best-practices/performance).

### 4.3 Batas performa frontend

| Item | Batas awal |
| --- | --- |
| JavaScript awal halaman publik | Ideal ≤ 200 KB gzip |
| CSS awal | Ideal ≤ 60 KB gzip |
| Hero image | ≤ 200 KB setelah kompresi |
| Thumbnail produk | 20–80 KB per gambar |
| Font | Maksimal dua keluarga dan empat weight |
| Third-party script | Hanya setelah consent atau interaksi bila memungkinkan |

Gunakan lazy loading untuk gambar di bawah fold, route-level code splitting, dan dynamic import untuk editor, chart, serta komponen admin yang berat.

## 5. Backend API

### 5.1 Teknologi

Gunakan Fastify karena memiliki core minimal, validasi berbasis JSON Schema, dukungan TypeScript, dan overhead rendah. Dokumentasi: [Fastify](https://fastify.dev/) dan [Fastify Technical Principles](https://fastify.dev/docs/latest/Reference/Principles/).

### 5.2 Struktur modular

```text
apps/
├── storefront/              # Nuxt untuk pembeli
├── backoffice/              # Nuxt untuk vendor dan admin
├── api/                     # Fastify REST API
└── worker/                  # BullMQ worker

packages/
├── auth/
├── identity/
├── catalog/
├── inventory/
├── cart/
├── rfq/
├── checkout/
├── order/
├── payment/
├── shipping/
├── tax/
├── refund/
├── dispute/
├── payout/
├── notification/
├── audit/
└── shared/
```

Setiap modul memiliki route, schema, service, repository, event, test, dan policy akses sendiri. Modul tidak boleh mengakses tabel milik modul lain secara sembarang; gunakan service atau kontrak internal.

### 5.3 Aturan API

- Semua endpoint menggunakan prefix `/api/v1`.
- Validasi request dilakukan sebelum service bisnis dijalankan.
- Error memakai format konsisten dan menyertakan request ID.
- Pagination menggunakan cursor untuk data besar.
- Mutation kritis menerima `Idempotency-Key`.
- Webhook diverifikasi menggunakan signature provider.
- Waktu disimpan dalam UTC dan ditampilkan sesuai zona pengguna.
- Nilai uang disimpan sebagai integer satuan terkecil atau numeric presisi tetap.
- Jangan menggunakan floating point untuk nominal transaksi.

## 6. Database

### 6.1 MySQL melalui XAMPP untuk development

Pada fase development, gunakan service database yang tersedia pada XAMPP. Beberapa distribusi XAMPP menampilkan nama service **MySQL** tetapi menggunakan MariaDB yang kompatibel dengan protokol MySQL. Karena itu, schema awal harus memakai fitur SQL yang kompatibel dengan keduanya. Untuk staging dan production, target resminya adalah **MySQL 8 dengan storage engine InnoDB**.

XAMPP hanya digunakan pada komputer developer. Apache dan PHP tidak dibutuhkan oleh Nuxt atau Fastify; cukup hidupkan service database. phpMyAdmin boleh digunakan sebagai alat administrasi lokal dan tidak boleh diekspos ke internet.

Konfigurasi lokal:

| Item | Nilai awal |
| --- | --- |
| Host native Node.js | `127.0.0.1` |
| Host dari Docker Desktop | `host.docker.internal` |
| Port | `3306` |
| Database | `marketplace_dev` |
| Character set | `utf8mb4` |
| Collation kompatibel | `utf8mb4_unicode_ci` |
| Time zone aplikasi | UTC |
| Storage engine | InnoDB |

Jangan menggunakan akun `root` tanpa password untuk aplikasi. Buat user khusus development dengan hak hanya pada `marketplace_dev`.

Contoh environment development:

```dotenv
DATABASE_URL=mysql://marketplace_app:change-this-local-password@127.0.0.1:3306/marketplace_dev
DATABASE_CONNECTION_LIMIT=10
DATABASE_TIMEZONE=Z
```

File `.env` harus masuk `.gitignore`. Nilai pada contoh bukan credential production.

### 6.2 Drizzle ORM dan driver

Gunakan Drizzle ORM dengan dialect `mysql-core` dan driver `mysql2`. Migrasi schema dikelola dengan Drizzle Kit dan dijalankan melalui pipeline, bukan melalui perubahan manual phpMyAdmin.

Aturan tipe data:

| Kebutuhan | Tipe MySQL |
| --- | --- |
| ID UUID biasa | `CHAR(36)`; optimalkan menjadi `BINARY(16)` bila diperlukan |
| Nominal satuan terkecil | `BIGINT` |
| Nilai desimal/pajak | `DECIMAL(19,4)` atau skala sesuai kebutuhan |
| Waktu | `DATETIME(3)` dalam UTC |
| Status | `VARCHAR` + validasi aplikasi; hindari perubahan `ENUM` yang sering |
| Metadata fleksibel | `JSON` jika didukung target development dan production |
| Deskripsi panjang | `LONGTEXT` yang sudah disanitasi |

### 6.3 Konsistensi transaksi

MySQL menjadi sumber kebenaran untuk akun, toko, produk, stok, pesanan, pembayaran, refund, pajak, jurnal, dan payout.

Pengaturan utama:

- Semua tabel transaksi menggunakan InnoDB.
- Tambahkan foreign key dan unique constraint untuk identifier bisnis.
- Gunakan transaksi database untuk checkout, reservasi stok, refund, dan payout.
- Gunakan `SELECT ... FOR UPDATE` ketika mengunci stok atau saldo dalam transaksi pendek.
- Gunakan optimistic locking atau kolom `version` pada data yang sering diedit.
- Tetapkan urutan penguncian yang konsisten dan retry terbatas untuk deadlock.
- Indeks dibuat berdasarkan pola query nyata, bukan pada semua kolom.
- Query laporan berat diproses secara asinkron.
- Jangan menggunakan `FLOAT` atau `DOUBLE` untuk nominal uang.

### 6.4 Connection pooling

Gunakan pool bawaan driver `mysql2` pada API dan worker. Tetapkan batas rendah terlebih dahulu, misalnya 10 koneksi per proses, kemudian sesuaikan berdasarkan jumlah instance dan kapasitas MySQL.

Rumus batas awal:

```text
total koneksi aplikasi = (pool API × instance API) + (pool worker × instance worker)
```

Sisakan koneksi untuk migration, monitoring, backup, dan administrasi. ProxySQL belum diperlukan pada MVP; pertimbangkan hanya ketika jumlah instance, read/write routing, atau kebutuhan high availability meningkat.

### 6.5 Strategi pencarian

Fase awal:

- Gunakan indeks biasa untuk SKU, slug, status, vendor, kategori, dan harga.
- Gunakan MySQL `FULLTEXT` pada nama dan deskripsi produk untuk pencarian teks dasar.
- Gunakan `LIKE` hanya untuk dataset kecil atau pencarian prefix yang memiliki indeks sesuai.
- Cache hasil pencarian populer dalam durasi pendek.
- Normalisasi keyword produk pada kolom pencarian yang terkontrol.

Gunakan Meilisearch, OpenSearch, atau Elasticsearch hanya jika kebutuhan typo tolerance, ranking, synonym, faceting, dan volume katalog sudah melampaui kemampuan MySQL. Jangan menambah search cluster pada MVP.

### 6.6 Perbedaan development dan production

| Area | Development | Staging/production |
| --- | --- | --- |
| Server database | XAMPP MySQL/MariaDB-compatible | MySQL 8 |
| Lokasi | Laptop developer | Private network/managed database |
| Credential | User khusus database development | Secret manager, user per layanan |
| Backup | Dump saat diperlukan | Otomatis, terenkripsi, diuji restore |
| High availability | Tidak wajib | Sesuai target availability |
| Akses admin | localhost | Bastion/VPN atau console provider |

Sebelum rilis, jalankan integration test pada MySQL 8 yang versinya sama dengan production. Hal ini mencegah perbedaan perilaku SQL antara database XAMPP dan MySQL production.

### 6.7 Penyesuaian dokumen dan schema terkait

Perubahan database tidak mengubah kontrak REST API, tetapi tipe fisik pada dokumen ERD dan migration perlu disesuaikan.

| Konsep sebelumnya | Implementasi MySQL-compatible |
| --- | --- |
| UUID native | `CHAR(36)` atau `BINARY(16)` |
| `JSONB` | `JSON` |
| `TIMESTAMPTZ` | `DATETIME(3)` UTC; timezone ditangani aplikasi |
| `BIGSERIAL`/sequence | `BIGINT AUTO_INCREMENT` atau ID aplikasi |
| Boolean native | `BOOLEAN`/`TINYINT(1)` dengan nilai 0/1 |
| Numeric uang | `DECIMAL(19,4)` atau `BIGINT` satuan terkecil |
| Partial index | Ubah menjadi composite index, generated column, atau query redesign |
| PostgreSQL full-text | MySQL `FULLTEXT` |

Checklist kompatibilitas:

- [ ] Semua tabel menggunakan InnoDB.
- [ ] Nama tabel dan kolom konsisten lowercase `snake_case`.
- [ ] Foreign key memiliki tipe, panjang, dan collation yang sama.
- [ ] Migration diuji pada database XAMPP dan MySQL 8 staging.
- [ ] SQL mentah tidak menggunakan syntax khusus PostgreSQL.
- [ ] Transaction test mencakup deadlock, rollback, dan concurrent stock update.
- [ ] OpenAPI tetap menggunakan format UUID/ISO datetime pada level API meskipun penyimpanan fisiknya berbeda.

## 7. Cache, session, dan antrean

### 7.1 Redis atau Valkey

Gunakan untuk:

- Session server-side.
- Rate limiting.
- Cache kategori, toko, produk, dan hasil pencarian.
- Distributed lock terbatas.
- Penyimpanan job BullMQ.
- Token sekali pakai dengan TTL.

Redis bukan sumber kebenaran untuk pembayaran, stok final, refund, dan payout.

### 7.2 Kebijakan cache

| Data | Lokasi | TTL awal | Invalidation |
| --- | --- | --- | --- |
| Kategori | CDN + Redis | 1–24 jam | Saat admin mengubah kategori |
| Detail produk | CDN + Redis | 1–5 menit | Saat produk/harga berubah |
| Profil toko | CDN + Redis | 5–15 menit | Saat profil/moderasi berubah |
| Hasil pencarian populer | Redis | 1–5 menit | TTL |
| Opsi ongkir | Redis | 5–30 menit | TTL dan perubahan tujuan |
| Session | Redis | Sesuai masa login | Logout/revoke |
| Status pembayaran | Database | Tidak mengandalkan cache | Webhook/reconciliation |
| Stok final | Database | Cache sangat singkat | Setiap perubahan stok |

### 7.3 Background job

BullMQ menjalankan:

- Pengiriman email dan notifikasi.
- Pemrosesan webhook.
- Sinkronisasi status payment dan shipment.
- Rekonsiliasi transaksi.
- Pembuatan laporan dan ekspor.
- Moderasi atau pemrosesan gambar.
- Perhitungan payout.
- Retry request provider eksternal.

Setiap job wajib memiliki retry terbatas, exponential backoff, timeout, idempotency key, dead-letter handling, dan pencatatan hasil.

## 8. Upload dan penyajian gambar

### 8.1 Direct upload

Jangan mengirim file besar melalui API utama.

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant O as Object Storage
    B->>A: Minta presigned upload URL
    A-->>B: URL, object key, batas file
    B->>O: Upload langsung
    B->>A: Konfirmasi object key
    A->>A: Validasi dan simpan metadata
    A-->>B: Media tercatat
```

Cloudflare R2 merupakan object storage kompatibel S3 untuk data tidak terstruktur. Custom domain dapat digunakan agar objek melewati cache CDN. Dokumentasi: [Cloudflare R2](https://developers.cloudflare.com/r2/) dan [R2 Cache](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/).

### 8.2 Validasi upload

- Maksimal 10 gambar per produk pada konfigurasi awal.
- Format input: JPEG, PNG, WebP; AVIF bila alur pemrosesan mendukung.
- Ukuran maksimum awal: 10 MB per file.
- Validasi MIME berdasarkan isi file, bukan ekstensi saja.
- Gunakan nama object acak, bukan nama asli pengguna.
- Bersihkan metadata EXIF sensitif.
- Scan file/dokumen berisiko sebelum dipublikasikan.
- Simpan checksum untuk mendeteksi upload rusak atau duplikat.

### 8.3 Turunan gambar

| Varian | Ukuran | Pemakaian |
| --- | --- | --- |
| Thumbnail | 160 × 160 px | Tabel dan mini cart |
| Card | 400 × 400 px | Katalog |
| Detail | 800 × 800 px | Halaman produk |
| Zoom | Maksimal 1600 × 1600 px | Zoom produk |
| Banner | 1200 × 480 px | Beranda |

Gunakan WebP/AVIF berdasarkan dukungan browser. Tetapkan `width`, `height`, dan aspect ratio agar layout tidak bergeser saat gambar dimuat.

## 9. Integrasi eksternal

### 9.1 Pembayaran

Adaptor payment gateway ditempatkan di modul payment. Implementasi provider tidak boleh tersebar di checkout atau order.

Alur aman:

1. API membuat payment attempt dengan idempotency key.
2. Pengguna diarahkan atau menampilkan instruksi provider.
3. Provider mengirim webhook.
4. API memverifikasi signature dan menyimpan event mentah.
5. Worker memproses event secara idempotent.
6. Status internal diperbarui hanya setelah verifikasi.
7. Status ambigu masuk rekonsiliasi, bukan langsung dianggap gagal.

### 9.2 Pengiriman

Gunakan shipping aggregator atau API kurir melalui adaptor yang sama. Cache quotation sebentar, tetapi validasi ulang sebelum order shipment dibuat.

### 9.3 Ketahanan integrasi

- Timeout eksplisit untuk setiap provider.
- Retry hanya untuk operasi yang aman atau idempotent.
- Circuit breaker untuk gangguan provider berulang.
- Simpan request/response yang sudah disanitasi.
- Jangan menampilkan credential atau response mentah provider kepada pengguna.
- Gunakan polling/reconciliation bila webhook terlambat.

## 10. Deployment

### 10.1 Lingkungan

| Lingkungan | Tujuan |
| --- | --- |
| Local | Nuxt/Fastify lokal, MySQL-compatible dari XAMPP, Redis dapat melalui Docker |
| Development | Integrasi harian dengan data dummy dan database terpisah |
| Staging | UAT, sandbox provider, dan pengujian migrasi |
| Production | Transaksi nyata dan data terproteksi |

Credential dan database tidak boleh digunakan silang antar lingkungan.

### 10.2 Container produksi awal

```text
reverse-proxy
storefront-web
backoffice-web
api
worker
mysql
redis-or-valkey
```

Daftar tersebut berlaku untuk deployment server. Pada komputer developer yang menggunakan XAMPP, container `mysql` tidak dijalankan agar tidak berebut port `3306`. Object storage, CDN, DNS, email, payment, dan shipping berada di luar VPS.

### 10.3 Pola development dengan XAMPP

```mermaid
flowchart LR
    B["Browser"] --> N["Nuxt dev server"]
    N --> A["Fastify API"]
    A --> X["XAMPP MySQL-compatible :3306"]
    A --> R["Redis Docker atau lokal"]
    A --> O["Object storage dev"]
```

Langkah operasional development:

1. Jalankan service MySQL pada XAMPP.
2. Buat database `marketplace_dev` dan user aplikasi khusus.
3. Isi `DATABASE_URL` pada `.env` lokal.
4. Jalankan migration Drizzle.
5. Jalankan seed data development.
6. Jalankan Redis/Valkey bila modul session, cache, atau queue sedang diuji.
7. Jalankan Fastify, worker, storefront, dan backoffice.

Jika API dijalankan di dalam Docker Desktop, gunakan `host.docker.internal` sebagai database host. Jika API dijalankan langsung melalui Node.js di Windows, gunakan `127.0.0.1`.

### 10.4 Spesifikasi server

#### Development atau demo

- 2 vCPU.
- RAM 4 GB.
- NVMe 60–80 GB.
- XAMPP hanya untuk development lokal; aplikasi Node.js dapat berjalan native.
- Tidak untuk transaksi produksi berskala besar.

#### Produksi awal minimum

- Application server: 4 vCPU dan RAM 8 GB.
- MySQL 8 terkelola atau server database terpisah: 2–4 vCPU dan RAM 4–8 GB.
- Object storage eksternal.
- CDN dan WAF aktif.
- Backup otomatis di lokasi berbeda.

#### Produksi bertumbuh

- Dua instance API di belakang load balancer.
- Worker terpisah dan dapat ditambah horizontal.
- MySQL primary dengan binary log, backup/PITR, dan read replica bila dibutuhkan.
- Redis terkelola atau instance terpisah.
- Autoscaling hanya setelah metrik dan bottleneck diketahui.

Pilih region Jakarta jika kualitas penyedia memadai; Singapura merupakan alternatif. Lakukan pengukuran latency dari wilayah pengguna utama sebelum keputusan final.

## 11. Reverse proxy dan CDN

Reverse proxy menangani:

- HTTPS dan redirect HTTP ke HTTPS.
- HTTP/2; HTTP/3 dapat dilayani CDN.
- Brotli/gzip.
- Request body limit.
- Proxy timeout.
- Security header.
- Static asset caching.
- Request ID forwarding.

CDN menangani:

- Cache aset dengan nama file ber-hash.
- Cache halaman publik sesuai kebijakan.
- Image resizing.
- Proteksi DDoS/WAF dasar.
- Rate limit pada endpoint publik berisiko.

Jangan cache response pengguna, checkout, pembayaran, rekening, atau data admin pada cache publik.

## 12. Keamanan

### 12.1 Kontrol aplikasi

- Hash password dengan Argon2id atau algoritma kuat yang disetujui.
- Session cookie `HttpOnly`, `Secure`, dan `SameSite` yang sesuai.
- CSRF protection untuk autentikasi berbasis cookie.
- RBAC dan pemeriksaan kepemilikan resource pada server.
- MFA wajib untuk admin sensitif dan checker payout.
- Rate limit untuk login, reset password, OTP, dan pembuatan payment.
- Content Security Policy untuk membatasi script dan frame.
- Sanitasi HTML dari rich text editor menggunakan allowlist.
- Enkripsi secret dan data sensitif saat transit dan tersimpan.
- Audit log append-only untuk tindakan kritis.

### 12.2 Pemisahan akses

| Komponen | Akses |
| --- | --- |
| MySQL production | Hanya API, worker, migration job, dan operator terbatas |
| XAMPP MySQL-compatible | Hanya localhost atau jaringan development tepercaya |
| Redis/Valkey | Jaringan privat; tanpa akses internet publik |
| Admin web | Login, MFA, RBAC, dan audit |
| Object storage private | Presigned URL atau CDN policy |
| Dashboard provider | Akun individual dan MFA |
| Production shell | Personel terbatas dan tercatat |

### 12.3 Secret management

Jangan memasukkan secret ke repository atau image container. Gunakan secret manager atau environment variable yang dikelola platform. Rotasi credential provider dan database secara berkala serta setelah insiden.

## 13. Observability

Setiap request memperoleh correlation/request ID yang diteruskan ke API, worker, dan integrasi.

### 13.1 Metrics

- Request rate, error rate, dan latency per endpoint.
- CPU, RAM, disk, dan network.
- MySQL active connections, query latency, slow queries, InnoDB lock waits, buffer pool, dan replication lag.
- Redis memory, eviction, hit ratio, dan latency.
- Queue depth, job latency, retry, dan failure.
- Payment webhook delay dan reconciliation backlog.
- Shipping API latency dan error rate.

### 13.2 Logs

- Gunakan structured JSON logs.
- Masking token, password, rekening, identitas, dan payload sensitif.
- Pisahkan audit log dari application debug log.
- Tetapkan retention sesuai kebutuhan operasional dan regulasi.
- Jangan mencatat seluruh request body secara default.

### 13.3 Alert minimum

| Kondisi | Alert |
| --- | --- |
| Error API meningkat | Error rate melewati ambang selama beberapa menit |
| API lambat | p95 melebihi SLO |
| Disk hampir penuh | Penggunaan > 80% |
| Database connection tinggi | Pool mendekati batas |
| Queue tertunda | Job tertua melewati SLA |
| Webhook gagal | Gagal berulang atau backlog naik |
| Backup gagal | Satu jadwal backup tidak berhasil |
| Certificate/DNS bermasalah | Masa berlaku atau health check gagal |

## 14. Backup dan disaster recovery

- Backup MySQL harian; gunakan binary log untuk PITR bila tersedia.
- Development XAMPP dapat memakai `mysqldump`, tetapi dump lokal bukan pengganti backup production.
- Simpan backup di akun atau lokasi berbeda dari server utama.
- Object storage mengaktifkan versioning atau lifecycle yang sesuai.
- Konfigurasi deployment disimpan sebagai code.
- Uji restore secara berkala; backup tanpa uji restore belum dianggap valid.
- Dokumentasikan langkah failover DNS, pemulihan database, dan rotasi secret.
- Audit hasil uji terhadap RPO dan RTO.

## 15. CI/CD

Pipeline minimum:

```mermaid
flowchart LR
    A["Pull request"] --> B["Lint dan typecheck"]
    B --> C["Unit dan integration test"]
    C --> D["Build image"]
    D --> E["Security scan"]
    E --> F["Deploy staging"]
    F --> G["Smoke test"]
    G --> H["Approval production"]
```

Aturan deployment:

- Migration database harus backward-compatible.
- Backup/checkpoint dilakukan sebelum migration berisiko.
- Deploy menggunakan immutable image tag.
- Health check dan readiness check wajib.
- Rollback aplikasi tidak boleh merusak schema database.
- Production deploy dicatat pada audit operasional.

## 16. Strategi scaling

Scaling dilakukan berdasarkan metrik, bukan dugaan.

| Tahap | Perubahan |
| --- | --- |
| 1 | Satu app server, database terpisah, CDN dan object storage |
| 2 | Pisahkan worker dan Redis |
| 3 | Tambah instance API di belakang load balancer |
| 4 | Tambah MySQL read replica untuk laporan/baca yang sesuai |
| 5 | Pisahkan search engine jika MySQL tidak mencukupi |
| 6 | Pecah service hanya untuk domain dengan kebutuhan scaling independen |

Urutan bottleneck yang perlu diperiksa:

1. Query dan indeks database.
2. Ukuran response dan gambar.
3. Cache miss.
4. Koneksi database.
5. Provider eksternal.
6. CPU/RAM aplikasi.
7. Baru kemudian jumlah instance.

## 17. Teknologi yang tidak diperlukan pada MVP

| Teknologi | Alasan ditunda |
| --- | --- |
| Kubernetes | Menambah beban operasional sebelum kebutuhan scaling nyata |
| Microservices penuh | Deployment, tracing, data consistency, dan failure mode lebih kompleks |
| Kafka | BullMQ cukup untuk job dan event volume awal |
| Elasticsearch/OpenSearch | MySQL `FULLTEXT` cukup untuk katalog awal |
| GraphQL | REST API sudah didefinisikan dan lebih sederhana dioperasikan |
| Service mesh | Belum ada banyak service yang membutuhkan pengelolaan jaringan kompleks |
| Self-hosted object storage di VPS | Menghabiskan disk, bandwidth, dan menambah risiko backup |

## 18. Struktur repository

```text
marketplace/
├── apps/
│   ├── storefront/
│   ├── backoffice/
│   ├── api/
│   └── worker/
├── packages/
│   ├── database/
│   ├── contracts/
│   ├── config/
│   ├── observability/
│   ├── security/
│   └── ui/
├── infrastructure/
│   ├── docker/
│   ├── proxy/
│   └── monitoring/
├── docs/
│   ├── srs/
│   ├── erd/
│   ├── api/
│   └── adr/
├── compose.yaml
├── package.json
└── pnpm-workspace.yaml
```

Gunakan monorepo agar kontrak API, tipe, komponen UI, dan konfigurasi dapat digunakan bersama tanpa membuat banyak repository.

## 19. Konfigurasi awal yang direkomendasikan

```text
Frontend          Nuxt + Vue + TypeScript
Styling           Tailwind CSS
Backend           Fastify REST API
Database access   Drizzle ORM
Database local    XAMPP MySQL/MariaDB-compatible
Database prod     MySQL 8 + InnoDB
Database driver   mysql2 connection pool
Cache/session     Redis atau Valkey
Background jobs   BullMQ
File storage      Cloudflare R2 atau S3-compatible storage
Edge              CDN + WAF
Reverse proxy     Caddy
Deployment        Docker Compose
CI/CD             GitHub Actions
```

Pemilihan Caddy atau Nginx tidak mengubah desain utama. Caddy lebih sederhana untuk HTTPS otomatis; Nginx tepat bila tim sudah memiliki konfigurasi operasional yang matang.

## 20. Checklist kesiapan produksi

### Aplikasi

- [ ] Semua input divalidasi di server.
- [ ] Endpoint mutation kritis idempotent.
- [ ] Permission dan ownership diuji.
- [ ] Rich text disanitasi.
- [ ] Pagination dan batas query diterapkan.
- [ ] Error tidak membocorkan detail internal.

### Infrastruktur

- [ ] HTTPS, CDN, WAF, dan security header aktif.
- [ ] Database dan Redis tidak terbuka ke internet.
- [ ] Health check dan restart policy aktif.
- [ ] Backup otomatis dan restore sudah diuji.
- [ ] Disk, RAM, CPU, dan koneksi database dimonitor.

### Transaksi

- [ ] Webhook signature diverifikasi.
- [ ] Event webhook disimpan dan diproses idempotent.
- [ ] Rekonsiliasi payment berjalan terjadwal.
- [ ] Status order, payment, shipment, refund, dan payout terpisah.
- [ ] Perhitungan uang dan pajak menggunakan presisi tetap.
- [ ] Audit trail tersedia untuk tindakan finansial.

### Performa

- [ ] Gambar melalui object storage dan CDN.
- [ ] Upload browser langsung ke object storage.
- [ ] Route publik menggunakan prerender/cache bila aman.
- [ ] Dashboard dan transaksi tidak masuk cache publik.
- [ ] Slow query dan bundle size diperiksa.
- [ ] Load test checkout, stok, webhook, dan katalog selesai.

## 21. Urutan implementasi

1. Siapkan monorepo, TypeScript, lint, test, dan CI.
2. Implementasikan autentikasi, RBAC, database, dan audit dasar.
3. Implementasikan katalog, toko, produk, gambar, dan persediaan.
4. Implementasikan cart, RFQ, checkout, order, pajak, dan komisi.
5. Integrasikan payment gateway dan webhook.
6. Integrasikan pengiriman dan tracking.
7. Implementasikan refund, komplain, hak vendor, dan payout.
8. Tambahkan monitoring, rekonsiliasi, backup, dan load test.
9. Lakukan security review dan UAT production-like.
10. Go-live bertahap dengan vendor dan pengguna terbatas.

## 22. Kesimpulan

Stack utama yang dipilih adalah **Nuxt + Fastify + MySQL + Redis/Valkey + BullMQ + object storage + CDN**. Untuk development, Fastify terhubung ke service MySQL-compatible dari XAMPP melalui driver `mysql2`; staging dan production menggunakan MySQL 8 InnoDB. Modular monolith menjaga penggunaan server dan kompleksitas operasional tetap rendah, sedangkan CDN, cache, direct upload, dan background worker mencegah VPS mengerjakan beban yang tidak perlu.

Arsitektur ini dapat dimulai dari satu application server dengan database terpisah, lalu ditingkatkan secara bertahap berdasarkan metrik tanpa menulis ulang seluruh sistem.
