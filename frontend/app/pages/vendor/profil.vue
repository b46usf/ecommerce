<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap, versionHeaders } from '~/api/client'
import { displayError } from '~/utils/errors'
import { statusLabel } from '~/utils/format'

type Store = components['schemas']['Store']
type Origin = components['schemas']['Origin']

definePageMeta({ middleware: 'auth' })
const api = useMarketplaceApi()
const portal = usePortal()
const store = ref<Store>()
const origin = ref<Origin>()
const name = ref('')
const phone = ref('')
const originForm = reactive({ contact_name: '', phone: '', street: '', postal_code: '', area_id: '', latitude: undefined as number | undefined, longitude: undefined as number | undefined })
const pending = ref(true)
const message = ref('')

async function load() {
  pending.value = true
  message.value = ''
  try {
    if (!portal.activeStore.value) await portal.loadStores()
    store.value = portal.activeStore.value || undefined
    if (!store.value) return
    name.value = store.value.name
    try {
      origin.value = unwrap(await api.GET('/vendor/stores/{storeId}/origin', { params: { path: { storeId: store.value.id } }, cache: 'no-store' }))
      Object.assign(originForm, origin.value)
    }
    catch { origin.value = undefined }
  }
  catch (cause) { message.value = displayError(cause).message }
  finally { pending.value = false }
}

async function saveStore() {
  if (!store.value) return
  try {
    store.value = unwrap(await api.PATCH('/vendor/stores/{storeId}', {
      params: { path: { storeId: store.value.id }, header: versionHeaders(store.value.row_version) },
      body: { name: name.value, contact_phone: phone.value || undefined },
    }))
    message.value = 'Profil toko disimpan.'
    await portal.loadStores()
  }
  catch (cause) { message.value = displayError(cause).message }
}

async function saveOrigin() {
  if (!store.value) return
  try {
    origin.value = unwrap(await api.PUT('/vendor/stores/{storeId}/origin', {
      params: { path: { storeId: store.value.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { ...originForm, area_id: originForm.area_id || undefined },
    }))
    message.value = 'Alamat pickup disimpan.'
  }
  catch (cause) { message.value = displayError(cause).message }
}

async function submitReview() {
  if (!store.value) return
  try {
    store.value = unwrap(await api.POST('/vendor/stores/{storeId}/submit', {
      params: { path: { storeId: store.value.id }, header: { ...versionHeaders(store.value.row_version), 'Idempotency-Key': crypto.randomUUID() } },
    }))
    message.value = 'Toko diajukan untuk moderasi.'
  }
  catch (cause) { message.value = displayError(cause).message }
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Profil toko — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <PortalNav area="vendor" />
    <div class="section-heading"><div><p class="eyebrow">Pengaturan toko</p><h1>Profil dan origin</h1></div><StoreSwitcher /></div>
    <ApiState :pending="pending" :empty="!pending && !store" empty-title="Toko belum tersedia">
      <template v-if="store">
        <p v-if="message" class="surface" role="status">{{ message }}</p>
        <div class="editor-layout">
          <form class="surface form-stack" @submit.prevent="saveStore">
            <div class="section-heading"><h2>Identitas toko</h2><span class="badge">{{ statusLabel(store.status) }}</span></div>
            <label class="form-field">Nama toko<input v-model="name" minlength="2" maxlength="160" required></label>
            <label class="form-field">Slug<input :value="store.slug" disabled><small>Slug tetap untuk menjaga tautan publik.</small></label>
            <label class="form-field">Telepon kontak<input v-model="phone" inputmode="tel" placeholder="+62812..."></label>
            <div class="form-actions"><button>Simpan profil</button><button v-if="['DRAFT','REJECTED'].includes(store.status)" type="button" class="button--secondary" @click="submitReview">Ajukan moderasi</button></div>
          </form>
          <form class="surface form-stack" @submit.prevent="saveOrigin">
            <h2>Alamat pickup</h2>
            <label class="form-field">Nama kontak<input v-model="originForm.contact_name" required></label>
            <label class="form-field">Telepon<input v-model="originForm.phone" required></label>
            <label class="form-field">Alamat<textarea v-model="originForm.street" rows="4" required /></label>
            <label class="form-field">Kode pos<input v-model="originForm.postal_code" required></label>
            <label class="form-field">Area ID<input v-model="originForm.area_id"></label>
            <div class="coordinate-grid"><label class="form-field">Latitude<input v-model.number="originForm.latitude" type="number" step="any"></label><label class="form-field">Longitude<input v-model.number="originForm.longitude" type="number" step="any"></label></div>
            <button>Simpan origin</button>
          </form>
        </div>
      </template>
    </ApiState>
  </main>
</template>
