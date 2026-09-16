<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap, versionHeaders } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, statusLabel } from '~/utils/format'

type Entity = components['schemas']['LegalEntity']
type Profile = components['schemas']['TaxProfile']

definePageMeta({ middleware: ['auth', 'admin'] })
const api = useMarketplaceApi()
const appAlert = useAppAlert()
const entities = ref<Entity[]>([])
const profiles = ref<Profile[]>([])
const entityId = ref('')
const form = reactive({ is_pkp: false, collector_enabled: false, valid_from: new Date().toISOString().slice(0, 10), valid_until: '', collector_basis_document_id: '', document_ids: '' })
const pending = ref(true)
const message = ref('')

async function loadEntities() {
  pending.value = true
  try { entities.value = unwrap(await api.GET('/admin/legal-entities', { params: { query: { limit: 100 } }, cache: 'no-store' })).items; entityId.value ||= entities.value[0]?.id || ''; if (entityId.value) await loadProfiles() }
  catch (cause) { message.value = displayError(cause).message }
  finally { pending.value = false }
}
async function loadProfiles() {
  if (!entityId.value) return
  try { profiles.value = unwrap(await api.GET('/admin/legal-entities/{legalEntityId}/tax-profiles', { params: { path: { legalEntityId: entityId.value }, query: { limit: 100 } }, cache: 'no-store' })).items }
  catch (cause) { message.value = displayError(cause).message }
}
async function create() {
  try {
    unwrap(await api.POST('/admin/legal-entities/{legalEntityId}/tax-profiles', {
      params: { path: { legalEntityId: entityId.value }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { is_pkp: form.is_pkp, collector_enabled: form.collector_enabled, valid_from: new Date(form.valid_from).toISOString(), valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null, collector_basis_document_id: form.collector_basis_document_id || undefined, document_ids: form.document_ids.split(/[,\s]+/).filter(Boolean) },
    }))
    message.value = 'Profil pajak dibuat sebagai draft.'; await loadProfiles()
  }
  catch (cause) { message.value = displayError(cause).message }
}
async function verify(item: Profile) {
  const reason = await appAlert.promptText({ title: 'Verifikasi profil pajak?', text: 'Pastikan semua dokumen dan status perpajakan telah diperiksa.', inputLabel: 'Alasan verifikasi', confirmText: 'Verifikasi profil' })
  if (!reason) return
  try { unwrap(await api.POST('/admin/tax-profiles/{taxProfileId}/verify', { params: { path: { taxProfileId: item.id }, header: { ...versionHeaders(item.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { reason } })); await loadProfiles(); await appAlert.success({ title: 'Profil pajak terverifikasi' }) }
  catch (cause) { message.value = displayError(cause).message; await appAlert.error({ title: 'Verifikasi gagal', text: message.value }) }
}
onMounted(() => { void loadEntities() })
useSeoMeta({ title: 'Profil pajak vendor — Niaga' })
</script>

<template><main id="main-content" class="page-shell"><PortalNav area="admin" /><div class="section-heading"><div><p class="eyebrow">Kepatuhan</p><h1>Profil pajak vendor</h1></div></div><p v-if="message" class="surface" role="status">{{ message }}</p><ApiState :pending="pending"><label class="surface form-field">Entitas legal<select v-model="entityId" @change="loadProfiles"><option v-for="item in entities" :key="item.id" :value="item.id">{{ item.legal_name }} · {{ statusLabel(item.status) }}</option></select></label><div class="admin-split section"><section class="surface"><h2>Riwayat profil</h2><div class="card-list"><article v-for="item in profiles" :key="item.id" class="policy-card"><div class="section-heading"><strong>{{ item.is_pkp ? 'PKP' : 'Non-PKP' }}</strong><span class="badge">{{ statusLabel(item.status) }}</span></div><p>Collector: {{ item.collector_enabled ? 'Aktif' : 'Tidak' }}</p><small>{{ formatDate(item.valid_from) }} — {{ item.valid_until ? formatDate(item.valid_until) : 'tanpa akhir' }}</small><p class="muted">Evidence: {{ item.document_ids?.join(', ') || 'tidak ada' }}</p><button v-if="item.status==='DRAFT'" class="button--secondary" @click="verify(item)">Verifikasi</button></article><p v-if="!profiles.length">Belum ada profil.</p></div></section><form class="surface form-stack" @submit.prevent="create"><h2>Profil baru</h2><label class="checkbox"><input v-model="form.is_pkp" type="checkbox">PKP</label><label class="checkbox"><input v-model="form.collector_enabled" type="checkbox">Pemungut pajak</label><label class="form-field">Berlaku mulai<input v-model="form.valid_from" type="date" required></label><label class="form-field">Berlaku sampai<input v-model="form.valid_until" type="date"></label><label class="form-field">Document ID dasar pemungut<input v-model="form.collector_basis_document_id"></label><label class="form-field">Document IDs bukti<textarea v-model="form.document_ids" placeholder="Pisahkan dengan koma" /></label><button :disabled="!entityId">Buat draft</button></form></div></ApiState></main></template>
