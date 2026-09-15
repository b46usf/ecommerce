# Product Brief & SRS MVP

*Marketplace multi-vendor untuk individu dan sekolah*

Versi 0.2 • 5 September 2026 • Status: draf untuk review pemilik produk

### Tujuan produk

Menyediakan tempat bagi banyak vendor untuk menawarkan produk kepada masyarakat umum dan sekolah/organisasi, melalui pembelian langsung atau permintaan penawaran. Cakupan diperluas menjadi web app responsif: checkout, pembayaran melalui API, booking dan pelacakan pengiriman, serta penanganan dasar refund dan rekonsiliasi.

### Keputusan yang sudah ditetapkan

| Komponen | Keputusan pengguna |
| --- | --- |
| Pembeli | Individu dan sekolah/organisasi |
| Penjual | Banyak toko/vendor |
| Visi katalog | Semua produk / berbagai kategori |
| Transaksi | Pembelian langsung dan permintaan penawaran |
| Monetisasi | Layanan platform, iklan, langganan, booster |
| Cakupan revisi | Checkout, pembayaran API, dan pengiriman API |
| Bentuk aplikasi | Web app responsif untuk desktop dan browser mobile; tanpa aplikasi native |

### Posisi dokumen

Dokumen ini adalah rancangan produk baru berdasarkan percakapan, bukan audit atau salinan spesifikasi Toko Ladang. Belum ada klaim kemitraan atau integrasi resmi SIPLah. Kebutuhan di bawah merupakan usulan baseline implementasi yang bisa direvisi melalui review.

Revisi ini adalah spesifikasi, belum implementasi atau aktivasi akun penyedia. Sandbox digunakan selama pengembangan. Produksi membutuhkan akun Midtrans dan Biteship aktif, skema penerimaan dana marketplace yang disetujui penyedia, dan konfigurasi pajak sesuai entitas. Referensi resmi ditinjau pada 5 September 2026.

## 1. Ruang lingkup dan ukuran keberhasilan

### Di dalam MVP

Web app responsif untuk pembeli, vendor, dan admin; akun/organisasi; moderasi toko; katalog; penawaran; keranjang; checkout multi-vendor; perhitungan biaya dan pajak berversi; pembayaran Midtrans Snap; webhook dan rekonsiliasi; ongkir, booking, resi, dan tracking Biteship; pembatalan sebelum pembayaran; refund dasar oleh admin; ledger kewajiban vendor dan pencatatan pencairan.

### Di luar MVP

Aplikasi Android/iOS native, COD, paylater, kartu kredit, persetujuan sekolah bertingkat, integrasi SIPLah/Coretax otomatis, retur barang mandiri yang kompleks, split settlement dan payout vendor otomatis, penagihan langganan otomatis, mesin iklan/booster, dan AI. Kartu kredit dapat diaktifkan kemudian setelah alur fraud/capture/chargeback dirancang.

### Asumsi implementasi v0.2

Bahasa Indonesia, IDR, satu alamat tujuan per checkout, satu asal dan satu paket pengiriman per vendor-order pada rilis pertama. Visi tetap lintas kategori; barang fisik siap kirim menjadi usulan cakupan awal. Jasa, digital, barang mewah/perlakuan khusus, pre-order, dan multipaket belum diaktifkan sebelum aturan masing-masing tersedia.

Pengiriman menggunakan Biteship API. Pembayaran menggunakan Midtrans Snap dengan VA bank, QRIS, dan e-wallet yang disetujui untuk akun merchant. Pembeli wajib login sebelum penawaran/checkout. Satu pengelola pembelian per organisasi pada rilis pertama. Browser mobile dapat membuka aplikasi pembayaran eksternal; platform sendiri tetap web app.

### Riwayat perubahan

v0.2 mengganti tarif kirim manual dengan API, menambahkan pembayaran dan penanganan pascapembayaran, memisahkan komisi dari biaya gateway, merinci PPN/PPh kondisional, serta menetapkan web app saja. Semua tarif bisnis usulan dibedakan dari ketentuan resmi dan harga penyedia.

### Ukuran keberhasilan pilot

| Indikator | Definisi / target usulan |
| --- | --- |
| Kelengkapan alur | Semua skenario UAT wajib pada bagian 10 lulus |
| Konsistensi transaksi | Nol pesanan ganda dan nol stok negatif pada uji konkurensi |
| Keberhasilan tugas | Sedikitnya 8 dari 10 peserta uji menyelesaikan checkout tanpa bantuan |
| Kualitas biaya | Total checkout sama dengan total pesanan pada seluruh kasus uji |
| Pengukuran funnel | Catat view_product, add_to_cart, begin_checkout, order_created, payment_settled, shipment_booked |

Angka target adalah usulan, belum hasil pengujian. Pisahkan nilai pesanan dibuat, nilai pembayaran berhasil, refund, dan pendapatan layanan; dana milik vendor bukan pendapatan platform.

## 2. Aktor dan hak akses

