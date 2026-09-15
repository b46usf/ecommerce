# Keamanan komunikasi dan data

## Komunikasi browser ke API

HTTPS/TLS menyediakan kerahasiaan dan autentikasi kanal. Pada production, backend menolak request `/api/v1` yang tidak terbaca sebagai HTTPS, mengaktifkan HSTS satu tahun, dan mewajibkan `COOKIE_SECURE=true` serta `TRUST_PROXY=true`. Reverse proxy harus menjadi satu-satunya jalur publik ke Fastify dan meneruskan `X-Forwarded-Proto: https`.

Mutation JSON juga ditandatangani oleh frontend melalui Web Crypto. Setelah mengambil token dari `GET /auth/csrf`, client mengirim:

- `X-Request-Timestamp`: waktu Unix dalam milidetik;
- `X-Request-Nonce`: 16 byte acak dalam base64url;
- `X-Request-Signature`: HMAC-SHA-256 dalam base64url.

Payload tanda tangan adalah nilai berikut yang dipisahkan newline:

```text
v1
timestamp
nonce
HTTP_METHOD
URL_PATH
SORTED_QUERY_STRING
SHA256_BASE64URL(CANONICAL_JSON_BODY)
```

Token CSRF session menjadi kunci HMAC. Backend menghitung ulang seluruh nilai dengan `node:crypto`, membandingkan signature secara konstan, menerima selisih waktu maksimal lima menit, lalu menyimpan hash token dan nonce di Redis dengan operasi atomik `SET ... EX 300 NX`. Pengulangan nonce ditolak dengan `409 REQUEST_REPLAYED`. Header signature wajib pada production; mode development dan test tetap menerima client non-browser agar tooling lokal dan webhook simulator tetap praktis.

Multipart tidak memakai signature body karena streaming file tidak boleh dibaca dua kali. Upload tetap dilindungi HTTPS, pemeriksaan Origin, CSRF, batas ukuran dan jumlah, deteksi MIME, decoding gambar terbatas, serta ClamAV. Webhook provider menggunakan verifikasi signature provider dan tidak masuk protokol browser ini.

## Enkripsi data tersimpan

Nilai sensitif memakai AES-256-GCM dari `node:crypto`. Format baru `v2` menggunakan IV acak 96 bit, authentication tag 128 bit, kunci turunan HMAC-SHA-256 per konteks, dan AAD yang mengikat konteks seperti `tax-identifier`, `bank-account-number`, `payment-session`, serta payload provider. Ciphertext yang dipindahkan ke field dengan konteks berbeda gagal didekripsi.

Backend masih dapat membaca ciphertext `v1` untuk migrasi tanpa downtime, sementara semua write baru menghasilkan `v2`. Fingerprint pencarian tetap memakai format lama agar constraint dan pencarian terhadap row yang sudah ada tidak putus. `DATA_ENCRYPTION_KEY`, `SESSION_SECRET`, dan `AUTH_TOKEN_SECRET` wajib dibentuk secara independen dari sumber acak minimal 32 byte pada production.

## Validasi

Tanda tangan membuktikan integritas payload, bukan kebenaran bisnis. Setelah signature lolos, Fastify memvalidasi path, query, header, dan body terhadap schema OpenAPI dengan additional field ditolak. Service layer tetap memeriksa otorisasi, ownership, state transition, optimistic locking, idempotensi, serta constraint transaksi database. Validasi TypeScript dan form di frontend hanya memberi umpan balik lebih cepat; backend tetap menjadi sumber keputusan.

Jangan menaruh secret enkripsi atau session pada frontend. Browser hanya menerima token CSRF terikat session, sedangkan cookie session tetap `HttpOnly`, `Secure`, dan `SameSite=Lax` pada production.
