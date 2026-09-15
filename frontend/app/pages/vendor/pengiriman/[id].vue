<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, statusLabel } from '~/utils/format'

type Shipment = components['schemas']['Shipment']

definePageMeta({ middleware: 'auth' })
const api = useMarketplaceApi()
const portal = usePortal()
const route = useRoute()
const shipment = ref<Shipment>()
const pending = ref(true)
const error = ref<ReturnType<typeof displayError>>()
const copied = ref(false)

async function load() {
  pending.value = true
  error.value = undefined
  try {
    if (!portal.activeStore.value) await portal.loadStores()
    shipment.value = unwrap(await api.GET('/vendor/stores/{storeId}/shipments/{shipmentId}', {
      params: { path: { storeId: portal.storeId.value, shipmentId: String(route.params.id) } },
      cache: 'no-store',
    }))
  }
  catch (cause) { error.value = displayError(cause) }
  finally { pending.value = false }
}

async function copyWaybill() {
  if (!shipment.value?.waybill_id) return
  await navigator.clipboard.writeText(shipment.value.waybill_id)
  copied.value = true
  setTimeout(() => { copied.value = false }, 1800)
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Pengiriman vendor — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <PortalNav area="vendor" />
    <ApiState :pending="pending" :error="error" :empty="!pending && !shipment" empty-title="Pengiriman tidak ditemukan" @retry="load">
      <template v-if="shipment">
        <div class="section-heading">
          <div><p class="eyebrow">Pengiriman</p><h1>{{ shipment.courier_code || 'Kurir' }} {{ shipment.service_code }}</h1></div>
          <span class="badge">{{ statusLabel(shipment.state) }}</span>
        </div>
        <div class="order-detail-grid">
          <section class="surface">
            <h2>Perjalanan paket</h2>
            <ol v-if="shipment.tracking_events.length" class="timeline">
              <li v-for="event in [...shipment.tracking_events].reverse()" :key="`${event.occurred_at}-${event.status}`">
                <span aria-hidden="true" /><div><strong>{{ statusLabel(event.status) }}</strong><p>{{ event.description }}</p><small>{{ formatDate(event.occurred_at) }}</small></div>
              </li>
            </ol>
            <ApiState v-else empty empty-title="Belum ada pembaruan" empty-message="Status akan muncul setelah kurir memproses paket." />
          </section>
          <aside class="surface order-summary">
            <h2>Nomor resi</h2>
            <code>{{ shipment.waybill_id || 'Belum diterbitkan' }}</code>
            <button v-if="shipment.waybill_id" class="button--secondary" @click="copyWaybill">{{ copied ? 'Tersalin' : 'Salin resi' }}</button>
            <p class="muted">ID order: {{ shipment.vendor_order_id }}</p>
          </aside>
        </div>
      </template>
    </ApiState>
  </main>
</template>
