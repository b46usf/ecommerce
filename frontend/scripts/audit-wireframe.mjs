import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const checks = [
  ['PUB-01', 'app/pages/register.vue', 'useAuth'], ['PUB-02', 'app/pages/login.vue', 'useAuth'],
  ['PUB-03', 'app/pages/kebijakan/[slug].vue', 'print'], ['PUB-04', 'app/pages/status.vue', '/categories'],
  ['BUY-01', 'app/pages/index.vue', '/products'], ['BUY-02', 'app/pages/cari.vue', '/products'],
  ['BUY-03', 'app/pages/produk/[id].vue', 'image-lightbox'], ['BUY-04', 'app/pages/toko/[id].vue', '/stores/{storeId}'],
  ['BUY-05', 'app/pages/akun/keranjang.vue', 'useCart'], ['BUY-06', 'app/pages/akun/checkout.vue', '/checkout/confirm'],
  ['BUY-07', 'app/pages/akun/pembayaran/[id].vue', '/payment-attempts/'], ['BUY-08', 'app/pages/akun/pesanan/index.vue', '/orders'],
  ['BUY-09', 'app/pages/akun/pesanan/[id].vue', '/orders/{orderGroupId}'], ['BUY-10', 'app/pages/akun/pengiriman/[id].vue', '/shipments/{shipmentId}'],
  ['BUY-11', 'app/pages/akun/rfq/[id].vue', '/quote-requests/{quoteRequestId}'], ['BUY-12', 'app/pages/akun/rfq/baru.vue', '/quote-requests'],
  ['BUY-13', 'app/pages/akun/kasus/[id].vue', '/cases/{caseId}'], ['BUY-14', 'app/pages/akun/alamat.vue', 'useAddresses'],
  ['BUY-15', 'app/pages/akun/organisasi.vue', '/me/organizations'],
  ['VEN-01', 'app/pages/vendor/onboarding.vue', '/legal-entities'], ['VEN-02', 'app/pages/vendor/index.vue', '/payables'],
  ['VEN-03', 'app/pages/vendor/produk/index.vue', '/products'], ['VEN-04', 'app/components/ProductEditor.vue', 'ProductMediaUploader'],
  ['VEN-05', 'app/pages/vendor/persediaan.vue', '/inventory'], ['VEN-06', 'app/pages/vendor/rfq/index.vue', '/quote-requests'],
  ['VEN-07', 'app/pages/vendor/rfq/[id].vue', '/offers'], ['VEN-08', 'app/pages/vendor/pesanan/[id].vue', '/orders/{vendorOrderId}'],
  ['VEN-09', 'app/pages/vendor/pengiriman/[id].vue', '/shipments/{shipmentId}'], ['VEN-10', 'app/pages/vendor/keuangan.vue', '/payouts'],
  ['VEN-11', 'app/pages/vendor/profil.vue', '/origin'], ['VEN-12', 'app/pages/vendor/rekening.vue', '/bank-accounts'],
  ['ADM-01', 'app/pages/admin/index.vue', '/admin/stores'], ['ADM-02', 'app/pages/admin/moderasi.vue', '/decision'],
  ['ADM-03', 'app/pages/admin/katalog.vue', '/admin/categories'], ['ADM-04', 'app/pages/admin/pajak.vue', '/tax-profiles'],
  ['ADM-05', 'app/pages/admin/kebijakan.vue', '/fee-policies'], ['ADM-06', 'app/pages/admin/pembayaran.vue', '/payment-receipts'],
  ['ADM-07', 'app/pages/admin/rekonsiliasi.vue', '/admin/reconciliations'], ['ADM-08', 'app/pages/admin/refund.vue', '/admin/refunds'],
  ['ADM-09', 'app/pages/admin/kasus.vue', '/admin/cases'], ['ADM-10', 'app/pages/admin/pengiriman.vue', '/admin/shipments'],
  ['ADM-11', 'app/pages/admin/payout.vue', '/admin/payouts'], ['ADM-12', 'app/pages/admin/jurnal.vue', '/admin/audit-logs'],
  ['SYS-01', 'app/components/NotificationMenu.vue', '/me/notifications'], ['SYS-02', 'app/components/OperationStatus.vue', '/operations/{operationId}'],
  ['SYS-03', 'app/pages/maintenance.vue', '/status'],
]

const failures = []
for (const [id, relative, marker] of checks) {
  const path = resolve(relative)
  if (!existsSync(path)) failures.push(`${id}: ${relative} tidak ada`)
  else if (!readFileSync(path, 'utf8').includes(marker)) failures.push(`${id}: binding ${marker} tidak ditemukan di ${relative}`)
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else console.log(`Wireframe audit: ${checks.length}/${checks.length} layar dan komponen memiliki route serta binding utama.`)
