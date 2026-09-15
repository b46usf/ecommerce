export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(value);
}

export function lowestPrice(product: { skus: Array<{ unit_price_gross: number }> }): number | null {
  if (!product.skus.length) return null;
  return Math.min(...product.skus.map(sku => sku.unit_price_gross));
}

export function variantLabel(attributes: Record<string, unknown> | null | undefined): string {
  if (!attributes) return '';
  return Object.entries(attributes).map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

const statusNames: Record<string, string> = {
  AWAITING_PAYMENT: 'Menunggu pembayaran', ACTIVE: 'Aktif', CANCEL_REQUESTED: 'Pembatalan diperiksa',
  CANCELLED: 'Dibatalkan', EXPIRED: 'Kedaluwarsa', REVIEW: 'Dalam pemeriksaan', COMPLETED: 'Selesai',
  UNPAID: 'Belum dibayar', PENDING: 'Menunggu', PAID: 'Dibayar', PARTIALLY_REFUNDED: 'Refund sebagian',
  REFUNDED: 'Dikembalikan', UNFULFILLED: 'Belum diproses', PROCESSING: 'Diproses', SHIPPED: 'Dikirim',
  DELIVERED: 'Tiba', SUBMITTED: 'Menunggu vendor', OFFERED: 'Ditawarkan', REJECTED: 'Ditolak', CLOSED: 'Ditutup',
  SUPERSEDED: 'Diganti versi baru', ACCEPTED: 'Diterima', DECLINED: 'Ditolak', CONSUMED: 'Digunakan',
  CREATING: 'Membuat sesi', UNKNOWN: 'Dalam pemeriksaan', TERMINAL: 'Selesai', QUEUED: 'Dalam antrean',
  SUCCEEDED: 'Berhasil', FAILED: 'Gagal', OPEN: 'Terbuka', RESOLVED: 'Selesai',
};
export function statusLabel(value: string): string { return statusNames[value] ?? value.replaceAll('_', ' ').toLocaleLowerCase('id-ID'); }
