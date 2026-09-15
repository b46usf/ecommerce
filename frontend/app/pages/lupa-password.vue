<script setup lang="ts">
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'

const api = useMarketplaceApi()
const email = ref('')
const pending = ref(false)
const message = ref('')
const error = ref('')

async function submit() {
  pending.value = true
  error.value = ''
  try { message.value = unwrap(await api.POST('/auth/forgot-password', { body: { email: email.value } })).message }
  catch (cause) { error.value = displayError(cause).message }
  finally { pending.value = false }
}

useSeoMeta({ title: 'Lupa password — Niaga' })
</script>

<template>
  <main id="main-content" class="auth-shell">
    <form class="auth-card" @submit.prevent="submit">
      <div class="auth-heading">
        <span class="auth-icon" aria-hidden="true"><Icon name="lucide:key-round" /></span>
        <div><p class="eyebrow"><Icon name="lucide:shield-check" /> Pemulihan akun</p><h1>Lupa password</h1></div>
        <p class="muted">Masukkan email akun. Respons tetap sama untuk menjaga keamanan akun.</p>
      </div>
      <label class="form-field">
        <span class="field-label"><Icon name="lucide:mail" /> Email</span>
        <span class="input-with-icon"><Icon name="lucide:mail" aria-hidden="true" /><input v-model.trim="email" required type="email" autocomplete="email" placeholder="nama@email.com"></span>
      </label>
      <p v-if="message" class="form-feedback form-feedback--success" role="status"><Icon name="lucide:mail-check" aria-hidden="true" /><span>{{ message }}</span></p>
      <p v-if="error" class="form-feedback form-feedback--error" role="alert"><Icon name="lucide:circle-alert" aria-hidden="true" /><span>{{ error }}</span></p>
      <button :disabled="pending || !email" type="submit"><Icon :name="pending ? 'lucide:loader-circle' : 'lucide:send'" :class="{ 'animate-spin': pending }" aria-hidden="true" />{{ pending ? 'Mengirim…' : 'Kirim tautan reset' }}</button>
      <NuxtLink class="auth-back-link" to="/login"><Icon name="lucide:arrow-left" /> Kembali ke halaman masuk</NuxtLink>
    </form>
  </main>
</template>
