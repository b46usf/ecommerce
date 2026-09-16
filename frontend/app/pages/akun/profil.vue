<script setup lang="ts">
import { displayError } from '~/utils/errors'

definePageMeta({ middleware: 'auth' })

const { user, pending, updateProfile, changePassword } = useAuth()
const profile = reactive({ name: '', email: '', phone: '' })
const password = reactive({ current: '', next: '', confirmation: '' })
const profileMessage = ref('')
const profileError = ref('')
const passwordError = ref('')
const showCurrent = ref(false)
const showNext = ref(false)

const initials = computed(() => (user.value?.name || 'P').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())
const passwordValid = computed(() => password.next.length >= 12
  && password.next === password.confirmation && password.next !== password.current)

watch(user, (value) => {
  if (!value) return
  profile.name = value.name
  profile.email = value.email
  profile.phone = value.phone || ''
}, { immediate: true })

async function saveProfile() {
  profileMessage.value = ''
  profileError.value = ''
  const previousEmail = user.value?.email
  try {
    const updated = await updateProfile({
      name: profile.name.trim(),
      email: profile.email.trim().toLowerCase(),
      phone: profile.phone.trim() || null,
    })
    profileMessage.value = previousEmail !== updated.email
      ? 'Profil diperbarui. Tautan verifikasi telah dikirim ke email baru.'
      : 'Profil berhasil diperbarui.'
  } catch (cause) {
    profileError.value = displayError(cause).message
  }
}

async function savePassword() {
  passwordError.value = ''
  if (!passwordValid.value) {
    passwordError.value = password.next === password.confirmation
      ? 'Password baru minimal 12 karakter dan harus berbeda dari password saat ini.'
      : 'Konfirmasi password baru tidak sama.'
    return
  }
  try {
    await changePassword(password.current, password.next)
    await navigateTo({ path: '/login', query: { redirect: '/akun/profil', password_updated: '1' } })
  } catch (cause) {
    passwordError.value = displayError(cause).message
  }
}

useSeoMeta({ title: 'Profil akun — Niaga' })
</script>

