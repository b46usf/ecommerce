<script setup lang="ts">
import { offlineStatusEvent, type OfflineStatus } from '~/api/offline';

const api = useMarketplaceApi();
const { load } = useAuth();
const backendAvailable = ref(true);
const offlineSource = ref<'network' | 'cache' | 'seed'>('network');
const pendingMutations = ref(0);
const syncing = ref(false);
let syncTimer: ReturnType<typeof setInterval> | undefined;

function applyOfflineStatus(status?: OfflineStatus) {
  if (!status) return;
  backendAvailable.value = status.backendAvailable;
  offlineSource.value = status.source;
  pendingMutations.value = status.pendingMutations;
}
function handleOfflineStatus(event: Event) { applyOfflineStatus((event as CustomEvent<OfflineStatus>).detail); }
async function syncNow() {
  if (syncing.value) return;
  syncing.value = true;
  try {
    await api.GET('/categories', { params: { query: { limit: 1 } }, cache: 'no-store' });
    applyOfflineStatus(await api.syncOffline());
  } catch { applyOfflineStatus(api.offlineStatus()); }
  finally { syncing.value = false; }
}
function probeBackend() { void syncNow(); }
onMounted(() => {
  applyOfflineStatus(api.offlineStatus());
  void load().catch(() => undefined);
  window.addEventListener(offlineStatusEvent, handleOfflineStatus);
  window.addEventListener('online', probeBackend);
  window.addEventListener('offline', probeBackend);
  syncTimer = setInterval(() => {
    if (pendingMutations.value || !backendAvailable.value) void syncNow();
  }, 30_000);
});
onUnmounted(() => {
  clearInterval(syncTimer);
  window.removeEventListener(offlineStatusEvent, handleOfflineStatus);
  window.removeEventListener('online', probeBackend);
  window.removeEventListener('offline', probeBackend);
});
</script>

<template>
  <div class="app-root">
    <a class="skip-link" href="#main-content">Lewati ke konten utama</a>
    <div v-if="!backendAvailable" class="offline-banner" role="status">
      <Icon name="lucide:cloud-off" class="size-4" />
      <span>
        Backend tidak tersedia. Menampilkan data {{ offlineSource === 'cache' ? 'terakhir yang tersimpan' : 'demo offline' }} dari perangkat ini.
        <strong v-if="pendingMutations"> {{ pendingMutations }} perubahan menunggu sinkronisasi.</strong>
      </span>
      <button type="button" :disabled="syncing" @click="syncNow"><Icon :name="syncing ? 'lucide:loader-circle' : 'lucide:refresh-cw'" :class="{ 'animate-spin': syncing }" />{{ syncing ? 'Menyinkronkan' : 'Coba sambungkan' }}</button>
    </div>
    <AppHeader />
    <NuxtPage />
    <footer class="site-footer">
      <div class="container footer-grid">
        <div class="footer-brand"><strong><span><Icon name="lucide:store" class="size-5" /></span>Niaga</strong><p>Marketplace multi-vendor untuk kebutuhan sehari-hari dan usaha.</p></div>
        <nav aria-label="Kebijakan">
          <NuxtLink to="/kebijakan/syarat-ketentuan"><Icon name="lucide:file-text" class="size-4" />Syarat & Ketentuan</NuxtLink>
          <NuxtLink to="/kebijakan/privasi"><Icon name="lucide:lock-keyhole" class="size-4" />Privasi</NuxtLink>
          <NuxtLink to="/status"><Icon name="lucide:activity" class="size-4" />Status layanan</NuxtLink>
        </nav>
        <p>© 2026 Niaga · Indonesia (IDR)</p>
      </div>
    </footer>
  </div>
</template>
