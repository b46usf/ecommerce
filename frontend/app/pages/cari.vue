<script setup lang="ts">
import { unwrap } from '~/api/client'; import { displayError } from '~/utils/errors';
import type { components } from '~/api/schema';

type Sort = 'relevance' | 'price_asc' | 'price_desc' | 'newest';
const api = useMarketplaceApi(); const route = useRoute(); const router = useRouter();
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '');
const categoryId = ref(typeof route.query.category_id === 'string' ? route.query.category_id : '');
const minPrice = ref(typeof route.query.min_price === 'string' ? route.query.min_price : '');
const maxPrice = ref(typeof route.query.max_price === 'string' ? route.query.max_price : '');
const sort = ref<Sort>(['relevance','price_asc','price_desc','newest'].includes(String(route.query.sort)) ? route.query.sort as Sort : 'relevance');
const products = ref<components['schemas']['Product'][]>([]); const nextCursor = ref<string | null>(null); const loadingMore = ref(false);

const { data: categories } = await useAsyncData('search-categories', () => api.GET('/categories', { params: { query: { limit: 100 } } }).then(unwrap), { server: false });
const { data, error, status, refresh } = await useAsyncData('product-search', () => api.GET('/products', { params: { query: {
  q: typeof route.query.q === 'string' && route.query.q ? route.query.q : undefined,
  category_id: typeof route.query.category_id === 'string' && route.query.category_id ? route.query.category_id : undefined,
  min_price: typeof route.query.min_price === 'string' && route.query.min_price ? Number(route.query.min_price) : undefined,
  max_price: typeof route.query.max_price === 'string' && route.query.max_price ? Number(route.query.max_price) : undefined,
  sort: ['relevance','price_asc','price_desc','newest'].includes(String(route.query.sort)) ? route.query.sort as Sort : 'relevance', limit: 20,
} } }).then(unwrap), { server: false, watch: [() => route.fullPath] });

watch(data, value => { products.value = value?.items ?? []; nextCursor.value = value?.next_cursor ?? null; }, { immediate: true });
watch(() => route.query, query => { keyword.value = typeof query.q === 'string' ? query.q : ''; categoryId.value = typeof query.category_id === 'string' ? query.category_id : ''; minPrice.value = typeof query.min_price === 'string' ? query.min_price : ''; maxPrice.value = typeof query.max_price === 'string' ? query.max_price : ''; }, { deep: true });

const active = computed(() => [keyword.value && `Kata kunci: ${keyword.value}`, categoryId.value && `Kategori: ${categories.value?.items.find(x => x.id === categoryId.value)?.name ?? categoryId.value}`, minPrice.value && `Min Rp ${minPrice.value}`, maxPrice.value && `Maks Rp ${maxPrice.value}`].filter(Boolean) as string[]);
function apply() { const query: Record<string,string> = {}; if (keyword.value.trim()) query.q = keyword.value.trim(); if (categoryId.value) query.category_id = categoryId.value; if (minPrice.value) query.min_price = String(Math.max(0, Math.floor(Number(minPrice.value)))); if (maxPrice.value) query.max_price = String(Math.max(0, Math.floor(Number(maxPrice.value)))); if (sort.value !== 'relevance') query.sort = sort.value; void router.push({ path: '/cari', query }); }
function clearFilters() { keyword.value = ''; categoryId.value = ''; minPrice.value = ''; maxPrice.value = ''; sort.value = 'relevance'; void router.push('/cari'); }
async function loadMore() { if (!nextCursor.value) return; loadingMore.value = true; try { const result = unwrap(await api.GET('/products', { params: { query: { cursor: nextCursor.value, limit: 20, q: typeof route.query.q === 'string' ? route.query.q : undefined, category_id: typeof route.query.category_id === 'string' ? route.query.category_id : undefined, min_price: typeof route.query.min_price === 'string' ? Number(route.query.min_price) : undefined, max_price: typeof route.query.max_price === 'string' ? Number(route.query.max_price) : undefined, sort: ['relevance','price_asc','price_desc','newest'].includes(String(route.query.sort)) ? route.query.sort as Sort : 'relevance' } } })); products.value.push(...result.items); nextCursor.value = result.next_cursor; } finally { loadingMore.value = false; } }
useSeoMeta({ title: computed(() => keyword.value ? `Hasil untuk ${keyword.value} — Niaga` : 'Katalog produk — Niaga') });
</script>

<template><main id="main-content" class="page-shell"><div class="section-heading"><div><p class="eyebrow">Katalog</p><h1>{{ route.query.q ? `Hasil untuk “${route.query.q}”` : 'Temukan produk' }}</h1></div></div><div class="search-layout"><form class="filters" @submit.prevent="apply"><h2>Filter</h2><label class="filter-field">Kata kunci<input v-model="keyword" placeholder="Nama produk"></label><label class="filter-field">Kategori<select v-model="categoryId"><option value="">Semua kategori</option><option v-for="category in categories?.items" :key="category.id" :value="category.id">{{ category.name }}</option></select></label><label class="filter-field">Harga minimum<input v-model="minPrice" inputmode="numeric" min="0" step="1" type="number" placeholder="0"></label><label class="filter-field">Harga maksimum<input v-model="maxPrice" inputmode="numeric" min="0" step="1" type="number" placeholder="Tanpa batas"></label><button type="submit">Terapkan filter</button><button v-if="active.length" class="button--secondary" type="button" @click="clearFilters">Hapus semua</button></form><section aria-label="Hasil pencarian"><div class="toolbar"><p class="muted">{{ products.length }} produk ditampilkan</p><label>Urutkan <select v-model="sort" @change="apply"><option value="relevance">Paling relevan</option><option value="price_asc">Harga terendah</option><option value="price_desc">Harga tertinggi</option><option value="newest">Terbaru</option></select></label></div><div v-if="active.length" class="active-filters"><button v-for="item in active" :key="item" type="button" @click="clearFilters">{{ item }} ×</button></div><ApiState :pending="status === 'idle' || status === 'pending'" :error="error ? displayError(error) : null" :empty="status === 'success' && !products.length" empty-title="Produk tidak ditemukan" empty-message="Coba kata kunci atau rentang harga yang lebih luas." @retry="refresh"><div class="product-grid"><ProductCard v-for="product in products" :key="product.id" :product="product" /></div><div v-if="nextCursor" class="section-heading section"><button :disabled="loadingMore" type="button" @click="loadMore">{{ loadingMore ? 'Memuat…' : 'Muat produk berikutnya' }}</button></div></ApiState></section></div></main></template>
