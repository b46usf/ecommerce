<script setup lang="ts">
import type { components } from '~/api/schema';
import { unwrap } from '~/api/client';

const api = useMarketplaceApi();
const route = useRoute();
const { user, pending: authPending, logout } = useAuth();
const { itemCount, load: loadCart, clear: clearCart } = useCart();
const query = ref(typeof route.query.q === 'string' ? route.query.q : '');
const suggestions = ref<components['schemas']['Product'][]>([]);
const suggestionPending = ref(false);
const mobileOpen = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

watch(query, value => {
  clearTimeout(timer);
  suggestions.value = [];
  const clean = value.trim();
  if (clean.length < 2) return;
  timer = setTimeout(async () => {
    suggestionPending.value = true;
    try {
      const result = unwrap(await api.GET('/products', { params: { query: { q: clean, limit: 5 } } }));
      if (query.value.trim() === clean) suggestions.value = result.items;
    } catch { suggestions.value = []; }
    finally { suggestionPending.value = false; }
  }, 250);
});

watch(() => route.query.q, value => {
  if (typeof value === 'string' && value !== query.value) query.value = value;
});

watch(user, value => {
  if (value) void loadCart().catch(() => undefined);
  else clearCart();
}, { immediate: true });

watch(() => route.fullPath, () => { mobileOpen.value = false; });

async function submitSearch() {
  const q = query.value.trim();
  suggestions.value = [];
  await navigateTo({ path: '/cari', query: q ? { q } : {} });
}

async function signOut() {
  await logout();
  clearCart();
  await navigateTo('/');
}
</script>

<template>
  <header class="site-header">
    <div class="header-main container">
      <button class="icon-button mobile-menu" type="button" :aria-expanded="mobileOpen" aria-controls="mobile-nav" :aria-label="mobileOpen ? 'Tutup menu' : 'Buka menu'" @click="mobileOpen = !mobileOpen">
        <Icon v-if="mobileOpen" name="lucide:x" class="size-5" />
        <Icon v-else name="lucide:menu" class="size-5" />
      </button>
      <NuxtLink class="brand group" to="/" aria-label="Niaga beranda">
        <span><Icon name="lucide:store" class="size-5 transition-transform group-hover:scale-110" /></span> Niaga
      </NuxtLink>
      <form class="header-search" role="search" @submit.prevent="submitSearch">
        <label class="sr-only" for="global-search">Cari produk</label>
        <Icon name="lucide:search" class="header-search__icon size-5" aria-hidden="true" />
        <input id="global-search" v-model="query" autocomplete="off" placeholder="Cari produk, kebutuhan sekolah, dan lainnya">
        <button type="submit" aria-label="Cari"><Icon name="lucide:search" class="size-4" /><span class="search-label">Cari</span></button>
        <div v-if="query.trim().length >= 2" class="suggestions" role="listbox" aria-label="Saran produk">
          <LoadingSkeleton v-if="suggestionPending" class="suggestions__skeleton" variant="compact" :count="3" label="Mencari produk" />
          <NuxtLink v-for="product in suggestions" v-else :key="product.id" :to="`/produk/${product.id}`" role="option" @click="suggestions = []">
            <span class="inline-flex items-center gap-2"><Icon name="lucide:package-search" class="size-4 text-brand-500" />{{ product.name }}</span>
            <small>{{ product.skus.length }} varian</small>
          </NuxtLink>
          <button v-if="!suggestionPending && !suggestions.length" class="suggestions__empty" type="submit"><Icon name="lucide:arrow-right" class="size-4" /> Lihat semua hasil untuk “{{ query }}”</button>
        </div>
      </form>
      <nav class="header-actions" aria-label="Aksi akun">
        <NuxtLink class="header-action" to="/akun/keranjang" aria-label="Keranjang">
          <Icon name="lucide:shopping-cart" class="size-5" /><span class="action-label">Keranjang</span><b v-if="itemCount" class="count-badge">{{ itemCount > 99 ? '99+' : itemCount }}</b>
        </NuxtLink>
        <NotificationMenu />
        <div v-if="user" class="account-menu">
          <NuxtLink class="header-action" to="/akun"><img v-if="user.avatar_url" class="avatar avatar--image" :src="user.avatar_url" alt=""><span v-else class="avatar">{{ user.name.slice(0, 1).toUpperCase() }}</span><span class="action-label">{{ user.name }}</span></NuxtLink>
          <button class="header-action" type="button" :disabled="authPending" @click="signOut"><Icon name="lucide:log-out" class="size-5" /><span class="action-label">Keluar</span></button>
        </div>
        <NuxtLink v-else class="button button--header" :to="{ path: '/login', query: route.path !== '/' ? { redirect: route.fullPath } : {} }"><Icon name="lucide:log-in" class="size-4" /> Masuk</NuxtLink>
      </nav>
    </div>
    <nav id="mobile-nav" class="mobile-nav container" :class="{ 'mobile-nav--open': mobileOpen }" aria-label="Navigasi mobile">
      <NuxtLink to="/"><Icon name="lucide:house" class="size-5" />Beranda</NuxtLink>
      <NuxtLink to="/cari"><Icon name="lucide:layout-grid" class="size-5" />Semua produk</NuxtLink>
      <NuxtLink to="/akun/keranjang"><Icon name="lucide:shopping-cart" class="size-5" />Keranjang ({{ itemCount }})</NuxtLink>
      <NuxtLink v-if="user" to="/akun"><Icon name="lucide:user-round" class="size-5" />Akun pembeli</NuxtLink>
      <NuxtLink v-if="user" to="/vendor"><Icon name="lucide:store" class="size-5" />Portal vendor</NuxtLink>
      <NuxtLink v-if="user?.admin_roles.length" to="/admin"><Icon name="lucide:shield-check" class="size-5" />Portal admin</NuxtLink>
      <NuxtLink v-if="!user" to="/register"><Icon name="lucide:user-plus" class="size-5" />Daftar</NuxtLink>
      <button v-else type="button" @click="signOut"><Icon name="lucide:log-out" class="size-5" />Keluar</button>
    </nav>
    <div class="header-subnav">
      <nav class="container" aria-label="Navigasi marketplace">
        <NuxtLink to="/cari"><Icon name="lucide:layout-grid" class="size-4" />Kategori & produk</NuxtLink>
        <span><Icon name="lucide:shield-check" class="size-4" />Belanja aman</span>
        <span><Icon name="lucide:store" class="size-4" />Multi-vendor</span>
        <span class="locale"><Icon name="lucide:map-pin" class="size-4" />Indonesia · IDR</span>
      </nav>
    </div>
  </header>
</template>
