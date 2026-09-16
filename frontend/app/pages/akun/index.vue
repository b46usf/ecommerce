<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, formatRupiah, statusLabel } from '~/utils/format'

type Address = components['schemas']['Address']
type Order = components['schemas']['OrderGroup']
type Quote = components['schemas']['QuoteRequest']

definePageMeta({ middleware: 'auth' })

const api = useMarketplaceApi()
const { user } = useAuth()
const cartApi = useCart()
const orders = ref<Order[]>([])
const quotes = ref<Quote[]>([])
const addresses = ref<Address[]>([])
const pending = ref(true)
const error = ref<unknown>()

const firstName = computed(() => user.value?.name.trim().split(/\s+/)[0] || 'Pembeli')
const initials = computed(() => (user.value?.name || 'P').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())
const accountName = computed(() => cartApi.account.value?.kind === 'ORGANIZATION'
  ? cartApi.account.value.organization_name || 'Organisasi'
  : 'Pembelian pribadi')
const cartTotal = computed(() => cartApi.cart.value?.items.reduce((total, item) => total + (item.unit_price_gross * item.quantity), 0) ?? 0)
const activeOffers = computed(() => quotes.value.filter(quote => quote.status === 'OFFERED').length)
const defaultAddress = computed(() => addresses.value.find(address => address.is_default) ?? addresses.value[0])
const latestOrders = computed(() => orders.value.slice(0, 3))

const orderStatuses = computed(() => [
  { label: 'Belum dibayar', caption: 'Selesaikan pembayaran', icon: 'lucide:wallet-cards', tone: 'orange', count: orders.value.filter(order => order.order_state === 'AWAITING_PAYMENT').length },
  { label: 'Sedang diproses', caption: 'Pesanan disiapkan', icon: 'lucide:package-search', tone: 'blue', count: orders.value.filter(order => order.vendor_orders.some(vendor => ['UNFULFILLED', 'PROCESSING'].includes(vendor.fulfillment_status))).length },
  { label: 'Dalam pengiriman', caption: 'Lacak paket Anda', icon: 'lucide:truck', tone: 'violet', count: orders.value.filter(order => order.vendor_orders.some(vendor => vendor.fulfillment_status === 'SHIPPED')).length },
  { label: 'Selesai', caption: 'Transaksi berhasil', icon: 'lucide:badge-check', tone: 'green', count: orders.value.filter(order => order.order_state === 'COMPLETED').length },
])

const quickActions = computed(() => [
  { title: 'Keranjang', detail: cartApi.itemCount.value ? `${cartApi.itemCount.value} barang · ${formatRupiah(cartTotal.value)}` : 'Belum ada barang', icon: 'lucide:shopping-cart', tone: 'blue', to: '/akun/keranjang', badge: cartApi.itemCount.value || undefined },
  { title: 'Penawaran', detail: activeOffers.value ? `${activeOffers.value} penawaran menunggu` : 'Ajukan harga pembelian besar', icon: 'lucide:messages-square', tone: 'orange', to: '/akun/rfq', badge: activeOffers.value || undefined },
  { title: 'Alamat', detail: addresses.value.length ? `${addresses.value.length} alamat tersimpan` : 'Tambahkan alamat pengiriman', icon: 'lucide:map-pinned', tone: 'green', to: '/akun/alamat' },
  { title: 'Refund', detail: 'Pantau pengembalian dana', icon: 'lucide:rotate-ccw', tone: 'violet', to: '/akun/refund' },
])

function orderProductSummary(order: Order): string {
  const items = order.vendor_orders.flatMap(vendor => vendor.items)
  const firstItem = items[0]
  if (!firstItem) return 'Detail produk tersedia di pesanan'
  const extra = items.length - 1
  return extra > 0 ? `${firstItem.product_name} dan ${extra} produk lainnya` : firstItem.product_name
}

