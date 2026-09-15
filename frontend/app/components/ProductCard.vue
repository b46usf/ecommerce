<script setup lang="ts">
import type { components } from '~/api/schema';
import { formatRupiah, lowestPrice } from '~/utils/format';

const props = defineProps<{ product: components['schemas']['Product'] }>();
const price = computed(() => lowestPrice(props.product));
const available = computed(() => props.product.skus.reduce((total, sku) => total + sku.available_quantity, 0));
const unitLabel = computed(() => props.product.skus[0]?.unit_label);
</script>

<template>
  <article class="product-card group">
    <NuxtLink class="product-card__image" :to="`/produk/${product.id}`" :aria-label="`Lihat ${product.name}`">
      <img v-if="product.images[0]" :src="product.images[0].url" :alt="product.images[0].alt_text" loading="lazy" decoding="async">
      <span v-else aria-hidden="true">NIAGA</span>
      <span v-if="available > 0" class="badge product-card__badge"><Icon name="lucide:circle-check" class="size-3.5" />Tersedia</span>
      <span v-else class="badge badge--neutral"><Icon name="lucide:circle-x" class="size-3.5" />Stok habis</span>
    </NuxtLink>
    <div class="product-card__body">
      <NuxtLink class="product-card__name" :to="`/produk/${product.id}`">{{ product.name }}</NuxtLink>
      <strong class="price">
        {{ price === null ? 'Harga belum tersedia' : formatRupiah(price) }}<small v-if="price !== null && unitLabel"> / {{ unitLabel }}</small>
      </strong>
      <NuxtLink class="muted product-card__store" :to="`/toko/${product.store_id}`"><Icon name="lucide:store" class="size-4" />Lihat toko<Icon name="lucide:chevron-right" class="ml-auto size-4 transition-transform group-hover:translate-x-0.5" /></NuxtLink>
      <p class="product-meta"><Icon name="lucide:sparkles" class="size-4" /> Baru <span aria-hidden="true">·</span> Stok {{ available }}</p>
    </div>
  </article>
</template>
