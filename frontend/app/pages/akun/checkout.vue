<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatRupiah } from '~/utils/format'

type ShippingQuote = components['schemas']['ShippingQuote']
type CheckoutPreview = components['schemas']['CheckoutPreview']
definePageMeta({ middleware: 'auth' })
const api = useMarketplaceApi()
const cartApi = useCart()
const addressApi = useAddresses()
const { itemIds } = useCheckoutState()
const selectedAddress = ref('')
const rates = ref<ShippingQuote[]>([])
const selectedRates = reactive<Record<string, string>>({})
const preview = ref<CheckoutPreview>()
const consent = ref(false)
const initialLoading = ref(true)
const loadingRates = ref(false)
const loadingPreview = ref(false)
const confirming = ref(false)
const message = ref('')

const selectedItems = computed(() => {
  const all = cartApi.cart.value?.items ?? []
  const ids = itemIds.value.length ? new Set(itemIds.value) : new Set(all.map(item => item.id))
  return all.filter(item => ids.has(item.id))
})
const stores = computed(() => [...new Set(selectedItems.value.map(item => item.store_id))])
const storeName = (id: string) => selectedItems.value.find(item => item.store_id === id)?.store_name ?? `Toko ${id.slice(0, 8)}`
const rateGroups = computed(() => stores.value.map(storeId => ({ storeId, items: rates.value.filter(rate => rate.store_id === storeId) })))
const allRatesSelected = computed(() => Boolean(stores.value.length) && stores.value.every(id => selectedRates[id]))

onMounted(async () => {
  try {
    await Promise.all([cartApi.load(), addressApi.load()])
    if (!selectedItems.value.length) {
      await navigateTo('/akun/keranjang')
      return
    }
    selectedAddress.value = addressApi.addresses.value.find(address => address.is_default)?.id ?? addressApi.addresses.value[0]?.id ?? ''
    if (selectedAddress.value) await loadRates()
  } catch (cause) {
    message.value = displayError(cause).message
  } finally {
    initialLoading.value = false
  }
})

async function loadRates() {
  if (!cartApi.account.value || !cartApi.cart.value || !selectedAddress.value) return
  loadingRates.value = true
  preview.value = undefined
  rates.value = []
  for (const key of Object.keys(selectedRates)) delete selectedRates[key]
  message.value = ''
  try {
    const result = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/shipping-rates', {
      params: { path: { buyerAccountId: cartApi.account.value.id } },
      body: { address_id: selectedAddress.value, cart_item_ids: selectedItems.value.map(item => item.id), cart_version: cartApi.cart.value.row_version },
    }))
    rates.value = result.items
    for (const group of rateGroups.value) if (group.items[0]) selectedRates[group.storeId] = group.items[0].id
  } catch (cause) {
    message.value = displayError(cause, 'Ongkir belum tersedia. Periksa alamat lalu coba lagi.').message
  } finally {
    loadingRates.value = false
  }
}

async function createPreview() {
  if (!cartApi.account.value || !cartApi.cart.value || !allRatesSelected.value) return
  loadingPreview.value = true
  message.value = ''
  try {
    preview.value = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/checkout/preview', {
      params: { path: { buyerAccountId: cartApi.account.value.id } },
      body: { address_id: selectedAddress.value, cart_item_ids: selectedItems.value.map(item => item.id), cart_version: cartApi.cart.value.row_version, shipping_quote_ids: stores.value.map(id => selectedRates[id]!) },
    }))
  } catch (cause) {
    message.value = displayError(cause, 'Ringkasan harga berubah. Ambil ulang ongkir dan periksa kembali.').message
  } finally {
    loadingPreview.value = false
  }
}

async function confirmOrder() {
  if (!cartApi.account.value || !preview.value || !consent.value) return
  confirming.value = true
  message.value = ''
  try {
    const order = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/checkout/confirm', {
      params: { path: { buyerAccountId: cartApi.account.value.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { preview_token: preview.value.preview_token },
    }))
    itemIds.value = []
    await cartApi.load()
    await navigateTo(`/akun/pesanan/${order.id}`)
  } catch (cause) {
    message.value = displayError(cause, 'Checkout berubah atau kedaluwarsa. Buat ringkasan baru.').message
    preview.value = undefined
    consent.value = false
  } finally {
    confirming.value = false
  }
}

