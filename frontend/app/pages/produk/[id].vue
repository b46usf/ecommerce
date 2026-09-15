<script setup lang="ts">
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatRupiah, variantLabel } from '~/utils/format'

const api = useMarketplaceApi()
const route = useRoute()
const { user } = useAuth()
const cart = useCart()
const selectedImage = ref(0)
const selectedSkuId = ref('')
const quantity = ref(1)
const actionError = ref('')
const added = ref(false)
const zoomed = ref(false)
const { data, error, status, refresh } = await useAsyncData(`product-${route.params.id}`, async () => {
  const product = unwrap(await api.GET('/products/{productId}', { params: { path: { productId: String(route.params.id) } } }))
  const store = unwrap(await api.GET('/stores/{storeId}', { params: { path: { storeId: product.store_id } } }))
  return { product, store }
}, { server: false })
watch(data, value => { selectedSkuId.value = value?.product.skus.find(sku => sku.available_quantity > 0)?.id ?? value?.product.skus[0]?.id ?? '' }, { immediate: true })
const selectedSku = computed(() => data.value?.product.skus.find(sku => sku.id === selectedSkuId.value))
const currentImage = computed(() => data.value?.product.images[selectedImage.value])
async function addToCart() {
  if (!user.value) { await navigateTo({ path: '/login', query: { redirect: route.fullPath } }); return }
  if (!selectedSku.value) return
  actionError.value = ''; added.value = false
  try { await cart.add(selectedSku.value.id, quantity.value); added.value = true }
  catch (cause) { actionError.value = displayError(cause).message }
}
function handleKey(event: KeyboardEvent) { if (event.key === 'Escape') zoomed.value = false }
onMounted(() => window.addEventListener('keydown', handleKey))
onUnmounted(() => window.removeEventListener('keydown', handleKey))
useSeoMeta({ title: computed(() => data.value ? `${data.value.product.name} — Niaga` : 'Detail produk — Niaga') })
</script>

<template><main id="main-content" class="page-shell"><ApiState :pending="status === 'idle' || status === 'pending'" :error="error ? displayError(error) : null" @retry="refresh"><template v-if="data"><nav class="muted" aria-label="Breadcrumb"><NuxtLink to="/">Beranda</NuxtLink> / <NuxtLink to="/cari">Produk</NuxtLink> / {{ data.product.name }}</nav><section class="product-detail section"><div><button class="gallery-main gallery-zoom" type="button" :disabled="!currentImage" aria-label="Perbesar gambar produk" @click="zoomed=true"><img v-if="currentImage" :src="currentImage.url" :alt="currentImage.alt_text"><span v-else>NIAGA</span><span v-if="currentImage" class="zoom-hint">Perbesar</span></button><div v-if="data.product.images.length > 1" class="thumbnails"><button v-for="(image,index) in data.product.images" :key="image.id" type="button" :aria-current="selectedImage === index" @click="selectedImage = index"><img :src="image.url" :alt="image.alt_text"></button></div></div><div class="detail-panel"><span class="badge">Produk aktif</span><h1>{{ data.product.name }}</h1><p class="product-meta"><span>★</span> Produk baru · {{ selectedSku?.available_quantity ?? 0 }} tersedia</p><strong class="detail-price">{{ selectedSku ? formatRupiah(selectedSku.unit_price_gross) : 'Harga belum tersedia' }}</strong><NuxtLink :to="`/toko/${data.store.id}`"><strong>{{ data.store.name }}</strong> · Lihat profil toko</NuxtLink><div><strong>Pilih varian</strong><div class="variant-list"><button v-for="sku in data.product.skus" :key="sku.id" class="variant-button" :class="{ 'variant-button--active': selectedSkuId === sku.id }" :disabled="sku.status !== 'ACTIVE' || sku.available_quantity < 1" type="button" @click="selectedSkuId = sku.id">{{ variantLabel(sku.variant_attributes) || sku.sku_code }} · {{ sku.available_quantity }}</button></div></div><div class="purchase-row"><label class="form-field">Jumlah<input v-model.number="quantity" class="quantity-input" type="number" min="1" :max="selectedSku?.available_quantity ?? 1"></label><button :disabled="cart.pending.value || !selectedSku || selectedSku.available_quantity < quantity || quantity < 1" type="button" @click="addToCart">{{ cart.pending.value ? 'Menambahkan…' : 'Tambah ke keranjang' }}</button></div><p v-if="added" class="success" role="status">Produk ditambahkan. <NuxtLink to="/akun/keranjang">Lihat keranjang</NuxtLink></p><p v-if="actionError" class="error" role="alert">{{ actionError }}</p><NuxtLink v-if="selectedSku" class="button button--secondary" :to="{ path: '/akun/rfq/baru', query: { store_id: data.store.id, sku_id: selectedSku.id } }">Minta penawaran</NuxtLink></div></section><section class="detail-sections"><article class="surface"><h2>Deskripsi produk</h2><p class="muted" style="white-space: pre-wrap">{{ data.product.description || 'Penjual belum menambahkan deskripsi.' }}</p></article><aside class="surface"><h2>Spesifikasi pengiriman</h2><template v-if="selectedSku"><p>Unit: {{ selectedSku.unit_label || 'unit' }}</p><p>Berat: {{ selectedSku.weight_g }} gram</p><p>Ukuran: {{ selectedSku.length_cm }} × {{ selectedSku.width_cm }} × {{ selectedSku.height_cm }} cm</p><p>Harga sudah termasuk pajak yang berlaku.</p></template></aside></section><Teleport to="body"><div v-if="zoomed && currentImage" class="image-lightbox" role="dialog" aria-modal="true" aria-label="Pratinjau gambar produk" @click.self="zoomed=false"><button class="lightbox-close" aria-label="Tutup pratinjau" @click="zoomed=false">×</button><img :src="currentImage.url" :alt="currentImage.alt_text"></div></Teleport></template></ApiState></main></template>