async function loadDashboard() {
  pending.value = true
  error.value = undefined
  try {
    if (!cartApi.account.value || !cartApi.cart.value) await cartApi.load()
    const buyerAccountId = cartApi.account.value!.id
    const [orderResult, quoteResult, addressResult] = await Promise.all([
      api.GET('/buyer-accounts/{buyerAccountId}/orders', { params: { path: { buyerAccountId }, query: { limit: 100 } }, cache: 'no-store' }),
      api.GET('/buyer-accounts/{buyerAccountId}/quote-requests', { params: { path: { buyerAccountId }, query: { limit: 100 } }, cache: 'no-store' }),
      api.GET('/buyer-accounts/{buyerAccountId}/addresses', { params: { path: { buyerAccountId }, query: { limit: 100 } }, cache: 'no-store' }),
    ])
    orders.value = unwrap(orderResult).items
    quotes.value = unwrap(quoteResult).items
    addresses.value = unwrap(addressResult).items
  } catch (cause) {
    error.value = cause
  } finally {
    pending.value = false
  }
}

onMounted(() => { void loadDashboard() })
useSeoMeta({ title: 'Akun saya — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell buyer-dashboard">
    <BuyerNav />

    <section class="buyer-dashboard-hero" aria-labelledby="buyer-welcome-title">
      <div class="buyer-dashboard-hero__copy">
        <p class="eyebrow buyer-dashboard-hero__eyebrow"><Icon name="lucide:sparkles" /> Pusat aktivitas belanja</p>
        <h1 id="buyer-welcome-title">Halo, {{ firstName }}!</h1>
        <p>Semua pesanan, penawaran, dan kebutuhan belanja Anda tersedia dalam satu ringkasan.</p>
        <div class="buyer-dashboard-hero__actions">
          <NuxtLink class="button buyer-dashboard-hero__primary" to="/cari"><Icon name="lucide:search" /> Mulai belanja</NuxtLink>
          <NuxtLink class="button buyer-dashboard-hero__secondary" to="/akun/keranjang"><Icon name="lucide:shopping-bag" /> Lihat keranjang</NuxtLink>
        </div>
      </div>
      <div class="buyer-profile-card">
        <span class="buyer-profile-card__avatar" aria-hidden="true">{{ initials }}</span>
        <div class="buyer-profile-card__identity"><strong>{{ user?.name }}</strong><span>{{ user?.email }}</span></div>
        <span class="buyer-profile-card__verified" :class="{ 'buyer-profile-card__verified--pending': !user?.email_verified }"><Icon :name="user?.email_verified ? 'lucide:badge-check' : 'lucide:circle-alert'" />{{ user?.email_verified ? 'Akun terverifikasi' : 'Verifikasi email' }}</span>
        <NuxtLink class="buyer-profile-card__edit" to="/akun/profil"><Icon name="lucide:pencil" /> Kelola profil</NuxtLink>
        <div class="buyer-profile-card__context"><Icon :name="cartApi.account.value?.kind === 'ORGANIZATION' ? 'lucide:building-2' : 'lucide:user-round'" /><span><small>Konteks belanja</small><strong>{{ accountName }}</strong></span></div>
      </div>
    </section>

    <ApiState :pending="pending" :error="error ? displayError(error) : null" skeleton="dashboard" :skeleton-count="4" loading-label="Memuat ringkasan akun" @retry="loadDashboard">
      <section class="buyer-status-card" aria-labelledby="order-status-title">
        <header class="buyer-dashboard-section-heading"><div><p class="eyebrow">Status transaksi</p><h2 id="order-status-title">Pesanan saya</h2></div><NuxtLink to="/akun/pesanan">Lihat semua <Icon name="lucide:arrow-right" /></NuxtLink></header>
        <div class="buyer-status-grid">
          <NuxtLink v-for="item in orderStatuses" :key="item.label" class="buyer-status-item" to="/akun/pesanan">
            <span class="buyer-dashboard-icon" :class="`buyer-dashboard-icon--${item.tone}`"><Icon :name="item.icon" /><b v-if="item.count">{{ item.count > 99 ? '99+' : item.count }}</b></span>
            <span><strong>{{ item.label }}</strong><small>{{ item.caption }}</small></span><Icon name="lucide:chevron-right" class="buyer-status-item__arrow" />
          </NuxtLink>
        </div>
      </section>

      <section class="buyer-dashboard-content">
        <article class="buyer-recent-orders surface">
          <header class="buyer-dashboard-section-heading"><div><p class="eyebrow">Aktivitas terbaru</p><h2>Pesanan terakhir</h2></div><NuxtLink to="/akun/pesanan">Riwayat <Icon name="lucide:arrow-up-right" /></NuxtLink></header>
          <div v-if="latestOrders.length" class="buyer-recent-order-list">
            <NuxtLink v-for="order in latestOrders" :key="order.id" class="buyer-recent-order" :to="`/akun/pesanan/${order.id}`">
              <span class="buyer-recent-order__icon"><Icon name="lucide:package" /></span>
              <span class="buyer-recent-order__copy"><span><strong>{{ order.order_number }}</strong><small>{{ formatDate(order.created_at) }}</small></span><b>{{ orderProductSummary(order) }}</b><small>{{ order.vendor_orders.length }} toko · {{ formatRupiah(order.totals.grand_total) }}</small></span>
              <span class="buyer-recent-order__status"><span class="badge" :class="{ 'badge--warning': order.order_state === 'AWAITING_PAYMENT' || order.order_state === 'REVIEW' }">{{ statusLabel(order.order_state) }}</span><Icon name="lucide:chevron-right" /></span>
            </NuxtLink>
          </div>
          <div v-else class="buyer-dashboard-empty"><span><Icon name="lucide:shopping-bag" /></span><div><strong>Belum ada pesanan</strong><p>Temukan produk dari toko terpercaya dan mulai transaksi pertama Anda.</p></div><NuxtLink class="button button--secondary" to="/cari">Jelajahi produk</NuxtLink></div>
        </article>

        <aside class="buyer-dashboard-side">
          <section class="buyer-address-card surface">
            <header><span class="buyer-dashboard-icon buyer-dashboard-icon--blue"><Icon name="lucide:map-pin-house" /></span><div><small>Alamat utama</small><h2>{{ defaultAddress?.label || 'Alamat pengiriman' }}</h2></div></header>
            <template v-if="defaultAddress"><strong>{{ defaultAddress.recipient_name }}</strong><p>{{ defaultAddress.street }}, {{ defaultAddress.district }}, {{ defaultAddress.city }} {{ defaultAddress.postal_code }}</p></template>
            <p v-else>Tambahkan alamat agar proses checkout menjadi lebih cepat.</p>
            <NuxtLink to="/akun/alamat">{{ defaultAddress ? 'Kelola alamat' : 'Tambah alamat' }} <Icon name="lucide:arrow-right" /></NuxtLink>
          </section>
          <section class="buyer-context-card"><span><Icon name="lucide:shield-check" /></span><div><p class="eyebrow">Belanja aman</p><h2>Transaksi terlindungi</h2><p>Pembayaran dan status pengiriman tercatat dalam akun Anda.</p></div></section>
        </aside>
      </section>

      <section aria-labelledby="quick-menu-title">
        <header class="buyer-dashboard-section-heading buyer-dashboard-section-heading--quick"><div><p class="eyebrow">Akses cepat</p><h2 id="quick-menu-title">Kelola kebutuhan Anda</h2></div></header>
        <div class="buyer-quick-grid">
          <NuxtLink v-for="action in quickActions" :key="action.title" class="buyer-quick-card" :to="action.to">
            <span class="buyer-dashboard-icon" :class="`buyer-dashboard-icon--${action.tone}`"><Icon :name="action.icon" /><b v-if="action.badge">{{ action.badge > 99 ? '99+' : action.badge }}</b></span>
            <span><strong>{{ action.title }}</strong><small>{{ action.detail }}</small></span><Icon name="lucide:arrow-up-right" class="buyer-quick-card__arrow" />
          </NuxtLink>
        </div>
      </section>
    </ApiState>
  </main>
</template>
