<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, formatRupiah, statusLabel } from '~/utils/format'

type Order = components['schemas']['OrderGroup']
definePageMeta({ middleware: 'auth' })
const api = useMarketplaceApi()
const cartApi = useCart()
const orders = ref<Order[]>([])
const stores = ref<Record<string, string>>({})
const nextCursor = ref<string | null>(null)
const pending = ref(true)
const error = ref<unknown>()
const filter = ref('ALL')
const visible = computed(() => filter.value === 'ALL' ? orders.value : orders.value.filter(order => order.order_state === filter.value || order.payment_status === filter.value || order.vendor_orders.some(item => item.fulfillment_status === filter.value)))

async function load(cursor?: string) {
  pending.value = true
  error.value = undefined
  try {
    if (!cartApi.account.value) await cartApi.load()
    const result = unwrap(await api.GET('/buyer-accounts/{buyerAccountId}/orders', { params: { path: { buyerAccountId: cartApi.account.value!.id }, query: { limit: 20, cursor } }, cache: 'no-store' }))
    orders.value = cursor ? [...orders.value, ...result.items] : result.items
    nextCursor.value = result.next_cursor
    const ids = [...new Set(result.items.flatMap(order => order.vendor_orders.map(vendor => vendor.store_id)))].filter(id => !stores.value[id])
    const pairs = await Promise.all(ids.map(async (id) => {
      try { return [id, unwrap(await api.GET('/stores/{storeId}', { params: { path: { storeId: id } } })).name] as const }
      catch { return [id, `Toko ${id.slice(0, 8)}`] as const }
    }))
    stores.value = { ...stores.value, ...Object.fromEntries(pairs) }
  } catch (cause) {
    error.value = cause
  } finally {
    pending.value = false
  }
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Pesanan saya — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <BuyerNav />
    <div class="section-heading">
      <div><p class="eyebrow">Riwayat transaksi</p><h1>Pesanan saya</h1></div>
      <label>Filter <select v-model="filter" class="select-control"><option value="ALL">Semua</option><option value="AWAITING_PAYMENT">Menunggu pembayaran</option><option value="PROCESSING">Diproses</option><option value="SHIPPED">Dikirim</option><option value="COMPLETED">Selesai</option><option value="CANCELLED">Dibatalkan</option><option value="REVIEW">Dalam pemeriksaan</option></select></label>
    </div>
    <ApiState :pending="pending && !orders.length" :error="error ? displayError(error) : null" :empty="!pending && !visible.length" skeleton="list" :skeleton-count="5" loading-label="Memuat pesanan" empty-title="Belum ada pesanan" empty-message="Pesanan yang sudah dikonfirmasi akan tampil di sini." @retry="load">
      <template #action><NuxtLink class="button" to="/cari">Mulai belanja</NuxtLink></template>
      <div class="order-list">
        <NuxtLink v-for="order in visible" :key="order.id" class="surface order-card" :to="`/akun/pesanan/${order.id}`">
          <header><div><strong>{{ order.order_number }}</strong><small>{{ formatDate(order.created_at) }}</small></div><span class="badge" :class="{ 'badge--warning': order.order_state === 'REVIEW' || order.order_state === 'AWAITING_PAYMENT' }">{{ statusLabel(order.order_state) }}</span></header>
          <div v-for="vendor in order.vendor_orders" :key="vendor.id" class="summary-line"><span>{{ stores[vendor.store_id] || `Toko ${vendor.store_id.slice(0, 8)}` }} · {{ statusLabel(vendor.fulfillment_status) }}</span><strong>{{ formatRupiah(vendor.buyer_total) }}</strong></div>
          <footer><span>Pembayaran: {{ statusLabel(order.payment_status) }}</span><strong>{{ formatRupiah(order.totals.grand_total) }}</strong></footer>
        </NuxtLink>
      </div>
      <LoadingSkeleton v-if="pending && orders.length" class="section" variant="list" :count="3" label="Memuat pesanan berikutnya" />
      <button v-else-if="nextCursor" type="button" @click="load(nextCursor ?? undefined)"><Icon name="lucide:chevrons-down" />Muat berikutnya</button>
    </ApiState>
  </main>
</template>
