<script setup lang="ts">
import { unwrap } from '~/api/client';
import { displayError } from '~/utils/errors';

const api = useMarketplaceApi();
const { data, error, status, refresh } = await useAsyncData('marketplace-home', async () => {
  const [categories, products] = await Promise.all([
    api.GET('/categories', { params: { query: { limit: 12 } } }).then(unwrap),
    api.GET('/products', { params: { query: { limit: 18, sort: 'newest' } } }).then(unwrap),
  ]);
  return { categories, products };
}, { server: false });

useSeoMeta({ title: 'Niaga — Marketplace Multi-vendor', description: 'Temukan kebutuhan sehari-hari dan usaha dari toko terverifikasi.' });
</script>

<template>
  <main id="main-content" class="page-shell">
    <section class="hero relative isolate" aria-labelledby="hero-title">
      <div class="hero-orbit" aria-hidden="true"><Icon name="lucide:shopping-bag" /></div>
      <p class="eyebrow"><Icon name="lucide:sparkles" class="size-4" />Marketplace multi-vendor Indonesia</p>
      <h1 id="hero-title" class="text-balance">Semua kebutuhan, dari banyak toko tepercaya.</h1>
      <p>Bandingkan produk, minta penawaran untuk pembelian besar, dan selesaikan transaksi dalam satu tempat.</p>
      <div class="hero-actions"><NuxtLink class="button group" to="/cari"><Icon name="lucide:compass" class="size-5" />Jelajahi produk<Icon name="lucide:arrow-right" class="size-4 transition-transform group-hover:translate-x-1" /></NuxtLink><NuxtLink class="button button--ghost" to="/register"><Icon name="lucide:user-plus" class="size-5" />Buat akun gratis</NuxtLink></div>
      <div class="hero-highlights" aria-label="Keunggulan Niaga"><span><Icon name="lucide:badge-check" />Toko terverifikasi</span><span><Icon name="lucide:shield-check" />Transaksi aman</span><span><Icon name="lucide:messages-square" />Penawaran bisnis</span></div>
    </section>

    <ApiState :pending="status === 'idle' || status === 'pending'" :error="error ? displayError(error) : null" :empty="Boolean(data && !data.categories.items.length && !data.products.items.length)" empty-title="Katalog segera hadir" empty-message="Produk aktif akan tampil setelah toko menyelesaikan proses publikasi." @retry="refresh">
      <section aria-labelledby="category-title">
        <div class="section-heading"><div><p class="eyebrow">Jelajahi</p><h2 id="category-title">Kategori pilihan</h2></div><NuxtLink class="inline-flex items-center gap-1" to="/cari">Lihat semua<Icon name="lucide:arrow-up-right" class="size-4" /></NuxtLink></div>
        <div class="chip-row"><NuxtLink v-for="category in data?.categories.items" :key="category.id" class="chip group" :to="{ path: '/cari', query: { category_id: category.id } }"><Icon name="lucide:tag" class="size-4 text-brand-500 transition-transform group-hover:rotate-6" />{{ category.name }}</NuxtLink></div>
      </section>
      <section class="section" aria-labelledby="latest-title">
        <div class="section-heading"><div><p class="eyebrow">Produk terbaru</p><h2 id="latest-title">Rekomendasi untuk Anda</h2></div><NuxtLink class="inline-flex items-center gap-1" to="/cari">Lihat katalog<Icon name="lucide:arrow-up-right" class="size-4" /></NuxtLink></div>
        <div class="product-grid"><ProductCard v-for="product in data?.products.items" :key="product.id" :product="product" /></div>
      </section>
    </ApiState>
  </main>
</template>