<template>
  <main id="main-content" class="page-shell profile-settings">
    <BuyerNav />
    <header class="profile-settings__heading">
      <div><p class="eyebrow">Pengaturan akun</p><h1>Profil dan keamanan</h1><p class="muted">Perbarui identitas akun dan jaga keamanan akses Anda.</p></div>
      <span class="profile-settings__secure"><Icon name="lucide:shield-check" /> Data terlindungi</span>
    </header>

    <div class="profile-settings__layout">
      <aside class="surface profile-summary-card">
        <span class="profile-summary-card__avatar" aria-hidden="true">{{ initials }}</span>
        <div><h2>{{ user?.name }}</h2><p>{{ user?.email }}</p></div>
        <span class="badge" :class="{ 'badge--warning': !user?.email_verified }"><Icon :name="user?.email_verified ? 'lucide:badge-check' : 'lucide:circle-alert'" />{{ user?.email_verified ? 'Email terverifikasi' : 'Email belum diverifikasi' }}</span>
        <dl>
          <div><dt><Icon name="lucide:phone" /> Telepon</dt><dd>{{ user?.phone || 'Belum ditambahkan' }}</dd></div>
          <div><dt><Icon name="lucide:fingerprint" /> ID akun</dt><dd>{{ user?.id.slice(0, 8) }}…</dd></div>
        </dl>
        <p class="profile-summary-card__note"><Icon name="lucide:info" /> Perubahan email akan menonaktifkan status verifikasi sampai email baru dikonfirmasi.</p>
      </aside>

      <div class="profile-settings__forms">
        <form class="surface profile-settings-card" novalidate @submit.prevent="saveProfile">
          <header><span class="profile-settings-card__icon"><Icon name="lucide:user-round-pen" /></span><div><h2>Informasi pribadi</h2><p>Informasi ini digunakan pada aktivitas akun Anda.</p></div></header>
          <div class="profile-settings-card__fields">
            <label class="form-field form-span"><span class="field-label"><Icon name="lucide:user-round" /> Nama lengkap</span><input v-model="profile.name" required maxlength="150" autocomplete="name" placeholder="Nama lengkap"></label>
            <label class="form-field"><span class="field-label"><Icon name="lucide:mail" /> Email</span><input v-model="profile.email" required type="email" maxlength="254" autocomplete="email" placeholder="nama@email.com"></label>
            <label class="form-field"><span class="field-label"><Icon name="lucide:phone" /> Nomor telepon</span><input v-model="profile.phone" type="tel" maxlength="32" autocomplete="tel" placeholder="+62 812 3456 7890"><small class="form-help">Gunakan 7–15 digit, boleh memakai spasi, kurung, atau tanda hubung.</small></label>
          </div>
          <p v-if="profileMessage" class="form-feedback form-feedback--success" role="status"><Icon name="lucide:circle-check-big" /><span>{{ profileMessage }}</span></p>
          <p v-if="profileError" class="form-feedback form-feedback--error" role="alert"><Icon name="lucide:circle-alert" /><span>{{ profileError }}</span></p>
          <div class="profile-settings-card__actions"><button :disabled="pending || !profile.name.trim() || !profile.email.trim()" type="submit"><Icon :name="pending ? 'lucide:loader-circle' : 'lucide:save'" :class="{ 'animate-spin': pending }" />{{ pending ? 'Menyimpan…' : 'Simpan profil' }}</button></div>
        </form>

        <form class="surface profile-settings-card" novalidate @submit.prevent="savePassword">
          <header><span class="profile-settings-card__icon profile-settings-card__icon--security"><Icon name="lucide:key-round" /></span><div><h2>Ubah password</h2><p>Seluruh perangkat akan keluar setelah password diperbarui.</p></div></header>
          <div class="profile-settings-card__fields">
            <label class="form-field form-span"><span class="field-label"><Icon name="lucide:lock-keyhole" /> Password saat ini</span><span class="input-action"><input v-model="password.current" required :type="showCurrent ? 'text' : 'password'" maxlength="128" autocomplete="current-password"><button class="password-toggle" type="button" :aria-label="showCurrent ? 'Sembunyikan password' : 'Tampilkan password'" @click="showCurrent = !showCurrent"><Icon :name="showCurrent ? 'lucide:eye-off' : 'lucide:eye'" /></button></span></label>
            <label class="form-field"><span class="field-label"><Icon name="lucide:shield-plus" /> Password baru</span><span class="input-action"><input v-model="password.next" required :type="showNext ? 'text' : 'password'" minlength="12" maxlength="128" autocomplete="new-password"><button class="password-toggle" type="button" :aria-label="showNext ? 'Sembunyikan password' : 'Tampilkan password'" @click="showNext = !showNext"><Icon :name="showNext ? 'lucide:eye-off' : 'lucide:eye'" /></button></span><small class="form-help">Minimal 12 karakter dan berbeda dari password lama.</small></label>
            <label class="form-field"><span class="field-label"><Icon name="lucide:check-check" /> Ulangi password baru</span><input v-model="password.confirmation" required :type="showNext ? 'text' : 'password'" minlength="12" maxlength="128" autocomplete="new-password"></label>
          </div>
          <p v-if="passwordError" class="form-feedback form-feedback--error" role="alert"><Icon name="lucide:circle-alert" /><span>{{ passwordError }}</span></p>
          <div class="profile-settings-card__actions"><button :disabled="pending || !password.current || !passwordValid" type="submit"><Icon :name="pending ? 'lucide:loader-circle' : 'lucide:shield-check'" :class="{ 'animate-spin': pending }" />{{ pending ? 'Memperbarui…' : 'Perbarui password' }}</button></div>
        </form>
      </div>
    </div>
  </main>
</template>
