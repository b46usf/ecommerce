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
      <button class="icon-button mobile-menu" type="button" :aria-expanded="mobileOpen" aria-controls="mobile-nav" aria-label="Buka menu" @click="mobileOpen = !mobileOpen">☰</button>
      <NuxtLink class="brand" to="/" aria-label="Niaga beranda"><span>N</span> Niaga</NuxtLink>
      <form class="header-search" role="search" @submit.prevent="submitSearch">
        <label class="sr-only" for="global-search">Cari produk</label>
        <input id="global-search" v-model="query" autocomplete="off" placeholder="Cari produk, kebutuhan sekolah, dan lainnya">
        <button type="submit" aria-label="Cari">Cari</button>
        <div v-if="query.trim().length >= 2" class="suggestions" role="listbox" aria-label="Saran produk">
          <p v-if="suggestionPending" role="status">Mencari…</p>
          <NuxtLink v-for="product in suggestions" v-else :key="product.id" :to="`/produk/${product.id}`" role="option" @click="suggestions = []">
            <span>{{ product.name }}</span><small>{{ product.skus.length }} varian</small>
          </NuxtLink>
          <button v-if="!suggestionPending && !suggestions.length" class="suggestions__empty" type="submit">Lihat semua hasil untuk “{{ query }}”</button>
        </div>
      </form>
      <nav class="header-actions" aria-label="Aksi akun">
        <NuxtLink class="header-action" to="/akun/keranjang" aria-label="Keranjang">
          <span aria-hidden="true">▱</span><span class="action-label">Keranjang</span><b v-if="itemCount" class="count-badge">{{ itemCount > 99 ? '99+' : itemCount }}</b>
        </NuxtLink>
        <NotificationMenu />
        <div v-if="user" class="account-menu">
          <NuxtLink class="header-action" to="/akun"><span class="avatar">{{ user.name.slice(0, 1).toUpperCase() }}</span><span class="action-label">{{ user.name }}</span></NuxtLink>
          <button class="header-action" type="button" :disabled="authPending" @click="signOut">Keluar</button>
        </div>
        <NuxtLink v-else class="button button--header" :to="{ path: '/login', query: route.path !== '/' ? { redirect: route.fullPath } : {} }">Masuk</NuxtLink>
      </nav>
    </div>
    <nav id="mobile-nav" class="mobile-nav container" :class="{ 'mobile-nav--open': mobileOpen }" aria-label="Navigasi mobile">
      <NuxtLink to="/">Beranda</NuxtLink><NuxtLink to="/cari">Semua produk</NuxtLink><NuxtLink to="/akun/keranjang">Keranjang ({{ itemCount }})</NuxtLink>
      <NuxtLink v-if="user" to="/akun">Akun pembeli</NuxtLink><NuxtLink v-if="user" to="/vendor">Portal vendor</NuxtLink><NuxtLink v-if="user?.admin_roles.length" to="/admin">Portal admin</NuxtLink>
      <NuxtLink v-if="!user" to="/register">Daftar</NuxtLink><button v-else type="button" @click="signOut">Keluar</button>
    </nav>
    <div class="header-subnav"><nav class="container" aria-label="Navigasi marketplace"><NuxtLink to="/cari">Kategori & produk</NuxtLink><span>Belanja aman</span><span>Multi-vendor</span><span class="locale">Indonesia · IDR</span></nav></div>
  </header>
</template>
