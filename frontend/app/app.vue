<script setup lang="ts">
const { load } = useAuth()
const online = ref(true)
function markOnline() { online.value = true }
function markOffline() { online.value = false }
onMounted(() => {
  online.value = navigator.onLine
  void load().catch(() => undefined)
  window.addEventListener('online', markOnline)
  window.addEventListener('offline', markOffline)
})
onUnmounted(() => {
  window.removeEventListener('online', markOnline)
  window.removeEventListener('offline', markOffline)
})
</script>

<template>
  <div class="app-root">
    <a class="skip-link" href="#main-content">Lewati ke konten utama</a>
    <p v-if="!online" class="offline-banner" role="status">Anda sedang offline. Perubahan akan tersedia kembali setelah koneksi pulih.</p>
    <AppHeader />
    <NuxtPage />
    <footer class="site-footer">
      <div class="container footer-grid">
        <div><strong>Niaga</strong><p>Marketplace multi-vendor untuk kebutuhan sehari-hari dan usaha.</p></div>
        <nav aria-label="Kebijakan"><NuxtLink to="/kebijakan/syarat-ketentuan">Syarat & Ketentuan</NuxtLink><NuxtLink to="/kebijakan/privasi">Privasi</NuxtLink><NuxtLink to="/status">Status layanan</NuxtLink></nav>
        <p>© 2026 Niaga · Indonesia (IDR)</p>
      </div>
    </footer>
  </div>
</template>
