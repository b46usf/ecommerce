<script setup lang="ts">
import type { components } from '~/api/schema';
import { formatRupiah, lowestPrice } from '~/utils/format';

const props = defineProps<{ product: components['schemas']['Product'] }>();
const price = computed(() => lowestPrice(props.product));
const available = computed(() => props.product.skus.reduce((total, sku) => total + sku.available_quantity, 0));
</script>

<template>
  <article class="product-card">
    <NuxtLink class="product-card__image" :to="`/produk/${product.id}`" :aria-label="`Lihat ${product.name}`">
      <img v-if="product.images[0]" :src="product.images[0].url" :alt="product.images[0].alt_text" loading="lazy">
      <span v-else aria-hidden="true">NIAGA</span>
      <span v-if="available === 0" class="badge badge--neutral">Stok habis</span>
    </NuxtLink>
    <div class="product-card__body">
      <NuxtLink class="product-card__name" :to="`/produk/${product.id}`">{{ product.name }}</NuxtLink>
      <strong class="price">{{ price === null ? 'Harga belum tersedia' : formatRupiah(price) }}</strong>
      <NuxtLink class="muted product-card__store" :to="`/toko/${product.store_id}`">Lihat toko</NuxtLink>
      <p class="product-meta"><span aria-hidden="true">★</span> Baru · Stok {{ available }}</p>
    </div>
  </article>
</template>
