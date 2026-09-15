<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, statusLabel } from '~/utils/format'

type Bank = components['schemas']['BankAccount']

definePageMeta({ middleware: 'auth' })
const api = useMarketplaceApi()
const portal = usePortal()
const accounts = ref<Bank[]>([])
const form = reactive({ bank_code: '', account_name: '', account_number: '' })
const pending = ref(true)
const saving = ref(false)
const message = ref('')

async function load() {
  pending.value = true
  try {
    if (!portal.activeStore.value) await portal.loadStores()
    accounts.value = unwrap(await api.GET('/vendor/stores/{storeId}/bank-accounts', {
      params: { path: { storeId: portal.storeId.value }, query: { limit: 100 } }, cache: 'no-store',
    })).items
  }
  catch (cause) { message.value = displayError(cause).message }
  finally { pending.value = false }
}

async function create() {
  saving.value = true
  message.value = ''
  try {
    await api.refreshCsrf()
    unwrap(await api.POST('/vendor/stores/{storeId}/bank-accounts', {
      params: { path: { storeId: portal.storeId.value }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { ...form },
    }))
    Object.assign(form, { bank_code: '', account_name: '', account_number: '' })
    message.value = 'Rekening diajukan untuk verifikasi.'
    await load()
  }
  catch (cause) { message.value = displayError(cause).message }
  finally { saving.value = false }
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Rekening vendor — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell">
    <PortalNav area="vendor" />
    <div class="section-heading"><div><p class="eyebrow">Settlement</p><h1>Rekening bank</h1></div><StoreSwitcher /></div>
    <p v-if="message" class="surface" role="status">{{ message }}</p>
    <div class="editor-layout">
      <section>
        <ApiState :pending="pending" :empty="!pending && !accounts.length" empty-title="Belum ada rekening" empty-message="Tambahkan rekening atas nama entitas toko.">
          <div class="card-list"><article v-for="account in accounts" :key="account.id" class="surface"><div class="section-heading"><strong>{{ account.bank_code }}</strong><span class="badge" :class="{ 'badge--warning': account.status === 'PENDING' }">{{ statusLabel(account.status) }}</span></div><h2>{{ account.account_number_masked }}</h2><p>{{ account.account_name }}</p><small class="muted">Diajukan {{ formatDate(account.created_at) }} · perubahan tercatat dalam audit.</small></article></div>
        </ApiState>
      </section>
      <form class="surface form-stack" @submit.prevent="create">
        <h2>Tambah rekening</h2>
        <label class="form-field">Kode bank<input v-model.trim="form.bank_code" placeholder="BCA" minlength="2" required></label>
        <label class="form-field">Nama pemilik<input v-model.trim="form.account_name" minlength="2" required></label>
        <label class="form-field">Nomor rekening<input v-model.trim="form.account_number" inputmode="numeric" minlength="6" required></label>
        <p class="form-help">Nomor rekening disimpan terenkripsi dan hanya versi tersamarkan yang ditampilkan kembali.</p>
        <button :disabled="saving">{{ saving ? 'Mengirim…' : 'Ajukan verifikasi' }}</button>
      </form>
    </div>
  </main>
</template>
