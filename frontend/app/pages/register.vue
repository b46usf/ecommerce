<script setup lang="ts">
import { displayError } from '~/utils/errors'

const name = ref('')
const email = ref('')
const password = ref('')
const consent = ref(false)
const showPassword = ref(false)
const message = ref('')
const success = ref(false)
const requestId = ref<string>()
const { register, pending } = useAuth()

async function submit() {
  message.value = ''
  requestId.value = undefined
  if (name.value.length > 150) { message.value = 'Nama maksimal 150 karakter.'; return }
  if (password.value.length < 12) { message.value = 'Password minimal 12 karakter.'; return }
  if (!consent.value) { message.value = 'Anda perlu menyetujui Syarat & Ketentuan dan Kebijakan Privasi.'; return }
  try {
    await register(name.value, email.value, password.value)
    success.value = true
  } catch (error) {
    const shown = displayError(error, 'Pendaftaran belum dapat diproses.')
    message.value = shown.message
    requestId.value = shown.requestId
  }
}

useSeoMeta({ title: 'Daftar — Niaga' })
</script>

<template>
  <main id="main-content" class="auth-shell">
    <section v-if="success" class="auth-card auth-card--success" aria-live="polite">
      <span class="auth-icon auth-icon--success" aria-hidden="true"><Icon name="lucide:mail-check" /></span>
      <p class="eyebrow"><Icon name="lucide:circle-check-big" /> Pendaftaran berhasil</p>
      <h1>Periksa email Anda</h1>
      <p>Kami mengirim tautan verifikasi ke <strong>{{ email }}</strong>. Buka tautan tersebut sebelum masuk.</p>
      <NuxtLink class="button" to="/login"><Icon name="lucide:log-in" /> Ke halaman masuk</NuxtLink>
    </section>

    <form v-else class="auth-card" novalidate @submit.prevent="submit">
      <div class="auth-heading">
        <span class="auth-icon" aria-hidden="true"><Icon name="lucide:user-round-plus" /></span>
        <div>
          <p class="eyebrow"><Icon name="lucide:sparkles" /> Mulai berbelanja</p>
          <h1>Buat akun Niaga</h1>
        </div>
      </div>
      <label class="form-field">
        <span class="field-label"><Icon name="lucide:user-round" /> Nama lengkap</span>
        <span class="input-with-icon"><Icon name="lucide:user-round" aria-hidden="true" /><input v-model.trim="name" required maxlength="150" autocomplete="name" placeholder="Nama lengkap"></span>
      </label>
      <label class="form-field">
        <span class="field-label"><Icon name="lucide:mail" /> Email</span>
        <span class="input-with-icon"><Icon name="lucide:mail" aria-hidden="true" /><input v-model.trim="email" required type="email" autocomplete="email" placeholder="nama@email.com"></span>
      </label>
      <label class="form-field">
        <span class="field-label"><Icon name="lucide:lock-keyhole" /> Password</span>
        <span class="input-with-icon input-action">
          <Icon name="lucide:lock-keyhole" aria-hidden="true" />
          <input v-model="password" required :type="showPassword ? 'text' : 'password'" minlength="12" autocomplete="new-password" placeholder="Minimal 12 karakter">
          <button class="password-toggle" type="button" :aria-label="showPassword ? 'Sembunyikan password' : 'Tampilkan password'" :title="showPassword ? 'Sembunyikan password' : 'Tampilkan password'" :aria-pressed="showPassword" @click="showPassword = !showPassword"><Icon :name="showPassword ? 'lucide:eye-off' : 'lucide:eye'" aria-hidden="true" /></button>
        </span>
      </label>
      <p class="form-help"><Icon name="lucide:info" /> Minimal 12 karakter. Gunakan frasa yang panjang dan unik.</p>
      <label class="checkbox"><input v-model="consent" type="checkbox" required><span>Saya menyetujui <NuxtLink to="/kebijakan/syarat-ketentuan">Syarat & Ketentuan</NuxtLink> dan <NuxtLink to="/kebijakan/privasi">Kebijakan Privasi</NuxtLink>.</span></label>
      <div v-if="message" class="form-feedback form-feedback--error" role="alert"><Icon name="lucide:circle-alert" aria-hidden="true" /><span><strong>{{ message }}</strong><small v-if="requestId">ID permintaan: {{ requestId }}</small></span></div>
      <button :disabled="pending || !name || !email || password.length < 12 || !consent" type="submit"><Icon v-if="pending" name="lucide:loader-circle" class="animate-spin" aria-hidden="true" /><Icon v-else name="lucide:user-plus" aria-hidden="true" />{{ pending ? 'Membuat akun…' : 'Daftar' }}</button>
      <p class="auth-return muted">Sudah punya akun? <NuxtLink to="/login"><Icon name="lucide:log-in" /> Masuk</NuxtLink></p>
    </form>
  </main>
</template>
