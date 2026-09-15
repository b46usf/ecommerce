<script setup lang="ts">
import { displayError } from '~/utils/errors'

const route = useRoute()
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const message = ref('')
const requestId = ref<string>()
const { login, pending } = useAuth()

function safeDestination(): string {
  const value = route.query.redirect
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

async function submit() {
  message.value = ''
  requestId.value = undefined
  try {
    await login(email.value, password.value)
    await navigateTo(safeDestination())
  } catch (error) {
    const shown = displayError(error, 'Tidak dapat terhubung ke layanan masuk.')
    message.value = shown.message
    requestId.value = shown.requestId
  }
}

useSeoMeta({ title: 'Masuk — Niaga' })
</script>

<template>
  <main id="main-content" class="auth-shell">
    <form class="auth-card" novalidate @submit.prevent="submit">
      <div class="auth-heading">
        <span class="auth-icon" aria-hidden="true"><Icon name="lucide:log-in" /></span>
        <div>
          <p class="eyebrow"><Icon name="lucide:shield-check" /> Akun Niaga</p>
          <h1>Selamat datang kembali</h1>
        </div>
        <p class="muted">Masuk untuk melanjutkan belanja dan mengelola transaksi.</p>
      </div>

      <label class="form-field">
        <span class="field-label"><Icon name="lucide:mail" /> Email</span>
        <span class="input-with-icon"><Icon name="lucide:mail" aria-hidden="true" /><input v-model.trim="email" required type="email" autocomplete="email" placeholder="nama@email.com"></span>
      </label>
      <label class="form-field">
        <span class="field-label"><Icon name="lucide:lock-keyhole" /> Password</span>
        <span class="input-with-icon input-action">
          <Icon name="lucide:lock-keyhole" aria-hidden="true" />
          <input v-model="password" required :type="showPassword ? 'text' : 'password'" minlength="12" autocomplete="current-password">
          <button class="password-toggle" type="button" :aria-label="showPassword ? 'Sembunyikan password' : 'Tampilkan password'" :title="showPassword ? 'Sembunyikan password' : 'Tampilkan password'" :aria-pressed="showPassword" @click="showPassword = !showPassword"><Icon :name="showPassword ? 'lucide:eye-off' : 'lucide:eye'" aria-hidden="true" /></button>
        </span>
      </label>

      <div v-if="message" class="form-feedback form-feedback--error" role="alert">
        <Icon name="lucide:circle-alert" aria-hidden="true" />
        <span><strong>{{ message }}</strong><small v-if="requestId">ID permintaan: {{ requestId }}</small></span>
      </div>
      <button :disabled="pending || !email || password.length < 12" type="submit">
        <Icon v-if="pending" name="lucide:loader-circle" class="animate-spin" aria-hidden="true" />
        <Icon v-else name="lucide:log-in" aria-hidden="true" />
        {{ pending ? 'Memproses…' : 'Masuk' }}
      </button>
      <div class="auth-links">
        <NuxtLink to="/lupa-password"><Icon name="lucide:key-round" /> Lupa password?</NuxtLink>
        <NuxtLink to="/register"><Icon name="lucide:user-plus" /> Belum punya akun? Daftar</NuxtLink>
      </div>
    </form>
  </main>
</template>
