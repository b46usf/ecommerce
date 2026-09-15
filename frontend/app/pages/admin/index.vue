<script setup lang="ts">
import { unwrap } from '~/api/client'

definePageMeta({ middleware: ['auth', 'admin'] })
const api = useMarketplaceApi()
const { user } = useAuth()
const pending = ref(true)
const error = ref<ReturnType<typeof import('~/utils/errors').displayError>>()
const metrics = reactive({ stores: 0, entities: 0, receipts: 0, refunds: 0, cases: 0 })

async function load() {
  pending.value = true
  error.value = undefined
  const calls = [
    api.GET('/admin/stores', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    api.GET('/admin/legal-entities', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    api.GET('/admin/payment-receipts', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    api.GET('/admin/refunds', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    api.GET('/admin/cases', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
  ] as const
  const results = await Promise.allSettled(calls)
  metrics.stores = results[0].status === 'fulfilled' ? results[0].value.items.filter(x => x.status === 'SUBMITTED').length : 0
  metrics.entities = results[1].status === 'fulfilled' ? results[1].value.items.filter(x => x.status === 'PENDING').length : 0
  metrics.receipts = results[2].status === 'fulfilled' ? results[2].value.items.filter(x => x.application_status !== 'APPLIED').length : 0
  metrics.refunds = results[3].status === 'fulfilled' ? results[3].value.items.filter(x => ['REQUESTED', 'UNKNOWN'].includes(x.state)).length : 0
  metrics.cases = results[4].status === 'fulfilled' ? results[4].value.items.filter(x => x.state === 'OPEN').length : 0
  if (results.every(x => x.status === 'rejected')) error.value = (await import('~/utils/errors')).displayError((results[0] as PromiseRejectedResult).reason)
  pending.value = false
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Dashboard admin — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <PortalNav area="admin" />
    <div class="section-heading"><div><p class="eyebrow">Control room</p><h1>Dashboard admin</h1><p>Antrean aktif saat halaman dimuat. Waktu mengikuti zona browser.</p></div><span class="badge">{{ user?.admin_roles.join(', ') }}</span></div>
    <ApiState :pending="pending" :error="error" @retry="load">
      <div class="metric-grid">
        <NuxtLink class="surface metric" to="/admin/moderasi"><span>Toko menunggu</span><strong>{{ metrics.stores }}</strong></NuxtLink>
        <NuxtLink class="surface metric" to="/admin/moderasi"><span>Entitas menunggu</span><strong>{{ metrics.entities }}</strong></NuxtLink>
        <NuxtLink class="surface metric" to="/admin/pembayaran"><span>Receipt belum applied</span><strong>{{ metrics.receipts }}</strong></NuxtLink>
        <NuxtLink class="surface metric" to="/admin/refund"><span>Refund perlu aksi</span><strong>{{ metrics.refunds }}</strong></NuxtLink>
        <NuxtLink class="surface metric" to="/admin/kasus"><span>Kasus terbuka</span><strong>{{ metrics.cases }}</strong></NuxtLink>
      </div>
      <section class="surface section"><h2>Prinsip operasional</h2><p>Seluruh keputusan membutuhkan alasan, versi data terkini, dan kunci idempotensi. Perubahan akan tercatat di audit log.</p><NuxtLink class="button" to="/admin/jurnal">Buka jurnal dan audit</NuxtLink></section>
    </ApiState>
  </main>
</template>
