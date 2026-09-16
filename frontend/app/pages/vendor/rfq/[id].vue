<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap, versionHeaders } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, formatRupiah, statusLabel } from '~/utils/format'

type Quote = components['schemas']['QuoteRequest']

definePageMeta({ middleware: 'auth' })
const api = useMarketplaceApi()
const appAlert = useAppAlert()
const portal = usePortal()
const route = useRoute()
const quote = ref<Quote>()
const prices = reactive<Record<string, number>>({})
const expires = ref(new Date(Date.now() + 86400000).toISOString().slice(0, 16))
const pending = ref(true)
const message = ref('')

async function load() {
  pending.value = true
  try {
    if (!portal.activeStore.value) await portal.loadStores()
    quote.value = unwrap(await api.GET('/vendor/stores/{storeId}/quote-requests/{quoteRequestId}', {
      params: { path: { storeId: portal.storeId.value, quoteRequestId: String(route.params.id) } },
      cache: 'no-store',
    }))
    for (const item of quote.value.items) prices[item.sku_id] ||= 0
  }
  catch (cause) { message.value = displayError(cause).message }
  finally { pending.value = false }
}

async function offer() {
  if (!quote.value) return
  try {
    const version = unwrap(await api.POST('/vendor/stores/{storeId}/quote-requests/{quoteRequestId}/offers', {
      params: {
        path: { storeId: portal.storeId.value, quoteRequestId: quote.value.id },
        header: { ...versionHeaders(quote.value.row_version), 'Idempotency-Key': crypto.randomUUID() },
      },
      body: {
        expires_at: new Date(expires.value).toISOString(),
        items: quote.value.items.map(item => ({
          sku_id: item.sku_id,
          quantity: item.quantity,
          unit_price_gross: prices[item.sku_id] || 0,
        })),
      },
    }))
    message.value = `Penawaran versi ${version.version_no} diterbitkan.`
    await load()
  }
  catch (cause) { message.value = displayError(cause).message }
}

async function reject() {
  if (!quote.value) return
  const reason = await appAlert.promptText({ title: 'Tolak permintaan penawaran?', text: 'Pembeli akan melihat bahwa toko tidak dapat memenuhi RFQ ini.', inputLabel: 'Alasan penolakan', confirmText: 'Tolak RFQ', danger: true })
  if (!reason) return
  try {
    quote.value = unwrap(await api.POST('/vendor/stores/{storeId}/quote-requests/{quoteRequestId}/reject', {
      params: {
        path: { storeId: portal.storeId.value, quoteRequestId: quote.value.id },
        header: { ...versionHeaders(quote.value.row_version), 'Idempotency-Key': crypto.randomUUID() },
      },
      body: { reason },
    }))
    message.value = 'RFQ ditolak.'
    await appAlert.success({ title: 'RFQ ditolak', text: 'Status permintaan penawaran telah diperbarui.' })
  }
  catch (cause) { message.value = displayError(cause).message; await appAlert.error({ title: 'RFQ gagal ditolak', text: message.value }) }
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Detail RFQ vendor — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <PortalNav area="vendor" />
    <ApiState :pending="pending" :empty="!pending && !quote" empty-title="RFQ tidak ditemukan">
      <template v-if="quote">
        <div class="section-heading">
          <div><p class="eyebrow">RFQ {{ quote.id.slice(0, 8) }}</p><h1>Buat versi penawaran</h1><p>{{ formatDate(quote.created_at) }}</p></div>
          <span class="badge">{{ statusLabel(quote.status) }}</span>
        </div>
        <p v-if="message" class="surface" role="status">{{ message }}</p>
        <div class="editor-layout">
          <section class="checkout-steps">
            <article class="surface">
              <h2>Kebutuhan pembeli</h2>
              <div v-for="item in quote.items" :key="item.sku_id" class="summary-line">
                <span>{{ item.product_name }} · {{ item.sku_code }}</span><strong>{{ item.quantity }} unit</strong>
              </div>
            </article>
            <article v-for="version in [...quote.versions].reverse()" :key="version.id" class="surface">
              <div class="section-heading"><h2>Versi {{ version.version_no }}</h2><span class="badge">{{ statusLabel(version.status) }}</span></div>
              <p>Berlaku sampai {{ formatDate(version.expires_at) }}</p>
              <div v-for="line in version.items" :key="line.id" class="summary-line">
                <span>{{ line.product_name }} × {{ line.quantity }}</span><strong>{{ formatRupiah(line.unit_price_gross) }}</strong>
              </div>
            </article>
          </section>
          <form class="surface" @submit.prevent="offer">
            <h2>Harga baru</h2>
            <label v-for="item in quote.items" :key="item.sku_id" class="form-field">
              {{ item.product_name }} · {{ item.quantity }} unit
              <input v-model.number="prices[item.sku_id]" type="number" min="1" required>
            </label>
            <label class="form-field">Berlaku sampai<input v-model="expires" type="datetime-local" required></label>
            <button :disabled="!quote.items.every(x => (prices[x.sku_id] ?? 0) > 0)">Terbitkan versi</button>
            <button class="button--secondary" type="button" @click="reject">Tolak RFQ</button>
          </form>
        </div>
      </template>
    </ApiState>
  </main>
</template>
