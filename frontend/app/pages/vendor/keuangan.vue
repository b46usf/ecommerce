<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, formatRupiah, statusLabel } from '~/utils/format'

type Payable = components['schemas']['Payable']
type Payout = components['schemas']['Payout']

definePageMeta({ middleware: 'auth' })
const api = useMarketplaceApi()
const portal = usePortal()
const payables = ref<Payable[]>([])
const payouts = ref<Payout[]>([])
const pending = ref(true)
const error = ref<ReturnType<typeof displayError>>()
const available = computed(() => payables.value.reduce((sum, item) => sum + Math.max(0, item.balance - item.reserved_payout), 0))

async function load() {
  pending.value = true
  error.value = undefined
  try {
    if (!portal.activeStore.value) await portal.loadStores()
    const id = portal.storeId.value
    const [payablePage, payoutPage] = await Promise.all([
      api.GET('/vendor/stores/{storeId}/payables', { params: { path: { storeId: id }, query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
      api.GET('/vendor/stores/{storeId}/payouts', { params: { path: { storeId: id }, query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    ])
    payables.value = payablePage.items
    payouts.value = payoutPage.items
  }
  catch (cause) { error.value = displayError(cause) }
  finally { pending.value = false }
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Keuangan vendor — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <PortalNav area="vendor" />
    <div class="section-heading"><div><p class="eyebrow">Keuangan</p><h1>Hak penerimaan dan payout</h1></div><StoreSwitcher /></div>
    <ApiState :pending="pending" :error="error" @retry="load">
      <div class="metric-grid">
        <article class="surface metric"><span>Saldo tersedia</span><strong>{{ formatRupiah(available) }}</strong></article>
        <article class="surface metric"><span>Dicadangkan</span><strong>{{ formatRupiah(payables.reduce((sum, x) => sum + x.reserved_payout, 0)) }}</strong></article>
        <article class="surface metric"><span>Hak diblokir</span><strong>{{ payables.filter(x => x.eligibility === 'BLOCKED').length }}</strong></article>
      </div>
      <section class="section">
        <div class="section-heading"><h2>Rincian hak vendor</h2><small class="muted">Saldo diblokir jika order masih dalam kasus atau belum memenuhi syarat settlement.</small></div>
        <div class="table-wrap surface"><table><thead><tr><th>Order</th><th>Saldo</th><th>Dicadangkan</th><th>Kelayakan</th></tr></thead><tbody><tr v-for="item in payables" :key="item.id"><td><NuxtLink :to="`/vendor/pesanan/${item.vendor_order_id}`">{{ item.vendor_order_id.slice(0, 8) }}</NuxtLink></td><td>{{ formatRupiah(item.balance) }}</td><td>{{ formatRupiah(item.reserved_payout) }}</td><td><span class="badge" :class="{ 'badge--warning': item.eligibility === 'BLOCKED' }">{{ statusLabel(item.eligibility) }}</span></td></tr><tr v-if="!payables.length"><td colspan="4">Belum ada hak penerimaan.</td></tr></tbody></table></div>
      </section>
      <section class="section">
        <h2>Riwayat payout</h2>
        <div class="table-wrap surface"><table><thead><tr><th>Tanggal</th><th>ID</th><th>Nominal</th><th>Status</th></tr></thead><tbody><tr v-for="item in payouts" :key="item.id"><td>{{ formatDate(item.created_at) }}</td><td><code>{{ item.id.slice(0, 8) }}</code></td><td>{{ formatRupiah(item.amount) }}</td><td><span class="badge">{{ statusLabel(item.state) }}</span></td></tr><tr v-if="!payouts.length"><td colspan="4">Belum ada payout.</td></tr></tbody></table></div>
      </section>
    </ApiState>
  </main>
</template>
