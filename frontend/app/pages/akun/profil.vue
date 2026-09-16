<script setup lang="ts">
import { displayError } from '~/utils/errors'

definePageMeta({ middleware: 'auth' })

const { user, pending, updateProfile, updateAvatar, deleteAvatar, changePassword } = useAuth()
const appAlert = useAppAlert()
const profile = reactive({ name: '', email: '', phone: '' })
const password = reactive({ current: '', next: '', confirmation: '' })
const profileMessage = ref('')
const profileError = ref('')
const passwordError = ref('')
const showCurrent = ref(false)
const showNext = ref(false)
const avatarInput = ref<HTMLInputElement>()
const avatarFile = ref<File>()
const avatarPreview = ref('')
const avatarDragging = ref(false)

const initials = computed(() => (user.value?.name || 'P').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())
const passwordValid = computed(() => password.next.length >= 12
  && password.next === password.confirmation && password.next !== password.current)

watch(user, (value) => {
  if (!value) return
  profile.name = value.name
  profile.email = value.email
  profile.phone = value.phone || ''
}, { immediate: true })

function clearAvatarSelection() {
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value)
  avatarPreview.value = ''
  avatarFile.value = undefined
  if (avatarInput.value) avatarInput.value.value = ''
}

async function selectAvatar(file?: File) {
  if (!file) return
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    await appAlert.error({ title: 'Format foto tidak didukung', text: 'Gunakan file JPG, PNG, atau WebP.' })
    return
  }
  if (file.size > 3 * 1024 * 1024) {
    await appAlert.error({ title: 'Ukuran foto terlalu besar', text: 'Ukuran maksimal foto profil adalah 3 MB.' })
    return
  }
  clearAvatarSelection()
  avatarFile.value = file
  avatarPreview.value = URL.createObjectURL(file)
}

async function saveAvatar() {
  if (!avatarFile.value) return
  try {
    await updateAvatar(avatarFile.value)
    clearAvatarSelection()
    await appAlert.success({ title: 'Foto profil diperbarui', text: 'Foto baru sudah tampil di seluruh area akun.' })
  } catch (cause) {
    await appAlert.error({ title: 'Foto gagal diunggah', text: displayError(cause).message })
  }
}

async function removeAvatar() {
  if (!user.value?.avatar_url) return
  const confirmed = await appAlert.confirmAction({ title: 'Hapus foto profil?', text: 'Akun akan kembali memakai inisial nama.', confirmText: 'Ya, hapus foto', danger: true })
  if (!confirmed) return
  try {
    await deleteAvatar()
    clearAvatarSelection()
    await appAlert.success({ title: 'Foto profil dihapus' })
  } catch (cause) {
    await appAlert.error({ title: 'Foto gagal dihapus', text: displayError(cause).message })
  }
}

onUnmounted(clearAvatarSelection)

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
    await appAlert.success({ title: 'Profil berhasil disimpan', text: profileMessage.value })
  } catch (cause) {
    profileError.value = displayError(cause).message
    await appAlert.error({ title: 'Profil gagal disimpan', text: profileError.value })
  }
}

async function savePassword() {
  passwordError.value = ''
  if (!passwordValid.value) {
    passwordError.value = password.next === password.confirmation
      ? 'Password baru minimal 12 karakter dan harus berbeda dari password saat ini.'
      : 'Konfirmasi password baru tidak sama.'
    await appAlert.error({ title: 'Periksa password baru', text: passwordError.value })
    return
  }
  const confirmed = await appAlert.confirmAction({
    title: 'Perbarui password?',
    text: 'Setelah password diperbarui, seluruh perangkat akan keluar dan Anda perlu masuk kembali.',
    confirmText: 'Ya, perbarui password',
  })
  if (!confirmed) return
  try {
    await changePassword(password.current, password.next)
    await appAlert.success({ title: 'Password berhasil diperbarui', text: 'Silakan masuk kembali menggunakan password baru.' })
    await navigateTo({ path: '/login', query: { redirect: '/akun/profil', password_updated: '1' } })
  } catch (cause) {
    passwordError.value = displayError(cause).message
    await appAlert.error({ title: 'Password gagal diperbarui', text: passwordError.value })
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
        <div class="profile-avatar-editor" :class="{ 'profile-avatar-editor--dragging': avatarDragging }" @dragover.prevent="avatarDragging = true" @dragleave.prevent="avatarDragging = false" @drop.prevent="avatarDragging = false; selectAvatar($event.dataTransfer?.files?.[0])">
          <img v-if="avatarPreview || user?.avatar_url" class="profile-summary-card__avatar profile-summary-card__avatar--image" :src="avatarPreview || user?.avatar_url || ''" alt="Foto profil">
          <span v-else class="profile-summary-card__avatar" aria-hidden="true">{{ initials }}</span>
          <button class="profile-avatar-editor__camera" type="button" aria-label="Pilih foto profil" :disabled="pending" @click="avatarInput?.click()"><Icon name="lucide:camera" /></button>
          <input ref="avatarInput" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" @change="selectAvatar(($event.target as HTMLInputElement).files?.[0])">
        </div>
        <div class="profile-avatar-actions">
          <p>JPG, PNG, atau WebP · maksimal 3 MB</p>
          <button v-if="avatarFile" type="button" :disabled="pending" @click="saveAvatar"><Icon :name="pending ? 'lucide:loader-circle' : 'lucide:upload'" :class="{ 'animate-spin': pending }" />{{ pending ? 'Mengunggah…' : 'Simpan foto' }}</button>
          <button v-if="user?.avatar_url" class="text-button" type="button" :disabled="pending" @click="removeAvatar"><Icon name="lucide:trash-2" /> Hapus foto</button>
        </div>
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
