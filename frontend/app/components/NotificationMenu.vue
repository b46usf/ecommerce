<script setup lang="ts">
import type { components } from '~/api/schema';
import { unwrap, versionHeaders } from '~/api/client';
import { formatDate } from '~/utils/format';

const api = useMarketplaceApi();
const { user } = useAuth();
const open = ref(false);
const pending = ref(false);
const items = useState<components['schemas']['Notification'][]>('notifications', () => []);
const unread = computed(() => items.value.filter(item => !item.read_at).length);

async function load() {
  if (!user.value) return;
  pending.value = true;
  try {
    items.value = unwrap(await api.GET('/me/notifications', { params: { query: { limit: 30 } }, cache: 'no-store' })).items;
  } finally { pending.value = false; }
}

async function markRead(item: components['schemas']['Notification']) {
  if (!item.read_at) {
    const value = unwrap(await api.POST('/me/notifications/{notificationId}/read', {
      params: { path: { notificationId: item.id }, header: { ...versionHeaders(item.row_version), 'Idempotency-Key': crypto.randomUUID() } },
    }));
    items.value = items.value.map(row => row.id === item.id ? value : row);
  }
  if (item.resource_id) await navigateTo(`/operasi/${item.resource_id}`);
  open.value = false;
}

watch(user, value => { if (value) void load(); else items.value = []; }, { immediate: true });
</script>

<template>
  <div v-if="user" class="notification-menu">
    <button class="header-action" type="button" :aria-expanded="open" aria-label="Notifikasi" @click="open = !open; if (open) load()">
      <Icon name="lucide:bell" class="size-5" /><span class="action-label">Notifikasi</span><b v-if="unread" class="count-badge">{{ unread > 99 ? '99+' : unread }}</b>
    </button>
    <section v-if="open" class="notification-drawer" aria-label="Daftar notifikasi">
      <header><h2><Icon name="lucide:bell-ring" class="size-5 text-brand-500" />Notifikasi</h2><button class="text-button" type="button" aria-label="Tutup notifikasi" @click="open = false"><Icon name="lucide:x" class="size-5" /></button></header>
      <LoadingSkeleton v-if="pending" variant="compact" :count="5" label="Memuat notifikasi" />
      <p v-else-if="!items.length" class="notification-empty"><Icon name="lucide:inbox" class="size-8" />Belum ada notifikasi.</p>
      <ul v-else class="notification-list">
        <li v-for="item in items" :key="item.id" :class="{ unread: !item.read_at }">
          <button type="button" @click="markRead(item)"><strong>{{ item.kind }}</strong><span>{{ item.message }}</span><small>{{ formatDate(item.created_at) }}</small></button>
        </li>
      </ul>
    </section>
  </div>
</template>
