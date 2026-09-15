<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap, versionHeaders } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, statusLabel } from '~/utils/format'

type Store = components['schemas']['Store']
type Entity = components['schemas']['LegalEntity']
type Document = components['schemas']['Document']

definePageMeta({ middleware: ['auth', 'admin'] })
const api = useMarketplaceApi()
const stores = ref<Store[]>([])
const entities = ref<Entity[]>([])
const document = ref<Document>()
const documentId = ref('')
const selected = ref<{ type: 'store' | 'entity'; item: Store | Entity }>()
const reason = ref('')
const pending = ref(true)
const message = ref('')

async function load() {
  pending.value = true
  const results = await Promise.allSettled([
    api.GET('/admin/stores', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    api.GET('/admin/legal-entities', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
  ])
  if (results[0].status === 'fulfilled') stores.value = results[0].value.items
  if (results[1].status === 'fulfilled') entities.value = results[1].value.items
  if (results.every(x => x.status === 'rejected')) message.value = displayError((results[0] as PromiseRejectedResult).reason).message
  pending.value = false
}

async function decide(decision: 'APPROVE' | 'REJECT') {
  if (!selected.value || reason.value.trim().length < 3) return
  try {
    const item = selected.value.item
    if (selected.value.type === 'store') {
      unwrap(await api.POST('/admin/stores/{storeId}/decision', { params: { path: { storeId: item.id }, header: { ...versionHeaders(item.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { decision, reason: reason.value } }))
    }
    else {
      unwrap(await api.POST('/admin/legal-entities/{legalEntityId}/decision', { params: { path: { legalEntityId: item.id }, header: { ...versionHeaders(item.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { decision, reason: reason.value } }))
    }
    message.value = `Keputusan ${decision.toLowerCase()} disimpan.`
    reason.value = ''; selected.value = undefined; await load()
  }
  catch (cause) { message.value = displayError(cause).message }
}

async function suspend(store: Store) {
  const explanation = prompt('Alasan penangguhan minimal 3 karakter')
  if (!explanation) return
  try { unwrap(await api.POST('/admin/stores/{storeId}/suspend', { params: { path: { storeId: store.id }, header: { ...versionHeaders(store.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { reason: explanation } })); await load() }
  catch (cause) { message.value = displayError(cause).message }
}

async function loadDocument() {
  try { document.value = unwrap(await api.GET('/documents/{documentId}', { params: { path: { documentId: documentId.value } }, cache: 'no-store' })) }
  catch (cause) { message.value = displayError(cause).message }
}

async function decideDocument(decision: 'APPROVE' | 'REJECT') {
  if (!document.value || reason.value.length < 3) return
  try { document.value = unwrap(await api.POST('/admin/documents/{documentId}/decision', { params: { path: { documentId: document.value.id }, header: { ...versionHeaders(document.value.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { decision, reason: reason.value } })); message.value = 'Dokumen ditinjau.' }
  catch (cause) { message.value = displayError(cause).message }
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Moderasi vendor — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell"><PortalNav area="admin" />
    <div class="section-heading"><div><p class="eyebrow">Maker review</p><h1>Moderasi vendor</h1></div></div>
    <p v-if="message" class="surface" role="status">{{ message }}</p>
    <ApiState :pending="pending">
      <div class="admin-split">
        <section class="surface table-wrap"><h2>Toko</h2><table><thead><tr><th>Nama</th><th>Status</th><th>Aksi</th></tr></thead><tbody><tr v-for="item in stores" :key="item.id"><td><strong>{{ item.name }}</strong><small>{{ item.slug }} · {{ formatDate(item.created_at) }}</small></td><td><span class="badge">{{ statusLabel(item.status) }}</span></td><td class="table-actions"><button v-if="item.status === 'SUBMITTED'" class="button--secondary" @click="selected={type:'store',item}">Tinjau</button><button v-if="item.status === 'ACTIVE'" class="text-button" @click="suspend(item)">Tangguhkan</button></td></tr></tbody></table></section>
        <section class="surface table-wrap"><h2>Entitas legal</h2><table><thead><tr><th>Nama legal</th><th>Status</th><th>Aksi</th></tr></thead><tbody><tr v-for="item in entities" :key="item.id"><td><strong>{{ item.legal_name }}</strong><small>{{ item.kind }} · {{ item.tax_identifier_masked || 'NPWP belum ada' }}</small></td><td><span class="badge">{{ statusLabel(item.status) }}</span></td><td><button v-if="item.status !== 'VERIFIED'" class="button--secondary" @click="selected={type:'entity',item}">Tinjau</button></td></tr></tbody></table></section>
      </div>
      <section v-if="selected" class="surface section review-panel"><h2>Keputusan untuk {{ 'name' in selected.item ? selected.item.name : selected.item.legal_name }}</h2><label class="form-field">Alasan<textarea v-model="reason" minlength="3" rows="3" required /></label><div class="form-actions"><button :disabled="reason.length < 3" @click="decide('APPROVE')">Setujui</button><button class="button--secondary" :disabled="reason.length < 3" @click="decide('REJECT')">Tolak</button></div></section>
      <section class="surface section"><h2>Viewer dokumen terlindungi</h2><div class="filter-bar"><label class="form-field">Document ID<input v-model="documentId"></label><button :disabled="!documentId" @click="loadDocument">Muat</button></div><div v-if="document" class="review-panel"><p><strong>{{ document.filename }}</strong> · {{ document.document_type }}</p><span class="badge">{{ statusLabel(document.verification_status) }}</span><a v-if="document.download_url" class="button button--secondary" :href="document.download_url" target="_blank" rel="noopener">Buka sementara</a><label class="form-field">Alasan keputusan<textarea v-model="reason" minlength="3" /></label><div class="form-actions"><button @click="decideDocument('APPROVE')">Verifikasi</button><button class="button--secondary" @click="decideDocument('REJECT')">Tolak</button></div></div></section>
    </ApiState>
  </main>
</template>
