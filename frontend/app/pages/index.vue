<script setup lang="ts">
import { unwrap } from '~/api/client';
import { displayError } from '~/utils/errors';

const api = useMarketplaceApi();
const { data, error, status, refresh } = await useAsyncData('marketplace-home', async () => {
  const [categories, products] = await Promise.all([
    api.GET('/categories', { params: { query: { limit: 12 } } }).then(unwrap),
    api.GET('/products', { params: { query: { limit: 12, sort: 'newest' } } }).then(unwrap),
  ]);
  return { categories, products };
}, { server: false });

useSeoMeta({ title: 'Niaga — Marketplace Multi-vendor', description: 'Temukan kebutuhan sehari-hari dan usaha dari toko terverifikasi.' });
</script>

<template>
  <main id="main-content" class="page-shell">
    <section class="hero" aria-labelledby="hero-title">
      <p class="eyebrow">Marketplace multi-vendor Indonesia</p>
      <h1 id="hero-title">Semua kebutuhan, dari banyak toko tepercaya.</h1>
      <p>Bandingkan produk, minta penawaran untuk pembelian besar, dan selesaikan transaksi dalam satu tempat.</p>
      <div class="hero-actions"><NuxtLink class="button" to="/cari">Jelajahi produk</NuxtLink><NuxtLink class="button button--ghost" to="/register">Buat akun gratis</NuxtLink></div>
    </section>

    <ApiState :pending="status === 'idle' || status === 'pending'" :error="error ? displayError(error) : null" :empty="Boolean(data && !data.categories.items.length && !data.products.items.length)" empty-title="Katalog segera hadir" empty-message="Produk aktif akan tampil setelah toko menyelesaikan proses publikasi." @retry="refresh">
      <section aria-labelledby="category-title">
        <div class="section-heading"><div><p class="eyebrow">Jelajahi</p><h2 id="category-title">Kategori pilihan</h2></div><NuxtLink to="/cari">Lihat semua</NuxtLink></div>
        <div class="chip-row"><NuxtLink v-for="category in data?.categories.items" :key="category.id" class="chip" :to="{ path: '/cari', query: { category_id: category.id } }">{{ category.name }}</NuxtLink></div>
      </section>
      <section class="section" aria-labelledby="latest-title">
        <div class="section-heading"><div><p class="eyebrow">Produk terbaru</p><h2 id="latest-title">Rekomendasi untuk Anda</h2></div><NuxtLink to="/cari">Lihat katalog</NuxtLink></div>
        <div class="product-grid"><ProductCard v-for="product in data?.products.items" :key="product.id" :product="product" /></div>
      </section>
    </ApiState>
  </main>
</template>