| Aksi | Pembeli | Vendor | Admin |
| --- | --- | --- | --- |
| Lihat katalog aktif | Ya | Ya | Ya |
| Kelola profil/alamat | Milik sendiri | Milik sendiri | Dukungan terbatas |
| Kelola toko/produk | Tidak | Toko sendiri | Moderasi |
| Ajukan penawaran | Milik sendiri | Tidak sebagai vendor | Audit |
| Balas penawaran | Tidak | Toko sendiri | Audit |
| Checkout | Milik sendiri | Sebagai pembeli | Tidak mewakili |
| Lihat pesanan | Milik sendiri/organisasi | Bagian toko sendiri | Sesuai tugas |
| Atur biaya/kategori | Tidak | Tidak | Ya, tercatat |
| Setujui/suspensi toko | Tidak | Tidak | Ya, dengan alasan |

### Batas data dan otorisasi

Setiap permintaan API memeriksa identitas, peran, serta kepemilikan objek di server. Mengganti ID pada URL tidak boleh membuka data pembeli, toko, organisasi, penawaran, atau pesanan lain. Akun yang memiliki peran pembeli dan vendor harus memilih konteks tindakan yang jelas.

Vendor hanya menerima item, biaya, dan data penerima yang diperlukan untuk pesanan tokonya. Vendor tidak melihat pesanan vendor lain atau biaya layanan tingkat platform yang tidak relevan. Admin tidak dapat melihat kata sandi atau mengubah snapshot harga pesanan secara diam-diam.

### FR-ACC-01 — Akun dan organisasi

Sistem menyediakan registrasi, verifikasi email, login, logout, dan reset kata sandi dengan token sekali pakai yang kedaluwarsa. Profil membedakan individu dan organisasi. Nama organisasi dan kontak pengelola wajib untuk akun organisasi; identitas sekolah tambahan bersifat atribut profil, bukan bukti verifikasi resmi.

### FR-VEN-01 — Pendaftaran vendor

Vendor mengisi nama toko, kontak, alamat asal, dan informasi operasional. Status toko: DRAFT, SUBMITTED, ACTIVE, REJECTED, SUSPENDED. Hanya admin yang mengaktifkan atau menangguhkan toko; alasan dan waktu dicatat. Produk toko tidak aktif tidak dapat dibeli; pesanan lama tetap tersimpan.

## 3. Katalog, penawaran, dan keranjang

### FR-CAT-01 — Produk dan pencarian

Vendor dapat membuat, mengubah, dan mengarsipkan produk tokonya. Produk wajib memiliki kategori, nama, deskripsi, gambar, SKU/varian, satuan, harga positif, stok bilangan bulat nonnegatif, berat gram, dimensi kemasan sentimeter, kelas pajak, mode harga termasuk pajak, dan status. SKU unik di dalam toko. Pencarian hanya menampilkan produk aktif dari toko aktif; filter kategori, harga, dan lokasi serta paginasi tersedia.

### FR-RFQ-01 — Permintaan penawaran

Pembeli mengirim daftar SKU, jumlah, alamat tujuan, dan catatan ke satu vendor. Vendor membalas harga unit per baris dan masa berlaku, atau menolak dengan alasan. Riwayat versi tidak ditimpa. MVP memakai satu permintaan per vendor, tanpa lelang atau pengiriman massal lintas vendor.

### FR-RFQ-02 — Penerimaan penawaran

Pembeli menerima versi penawaran yang masih berlaku. Penawaran mengikat identitas pembeli/organisasi, vendor, SKU, jumlah, dan harga. Penerimaan belum mereservasi stok. Checkout memakai harga penawaran; stok, status produk/toko, tujuan, ongkir dari API, dan masa berlaku diperiksa kembali. Satu penawaran hanya boleh dikonsumsi oleh satu pesanan yang berhasil dibuat.

### FR-CART-01 — Keranjang

Pembeli menambah SKU, mengubah jumlah, menghapus, dan memilih item yang akan di-checkout. Item dikelompokkan per toko. Baris dari penawaran bersifat terkunci; perubahan jumlah memerlukan penawaran baru. Baris penawaran dan baris harga katalog tetap dapat dibedakan walaupun SKU sama.

### Status penawaran

SUBMITTED → OFFERED atau REJECTED. OFFERED → ACCEPTED, DECLINED, atau EXPIRED. ACCEPTED → CONSUMED ketika checkout berhasil, atau EXPIRED setelah tenggat. Revisi vendor membatalkan versi OFFERED sebelumnya; versi yang sudah ACCEPTED tidak bisa diubah sepihak. Pesanan batal/kedaluwarsa tidak otomatis mengaktifkan kembali penawaran yang sudah CONSUMED.

### Kondisi gagal yang harus terlihat

Produk tidak aktif, jumlah melebihi stok, penawaran kedaluwarsa, atau wilayah tanpa tarif harus ditampilkan pada item terkait. Keranjang tetap tersimpan dan pengguna dapat memperbaiki masalah. Sistem tidak boleh mengganti harga penawaran ke harga katalog tanpa persetujuan pembeli.

## 4. Checkout dan konsistensi pesanan

### FR-CHK-01 — Ringkasan checkout

Sistem menampilkan identitas pembeli, alamat, item per vendor, sumber harga, subtotal, tarif pengiriman per toko, biaya layanan, total akhir, dan masa tunggu pesanan. Harga katalog atau biaya yang berubah setelah pratinjau harus ditampilkan kembali untuk dikonfirmasi. Angka dari browser tidak menjadi sumber perhitungan server.

### FR-CHK-02 — Pembuatan atomik