useSeoMeta({ title: 'Checkout — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <BuyerNav />
    <div class="section-heading"><div><p class="eyebrow">Checkout aman</p><h1>Periksa dan buat pesanan</h1></div><NuxtLink to="/akun/keranjang">Kembali ke keranjang</NuxtLink></div>
    <ApiState :pending="initialLoading" skeleton="detail" loading-label="Menyiapkan checkout">
      <div class="checkout-layout">
        <section class="checkout-steps">
          <article class="surface"><span class="step-number">1</span><h2>Konteks pembelian</h2><p>{{ cartApi.account.value?.kind === 'ORGANIZATION' ? cartApi.account.value.organization_name : 'Pembelian pribadi' }}</p></article>
          <article class="surface">
            <span class="step-number">2</span>
            <div class="section-heading"><h2>Alamat tujuan</h2><NuxtLink to="/akun/alamat">Kelola alamat</NuxtLink></div>
            <ApiState :pending="addressApi.pending.value" :empty="!addressApi.pending.value && !addressApi.addresses.value.length" skeleton="form" :skeleton-count="1" loading-label="Memuat alamat" empty-title="Alamat diperlukan" empty-message="Tambahkan alamat dengan area ID atau koordinat agar ongkir dapat dihitung.">
              <template #action><NuxtLink class="button" to="/akun/alamat">Tambah alamat</NuxtLink></template>
              <label class="form-field">Pilih alamat<select v-model="selectedAddress" @change="loadRates"><option v-for="address in addressApi.addresses.value" :key="address.id" :value="address.id">{{ address.label }} — {{ address.recipient_name }}, {{ address.city }}</option></select></label>
            </ApiState>
          </article>
          <article class="surface">
            <span class="step-number">3</span>
            <div class="section-heading"><h2>Pengiriman per toko</h2><button class="button--secondary" type="button" :disabled="loadingRates || !selectedAddress" @click="loadRates">Muat ulang ongkir</button></div>
            <LoadingSkeleton v-if="loadingRates" variant="list" :count="Math.max(stores.length, 2)" label="Meminta tarif pengiriman" />
            <div v-else class="shipping-groups"><fieldset v-for="group in rateGroups" :key="group.storeId"><legend>{{ storeName(group.storeId) }}</legend><label v-for="rate in group.items" :key="rate.id" class="shipping-option"><input v-model="selectedRates[group.storeId]" type="radio" :name="`rate-${group.storeId}`" :value="rate.id" @change="preview = undefined"><span><strong>{{ rate.courier_code.toUpperCase() }} · {{ rate.service_code }}</strong><small>{{ rate.estimated_delivery || 'Estimasi mengikuti kurir' }} · berlaku sampai {{ new Date(rate.valid_until).toLocaleTimeString('id-ID') }}</small></span><strong>{{ formatRupiah(rate.final_amount) }}</strong></label><p v-if="!group.items.length" class="error">Ongkir belum tersedia untuk toko ini.</p></fieldset></div>
          </article>
          <article class="surface"><span class="step-number">4</span><h2>Produk yang dipilih</h2><div v-for="item in selectedItems" :key="item.id" class="summary-line"><span>{{ item.product_name }} × {{ item.quantity }}<small class="muted"> · {{ item.store_name }}</small></span><strong>{{ formatRupiah(item.unit_price_gross * item.quantity) }}</strong></div></article>
        </section>

        <aside class="surface order-summary">
          <h2>Ringkasan server</h2>
          <LoadingSkeleton v-if="loadingPreview" variant="compact" :count="6" label="Menghitung total final" />
          <template v-else-if="preview">
            <div class="summary-line"><span>Nilai bersih</span><span>{{ formatRupiah(preview.totals.items_net) }}</span></div><div class="summary-line"><span>PPN</span><span>{{ formatRupiah(preview.totals.items_vat) }}</span></div><div class="summary-line"><span>Produk</span><span>{{ formatRupiah(preview.totals.items_gross) }}</span></div><div class="summary-line"><span>Ongkir</span><span>{{ formatRupiah(preview.totals.shipping) }}</span></div><div class="summary-line"><span>Biaya pembeli</span><span>{{ formatRupiah(preview.totals.buyer_fee) }}</span></div><div class="summary-line summary-total"><strong>Total</strong><strong>{{ formatRupiah(preview.totals.grand_total) }}</strong></div>
            <small class="muted">Ringkasan berlaku sampai {{ new Date(preview.expires_at).toLocaleTimeString('id-ID') }}.</small>
            <label class="checkbox"><input v-model="consent" type="checkbox">Saya menyetujui ringkasan harga dan pembuatan pesanan.</label>
            <button :disabled="confirming || !consent" type="button" @click="confirmOrder">{{ confirming ? 'Membuat pesanan…' : 'Buat pesanan' }}</button>
            <p class="form-help">Metode pembayaran dipilih setelah pesanan terbentuk sesuai kontrak backend.</p>
          </template>
          <button v-else :disabled="!allRatesSelected" type="button" @click="createPreview">Hitung total final</button>
          <p v-if="message" class="error" role="alert">{{ message }}</p>
        </aside>
      </div>
    </ApiState>
  </main>
</template>