Pada konfirmasi, server memvalidasi ulang seluruh item dan membuat CheckoutGroup, satu VendorOrder per toko, snapshot item/alamat/biaya, konsumsi penawaran, serta reservasi stok dalam satu transaksi atomik. Jika satu item gagal, seluruh checkout dibatalkan tanpa pesanan parsial. Keranjang dibersihkan hanya untuk item yang berhasil dipesan.

### FR-CHK-03 — Idempotensi dan stok

Konfirmasi mengirim idempotency key yang unik per upaya checkout. Pengulangan key dan payload yang sama mengembalikan hasil yang sama; key sama dengan payload berbeda ditolak. Pembaruan stok memakai penguncian atau update bersyarat atomik agar checkout bersamaan tidak menjual stok yang sama dua kali.

### FR-ORD-01 — Reservasi dan batas transaksi eksternal

StockAvailable = StockOnHand − StockReserved. Transaksi database lokal membuat pesanan, snapshot, reservasi, dan event outbox secara atomik. Panggilan Midtrans/Biteship dilakukan setelah commit, bukan di dalam transaksi database. Kegagalan API tidak boleh menghasilkan pesanan, tagihan, atau booking ganda.

Batas bayar mengikuti waktu kedaluwarsa metode yang benar-benar dibuat oleh provider, dibatasi kebijakan reservasi platform. Target awal maksimal 24 jam, bukan TTL universal seluruh kanal. Simpan expires_at provider dan reservasi; metode yang tidak dapat memenuhi batas harus dinonaktifkan. Sebelum melepas stok, konfirmasikan status terminal ke provider. Jika provider tidak dapat dihubungi, gunakan PAYMENT_REVIEW dan retry; jangan menyimpulkan tidak dibayar hanya dari jam lokal.

Pada pembayaran terverifikasi, kurangi StockOnHand dan StockReserved tepat sekali secara atomik. Pembayaran terlambat setelah stok dilepas masuk PAYMENT_REVIEW; jangan membuat stok negatif atau booking otomatis. Admin menentukan pemenuhan setelah revalidasi atau refund.

### FR-ORD-02 — Pembatalan dan status terpisah

Permintaan batal sebelum pembayaran masuk CANCEL_REQUESTED. Backend meminta pembatalan provider dan memeriksa status terakhir; hanya setelah terminal tidak dibayar, order menjadi CANCELLED dan reservasi dilepas. Jika pembayaran menang dalam perlombaan waktu, proses sebagai pembayaran berhasil atau review/refund, bukan pembatalan tanpa dana.

Status payment, fulfillment, refund, dan payout dipisahkan. Pembeli melihat status per vendor; status kelompok dihitung dari anak. Kegagalan kirim satu vendor tidak membatalkan pesanan vendor lain. Snapshot nama/SKU/harga/pajak/biaya/alamat tetap tidak berubah; koreksi keuangan memakai adjustment atau credit note yang dapat diaudit.

## 5. Biaya layanan, pajak, dan monetisasi Indonesia

### BR-FEE-01 — Pisahkan sumber biaya

Tidak ditetapkan satu angka sebagai “tarif standar seluruh e-commerce Indonesia”. Tarif layanan adalah keputusan bisnis, tarif API mengikuti kontrak penyedia, sedangkan pajak mengikuti aturan dan subjeknya. Baseline berikut merupakan usulan platform untuk implementasi, bukan tarif yang diwajibkan pemerintah.

| Komponen | Baseline v0.2 | Penanggung |
| --- | --- | --- |
| Komisi layanan platform | Usulan 2% dari nilai barang sebelum PPN, sesudah diskon vendor; kategori/paket dapat berbeda | Vendor, dipotong dari hak penerimaan |
| Biaya layanan pembeli | Rp0 pada rilis awal | Tidak ditagih |
| Biaya payment gateway | Tarif aktual kanal dan invoice provider | Platform, tidak ditambahkan ke checkout |
| Ongkir | Harga final layanan yang dipilih dari Biteship | Pembeli, ditampilkan sebelum bayar |
| Asuransi/biaya kurir lain | Sesuai rincian API; jangan ditambah lagi jika termasuk harga final | Sesuai pilihan/ketentuan layanan yang ditampilkan |
| Iklan, langganan, booster | Harga paket tersendiri, fase berikutnya | Vendor yang berlangganan |

Komisi 2% belum membuktikan profitabilitas: transaksi kecil dengan VA atau kanal berbiaya tinggi dapat menghasilkan margin negatif. Dashboard menghitung margin setelah biaya gateway, pajak atas layanan penyedia, subsidi, dan refund; jangan otomatis menaikkan tagihan pembeli untuk menutup selisih.

MDR QRIS ditanggung merchant dan tidak boleh dialihkan kepada konsumen. Karena itu, checkout tidak menambahkan surcharge QRIS atau mengganti namanya menjadi biaya admin. [Bank Indonesia — MDR QRIS](https://www.bi.go.id/id/publikasi/ruang-media/cerita-bi/Pages/mdr-qris.aspx)

### BR-FEE-02 — Referensi tarif Midtrans

| Kanal | Harga publik yang ditinjau | Pemakaian rilis pertama |
| --- | --- | --- |
| Virtual account bank | Rp4.000 per transaksi | Ya, bank yang aktif di akun |
| QRIS | 0,7% | Ya, tarif/kategori merchant mengikuti persetujuan |
| GoPay / ShopeePay | 2% | Jika kanal aktif |
| DANA / OVO | 1,5% | Jika kanal aktif |

Harga ini merupakan referensi biaya merchant, bukan biaya tambahan pembeli. Kontrak dan klasifikasi merchant dapat berbeda; biaya gaming/digital juga dapat berbeda. Simpan versi tarif, tanggal berlaku, komponen pajak provider, dan nominal aktual settlement. [Harga resmi Midtrans](https://midtrans.com/id/biaya). Perlakuan PPN atas fee mengikuti invoice provider, bukan menambahkan PPN pada seluruh uang belanja. [FAQ biaya Midtrans](https://docs.midtrans.com/docs/berapa-harga-midtrans-payment-service)

### BR-TAX-01 — PPN barang dan jasa platform

PPN tidak diterapkan rata ke seluruh keranjang. Periksa status PKP penjual, kelas pajak produk, pengecualian, dan tanggal transaksi. Untuk penyerahan umum BKP/JKP nonmewah yang mengikuti PMK 131/2024, perhitungannya 12% × 11/12 × harga/penggantian sebelum PPN, efektif 11%. Barang mewah dan skema khusus membutuhkan aturan tersendiri. [DJP — PMK 131/2024](https://www.pajak.go.id/id/artikel/pmk-1312024-tarif-ppn-sebelas-dua-belas), [DJP — DPP dan besaran tertentu](https://www.pajak.go.id/id/siaran-pers/pemerintah-terbitkan-aturan-dpp-nilai-lain-dan-besaran-tertentu-ppn)

Rancangan tax engine menyimpan seller_tax_profile, tax_class, statutory_rate, dpp_factor, effective_from, harga sebelum pajak, dan PPN snapshot. Non-PKP tidak memungut PPN barang sebagai PKP. Kelas bebas/tidak dipungut/diluar objek harus dibedakan; kelas belum diverifikasi memblokir publikasi produk, bukan dianggap 0%.

Harga tampil menggunakan mode termasuk pajak jika berlaku. Contoh nonmewah umum: harga sebelum PPN Rp100.000 menjadi Rp111.000; checkout tidak menambah 11% lagi. Jika platform PKP dan jasa komisinya termasuk JKP umum, pajak jasa komisi dihitung terpisah atas komisi, bukan atas seluruh nilai barang. Status PKP platform dan vendor harus diverifikasi oleh penanggung jawab pajak sebelum produksi.

### BR-TAX-02 — PPh marketplace bersyarat

PMK 37/2025 mengatur pemungutan PPh Pasal 22 oleh marketplace yang ditunjuk. Tarif 0,5% atas peredaran bruto tidak termasuk PPN/PPnBM; ini mengurangi hak penerimaan penjual, bukan surcharge pembeli. Platform baru tidak otomatis mengaktifkan pemungutan hanya karena berbentuk marketplace. [DJP — Implementasi PMK 37/2025](https://www.pajak.go.id/id/siaran-pers/pemerintah-implementasi-pmk-372025-melalui-penunjukan-empat-marketplace-sebagai)

Default collector_enabled=false sampai ada dasar penunjukan dan tanggal efektif untuk entitas platform. Jika ditunjuk, engine mengevaluasi pengecualian, surat pernyataan WP orang pribadi beromzet sampai Rp500 juta, dan SKB sesuai ketentuan. Omzet tidak boleh disimpulkan hanya dari satu toko/platform. Simpan dokumen, masa berlaku, basis pemungutan, jumlah, dan jejak setoran/pelaporan. [DJP — FAQ pemungutan marketplace](https://pajak.go.id/en/node/120044)

PPh vendor tidak dihitung dari penerimaan bersih setelah komisi. Perlakuan ongkir/diskon dalam dasar pajak mengikuti pihak penerima penghasilan dan aturan yang divalidasi penanggung jawab pajak. Akun sekolah tidak otomatis berarti bebas pajak; kasus bendahara/pemungut khusus masuk pemeriksaan agar tidak dipungut ganda. Invoice komersial bukan faktur pajak resmi; simpan referensi/unggahan faktur yang diterbitkan pihak berwenang. Integrasi Coretax tidak diasumsikan tersedia.

### BR-FEE-03 — Rumus dan contoh dua vendor

Total bayar pembeli = jumlah harga barang final termasuk PPN yang berlaku + ongkir final API + biaya pembeli (baseline 0) − diskon platform. Komisi dan PPh vendor tidak menambah jumlah ini. Gunakan integer rupiah, aritmetika desimal presisi, dan pembulatan half-up per komponen; alokasi sisa rupiah harus deterministik. Aturan pembulatan pajak harus konsisten dengan dokumen fiskal yang digunakan.

Contoh berikut tanpa diskon/asuransi: A PKP, barang nonmewah umum; B non-PKP; platform PKP dengan komisi 2% dan jasa umum efektif PPN 11%; platform belum ditunjuk pemungut PPh. Angka ongkir hanya data uji, bukan tarif Biteship.

| Komponen | Vendor A | Vendor B |
| --- | --- | --- |
| Nilai barang sebelum PPN | Rp200.000 | Rp150.000 |
| PPN barang | Rp22.000 | Rp0 |
| Harga barang final | Rp222.000 | Rp150.000 |
| Ongkir final API (fixture) | Rp20.000 | Rp15.000 |
| Kontribusi tagihan pembeli | Rp242.000 | Rp165.000 |
| Komisi 2% | Rp4.000 | Rp3.000 |
| PPN jasa komisi | Rp440 | Rp330 |
| PPh dipungut platform | Rp0 | Rp0 |
| Hak vendor, ongkir dibayar platform ke agregator | Rp217.560 | Rp146.670 |

Total bayar = Rp407.000; ongkir Rp35.000; hak vendor Rp364.230; komisi Rp7.000; PPN komisi Rp770. Jumlah komponen tersebut Rp407.000. Biaya gateway dibayar dari sisi platform dan dicatat terpisah. Jika entitas platform kemudian ditunjuk dan A tidak dikecualikan, fixture PPh A = 0,5% × Rp200.000 = Rp1.000; hak A turun menjadi Rp216.560, tetapi tagihan pembeli tetap. Contoh ini mensyaratkan ongkir merupakan penerimaan agregator, bukan penghasilan vendor.

### FR-ADM-01 — Konfigurasi dan audit

Admin keuangan mengelola kebijakan komisi/pajak berversi dengan tanggal efektif. Perubahan sensitif mencatat aktor, alasan, nilai sebelum/sesudah. Pisahkan admin operasional dari keuangan: hanya keuangan mengotorisasi refund/pencairan, dengan pemeriksa kedua untuk pencairan. Rahasia API, data pajak, dan rekening tidak boleh masuk log umum. Perubahan tarif tidak mengubah pesanan lama.

## 6. Data, antarmuka, dan kualitas sistem

### Model data konseptual

User memiliki Address dan keanggotaan Organization; User dapat memiliki Store. Store memiliki Product dan SKU. Category memiliki atribut yang dapat diperluas. QuoteRequest memiliki QuoteVersion dan QuoteLine. Cart memiliki CartLine. CheckoutGroup memiliki VendorOrder; VendorOrder memiliki OrderItemSnapshot dan StockReservation. FeePolicy, TaxPolicy, SellerTaxProfile, TaxDocument, PaymentAttempt, PaymentEvent, Refund, ShipmentQuote, Shipment, ShipmentEvent, LedgerEntry, VendorPayable, PayoutRecord, OutboxEvent, dan AuditLog mendukung proses finansial dan integrasi.

Relasi utama: satu CheckoutGroup ke banyak VendorOrder; setiap VendorOrder hanya untuk satu Store; satu OrderItemSnapshot menunjuk SKU tetapi tetap menyimpan salinan data transaksi. Nilai uang IDR disimpan integer rupiah. Waktu disimpan UTC dan ditampilkan dengan zona waktu yang jelas.

### Halaman dan kontrak antarmuka awal

Pembeli: beranda/pencarian, detail produk/toko, login/profil, alamat, daftar/detail penawaran, keranjang, checkout, hasil dan riwayat pesanan. Vendor: dashboard, profil toko, produk/varian/stok, alamat asal/kemasan, layanan kurir, daftar/detail penawaran, pesanan masuk, resi, dan hak penerimaan. Admin: vendor, moderasi produk, kategori, biaya/pajak, payment review, refund, rekonsiliasi, pencairan, dan audit.

Operasi API utama: createQuoteRequest, offerQuote, acceptQuote, updateCart, previewCheckout, confirmCheckout, getOrderGroup, cancelOrderGroup, getShippingRates, createPaymentSession, getPaymentStatus, bookShipment, getShipmentTracking, requestRefund, reconcilePayment, recordPayout. Kontrak rinci perlu menetapkan schema request/response, error code, pagination, dan idempotency. confirmCheckout menerima referensi item serta versi pratinjau, bukan harga yang dipercaya dari klien.

### NFR-01 — Keamanan dan privasi

Transport terenkripsi; kata sandi di-hash dengan algoritme adaptif; token reset kedaluwarsa; validasi input dan upload gambar; pembatasan percobaan login/checkout; perlindungan sesi serta CSRF sesuai mekanisme autentikasi. Seluruh endpoint privat wajib diuji otorisasinya. Retensi data dan pemisahan akses admin ditetapkan sebelum produksi.

### NFR-02 — Target kualitas usulan

Pada dataset 10.000 SKU dan 100 pengguna aktif bersamaan: p95 API pencarian ≤2 detik dan confirmCheckout ≤3 detik, diukur di lingkungan staging tanpa waktu jaringan klien. Target confirmCheckout berlaku commit lokal; latensi provider diukur terpisah. Proses asinkron menampilkan status, bukan spinner tanpa batas. Uji stok terakhir dengan 20 permintaan serentak harus menghasilkan paling banyak satu reservasi. Form dapat digunakan dengan keyboard dan memiliki label serta pesan error yang jelas.

Backup harian dengan target RPO 24 jam dan RTO 8 jam; buktikan dengan uji pemulihan. Catat correlation ID, latensi, error, kegagalan checkout, dan reservasi lewat waktu. Target tersebut perlu ditinjau bersama kapasitas infrastruktur sebelum menjadi komitmen layanan.

## 7. Pengiriman API — Biteship

### FR-SHP-01 — Tarif dan alamat

Backend memakai `POST /v1/rates/couriers` untuk ongkir dari asal setiap vendor ke tujuan pembeli. Validasi area/kode pos atau koordinat sesuai layanan, berat gram, dimensi kemasan, jumlah, dan nilai barang. Daftar kurir/layanan berasal dari API serta kemampuan akun; jangan menjanjikan seluruh kurir tersedia di setiap wilayah. [Biteship — Rates API](https://biteship.com/id/docs/api/rates/retrieve)

Simpan snapshot layanan, total tarif final, rincian biaya, input paket, waktu pengambilan, dan masa cache internal usulan 5 menit. Masa cache ini bukan jaminan harga provider. Revalidasi sebelum pembayaran dibuat; perubahan meminta persetujuan ulang. Tidak ada layanan atau timeout: tampilkan retry dan blokir pembayaran, bukan ongkir Rp0. Satu layanan dipilih per vendor-order.

### FR-SHP-02 — Booking dan resi

Setelah pembayaran terverifikasi dan vendor menyatakan paket siap, backend membuat booking dengan `POST /v1/orders`. Simpan referensi internal, ID provider, layanan, resi, status, dan nominal aktual. Kesiapan saldo atau invoice Biteship menjadi dependensi operasional. [Biteship — Create Order](https://biteship.com/id/docs/api/orders/create)

Gunakan outbox, lock per shipment, dan unique booking reference internal. Jika timeout setelah request terkirim, cari/rekonsiliasi hasil melalui referensi/provider sebelum retry; jangan mengasumsikan endpoint provider idempoten. Kegagalan satu booking masuk SHIPMENT_REVIEW; pembayaran tidak ditandai gagal. Harga berubah sesudah pembeli membayar dicatat adjustment platform/vendor, tidak didebit diam-diam ke pembeli.

### FR-SHP-03 — Tracking dan pengecualian

Terima event `order.status`, `order.price`, dan `order.waybill_id`; simpan status mentah serta status internal. Webhook Biteship mencakup perubahan harga, termasuk selisih berat aktual. [Biteship — Webhook overview](https://biteship.com/id/docs/api/webhook/overview)

Endpoint HTTPS menggunakan autentikasi yang benar-benar didukung konfigurasi akun; jangan mengarang header signature. Cocokkan order dengan akun platform, deduplikasi event, dan verifikasi ulang lewat API untuk status kritis. Jika autentikasi event belum dapat dibuktikan, event hanya memicu pemeriksaan API. [Biteship — Konfigurasi webhook](https://biteship.com/id/docs/api/webhook/add_webhook)

Status internal: NOT_BOOKED, BOOKING, BOOKED, PICKED_UP, IN_TRANSIT, DELIVERED, CANCELLED, SHIPMENT_REVIEW. Status DELIVERED belum otomatis menjadi COMPLETED; pembeli mengonfirmasi penerimaan, atau admin menyelesaikan setelah pemeriksaan dan masa komplain yang ditetapkan. Gagal kirim/retur memerlukan keputusan admin dan tidak otomatis mengembalikan uang atau stok. Sandbox dipisahkan dari produksi. [Biteship — Sandbox](https://help.biteship.com/hc/en-id/articles/39554706133913-How-to-Use-Sandbox-or-Testing-Mode-in-Biteship)

## 8. Pembayaran API — Midtrans Snap

### FR-PAY-01 — Sesi pembayaran web

Server membuat sesi Midtrans Snap setelah pesanan tersimpan dengan jumlah final server. Browser menggunakan halaman/popup pembayaran Snap; kunci server hanya di backend. Kanal awal VA, QRIS, e-wallet mengikuti aktivasi akun. Satu CheckoutGroup dibayar dalam satu pembayaran, lalu ledger mengalokasikan ke vendor-order; model penerimaan marketplace ini harus disetujui Midtrans sebelum produksi. [Midtrans — Snap](https://docs.midtrans.com/docs/snap)

PaymentAttempt memiliki order_id provider unik, expected_amount, currency, channel, expires_at, dan status. Retry memeriksa upaya sebelumnya; hanya satu tagihan yang masih dapat dibayar per CheckoutGroup. Jika metode diubah, tutup/konfirmasi terminal upaya sebelumnya sebelum membuat tagihan baru. Respons browser atau redirect sukses hanya petunjuk tampilan, bukan bukti pembayaran.

### FR-PAY-02 — Webhook dan pemetaan status

Backend memverifikasi `signature_key` sesuai dokumentasi Midtrans, mencocokkan order_id dan gross_amount terhadap snapshot, lalu mengecek status API jika terjadi konflik. Simpan event tahan lama sebelum respons sukses; pemrosesan lanjutan melalui queue. Notifikasi duplikat atau tidak berurutan tidak boleh membuat posting ledger/stok ganda atau menurunkan status berhasil menjadi pending. [Midtrans — HTTP notification](https://docs.midtrans.com/docs/https-notification-webhooks)

| Status provider untuk kanal awal | Status internal | Aksi |
| --- | --- | --- |
| pending | PENDING | Tunggu dan simpan tenggat |
| settlement | PAID | Alokasi pembayaran dan konsumsi reservasi tepat sekali |
| deny / cancel / expire | FAILED / CANCELLED / EXPIRED | Tutup attempt dan evaluasi pelepasan reservasi |
| refund / partial_refund | REFUNDED / PARTIALLY_REFUNDED | Catat pengembalian dan adjustment ledger |
| Tidak dikenal, nominal berbeda, pembayaran terlambat | PAYMENT_REVIEW | Verifikasi API; jangan fulfillment otomatis |

Lakukan rekonsiliasi terjadwal atas attempt pending/review dan transaksi settlement dengan laporan provider. Kanal capture/kartu kredit tidak aktif pada rilis pertama. [Midtrans — Status API](https://docs.midtrans.com/docs/get-status-api-requests)

### FR-PAY-03 — Refund dan ledger vendor

Refund penuh atau parsial diotorisasi admin keuangan, dibatasi saldo refundable dan dialokasikan ke vendor-order/item. Gunakan refund reference unik. Kanal yang mendukung refund API diproses melalui Midtrans; kanal yang tidak mendukung memakai prosedur manual terverifikasi dan tercatat. Status REFUND_REQUESTED bukan bukti uang sudah dikembalikan. [Midtrans — Refund API](https://docs.midtrans.com/reference/refund-transaction)

Ledger mencatat uang diterima, hak vendor, komisi, pajak komisi, PPh yang dipungut jika berlaku, kewajiban ongkir, biaya gateway, refund, dan pencairan. Gunakan posting double-entry atau kontrol keseimbangan ekuivalen dengan unique event reference. Refund tidak otomatis menambah stok; lakukan setelah hasil pemeriksaan pemenuhan/retur.

Pembayaran Snap tidak diasumsikan otomatis membagi atau menahan dana per vendor. Payout otomatis di luar rilis pertama. Finance mencatat pencairan manual melalui mekanisme yang disetujui penyedia dan kontrak vendor, dengan verifikasi rekening, pemeriksa kedua, bukti transfer, dan pencegahan payout ganda. Status: BLOCKED, ELIGIBLE, PROCESSING, PAID, FAILED. Eligible hanya jika dana tersedia, order selesai, dan tidak ada dispute/refund tertunda. Kebijakan masa komplain dan jadwal pencairan harus diisi sebelum live.

## 9. Backlog dan urutan pengembangan

| Tahap | Hasil | Dependensi |
| --- | --- | --- |
| A | Akun, organisasi, vendor, hak akses dan profil pajak | Data entitas |
| B | Katalog, SKU, kemasan, penawaran, keranjang | A |
| C | Tax/fee engine, alamat, adapter rates Biteship | A–B |
| D | Checkout atomik, snapshot, reservasi, outbox | C |
| E | Snap, webhook, rekonsiliasi, cancel/refund, ledger | D |
| F | Booking, tracking, penerimaan, payout record | E |
| G | UAT sandbox, keamanan, konkurensi, pemulihan | A–F |

### Definisi selesai

Seluruh skenario wajib lulus di sandbox dengan akun pembeli, vendor A/B, operasional, dan finance. Tidak ada selisih ledger atau cacat kritis otorisasi, stok, pajak, pembayaran, dan refund. Periksa retry saat provider timeout, pemulihan backup, serta pemisahan kunci sandbox/production. Anggaran dan jadwal disusun setelah stack serta tim dipilih.

### Model web app

Satu aplikasi web responsif dengan area pembeli, vendor, dan admin berdasarkan peran. Uji viewport 360, 768, dan 1440 piksel, navigasi keyboard, Chrome/Edge/Firefox/Safari versi yang didukung tim QA, serta kembali dari pembayaran di browser mobile. Kunci rahasia tidak dikirim ke browser. HTTPS wajib; session cookie Secure/HttpOnly/SameSite disesuaikan alur payment redirect dan proteksi CSRF. Tidak ada pekerjaan APK/IPA atau publikasi app store dalam backlog.

## 10. Skenario penerimaan wajib

| ID / kebutuhan | Skenario | Hasil yang diharapkan |
| --- | --- | --- |
| U01 / ACC, VEN | Vendor lain mengganti ID toko/pesanan | Akses ditolak; data tidak bocor |
| U02 / CAT | Cari produk toko suspended | Tidak muncul dan tidak bisa checkout |
| U03 / RFQ | Terima penawaran lalu ubah harga katalog | Harga penawaran tetap sesuai versi |
| U04 / RFQ | Checkout penawaran lewat tenggat | Ditolak; tidak beralih diam-diam ke harga katalog |
| U05 / CHK | Checkout berisi dua vendor | Satu grup, dua pesanan; biaya sesuai contoh |
| U06 / CHK | Klik ulang dengan key/payload sama | Satu hasil; stok tidak direservasi dua kali |
| U07 / CHK | Key sama, payload berbeda | Konflik; pesanan awal tidak berubah |
| U08 / CHK | 20 pembeli memesan stok terakhir | Paling banyak satu berhasil; stok tidak negatif |
| U09 / CHK | Satu item multi-vendor gagal validasi | Tidak ada order parsial atau reservasi tersisa |
| U10 / CHK | Harga/ongkir berubah setelah preview | Minta konfirmasi ulang sebelum order |
| U11 / ORD | Batalkan atau lewati tenggat, job diulang | Verifikasi provider sebelum terminal; stok dilepas tepat sekali |
| U12 / ORD | Produk/alamat akun diubah sesudah checkout | Snapshot pesanan tetap sama |
| U13 / CHK | Wilayah tujuan tanpa tarif | Checkout diblokir dengan pesan yang jelas |
| U14 / RFQ | Dua checkout memakai penawaran sama | Hanya satu mengonsumsi penawaran |
| U15 / NFR | Pulihkan backup ke lingkungan uji | Data dan aplikasi dapat digunakan kembali |
| U16 / TAX | Vendor PKP dan non-PKP di satu checkout | PPN hanya sesuai profil/kelas; tidak ditambah dua kali |
| U17 / TAX | Platform belum ditunjuk pemungut PPh | Tidak ada pemungutan PPh marketplace |
| U18 / TAX | Collector aktif dengan surat pengecualian valid | Engine menerapkan pengecualian dan menyimpan alasan |
| U19 / FEE | Pilih QRIS | Tidak ada surcharge MDR kepada pembeli |
| U20 / SHP | Rates timeout atau layanan hilang | Checkout diblokir dengan retry, bukan ongkir nol |
| U21 / SHP | Booking timeout sesudah provider menerima | Rekonsiliasi; satu booking saja |
| U22 / SHP | Event resi/status/harga dikirim ulang | Pembaruan idempoten; tidak menagih pembeli lagi |
| U23 / PAY | Redirect sukses tanpa webhook valid | Belum PAID; backend memeriksa provider |
| U24 / PAY | Signature/nominal salah | Ditolak/review; tidak mengonsumsi stok atau booking |
| U25 / PAY | Settlement lalu pending, event diulang | Tetap PAID; ledger/stok tepat sekali |
| U26 / PAY | Batal/expiry berlomba dengan settlement | Tidak kehilangan dana atau melepas stok secara salah |
| U27 / PAY | Ganti metode ketika attempt lama aktif | Tutup/verifikasi attempt lama; tidak ada dua tagihan aktif |
| U28 / PAY | Refund parsial vendor A dari grup A+B | Nominal dibatasi dan dialokasikan; B tidak ikut dibatalkan |
| U29 / PAY | Pembayaran datang setelah stok dilepas | PAYMENT_REVIEW, tidak oversell; refund bila tak terpenuhi |
| U30 / LEDGER | Payout diklik ulang atau ada refund tertunda | Tidak ganda; payout diblokir jika belum eligible |
| U31 / WEB | Bayar dari browser mobile lalu kembali | Status server tampil benar tanpa aplikasi platform native |
| U32 / TAX | Koreksi pajak/fee sesudah pembayaran | Adjustment tercatat; snapshot lama tidak ditimpa |

Pelaksanaan UAT mencatat data awal, langkah, hasil aktual, bukti, status lulus/gagal, dan penanggung jawab. Daftar ini adalah rencana uji; belum ada aplikasi atau hasil pengujian implementasi.

## 11. Konfigurasi yang masih diperlukan

| Keputusan/data | Baseline atau kebutuhan | Penanggung jawab |
| --- | --- | --- |
| Nama platform, stack, tim | Belum dipilih | Pemilik produk/teknis |
| Bentuk aplikasi | Web app responsif saja | Sudah ditetapkan pengguna |
| Komisi komersial | Usulan 2% vendor; biaya pembeli Rp0 | Pemilik produk |
| Pajak entitas | PKP platform/vendor, tax class, dasar penunjukan jika ada | Finance/pajak |
| API pengiriman | Biteship; akun, saldo/invoice, wilayah dan layanan aktif | Operasional |
| API pembayaran | Midtrans Snap; akun bisnis, persetujuan marketplace, kanal aktif | Finance/teknis |
| Timeout/expiry | Sesuai kanal provider, maksimal kebijakan reservasi | Teknis |
| Masa komplain dan payout | Angka periode dan jadwal belum ditetapkan; wajib sebelum live | Operasional/finance |
| Cakupan produk pertama | Usulan barang fisik siap kirim; kategori khusus ditunda | Pemilik produk |
| Dokumen pajak | Invoice komersial + referensi faktur/bukti yang sah; bukan integrasi Coretax otomatis | Finance/pajak |

Tidak ada pendaftaran layanan, pengeluaran biaya API, atau transaksi nyata dilakukan saat penyusunan SRS ini. Tahap berikutnya adalah ERD fisik, wireframe web, dan kontrak API internal berdasarkan v0.2.

## 12. Referensi dan pemeliharaan aturan

Tautan resmi ditempatkan di dekat ketentuan terkait. Tanggal tinjauan: 5 September 2026. Tarif provider, kemampuan akun, serta aturan pajak diperiksa ulang sebelum go-live dan saat ada perubahan. Pemilik aturan pajak harus mengesahkan konfigurasi yang berlaku untuk entitas dan kategori produk, terutama barang/jasa khusus serta pengadaan sekolah; dokumen ini bukan penetapan status perpajakan entitas.

Perubahan berikutnya menggunakan ID FR/BR/NFR/UAT, alasan, dampak, dan tanggal efektif. Riwayat v0.1 dipertahankan melalui versi dokumen. Nilai 2%, cache 5 menit, dan batas reservasi maksimal 24 jam merupakan usulan desain platform; bukan aturan resmi penyedia/pemerintah.

### Glosarium

SRS: spesifikasi kebutuhan perangkat lunak. RFQ: permintaan penawaran. SKU: identitas varian. PKP: Pengusaha Kena Pajak. PPN: Pajak Pertambahan Nilai. PPh: Pajak Penghasilan. MDR: biaya merchant untuk pemrosesan pembayaran. Snapshot: salinan transaksi. Idempotensi: pengulangan tidak menggandakan akibat. Outbox: catatan event dalam transaksi lokal untuk diproses setelah commit. Ledger: buku pencatatan keuangan. UAT: uji penerimaan pengguna.
