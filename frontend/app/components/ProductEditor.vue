<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap, versionHeaders } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatRupiah, variantLabel } from '~/utils/format'
import { productDescriptionText } from '~/utils/product-description'

const props = defineProps<{ productId?: string }>()
type Product = components['schemas']['Product']
type ProductWrite = components['schemas']['ProductWrite']
type Sku = components['schemas']['Sku']
const api = useMarketplaceApi()
const portal = usePortal()
const product = ref<Product>()
const categories = ref<components['schemas']['Category'][]>([])
const taxes = ref<components['schemas']['TaxClass'][]>([])
const pending = ref(true)
const saving = ref(false)
const error = ref<unknown>()
const message = ref('')
const attributesText = ref('{}')
const maximumDescriptionLength = 100_000
const form = reactive<ProductWrite>({ name: '', description: '', category_id: '', tax_class_id: '', slug: '', attributes: {} })
const skuForm = reactive<components['schemas']['SkuWrite']>({ sku_code: '', unit_label: 'pcs', unit_price_gross: 0, weight_g: 1, length_cm: 1, width_cm: 1, height_cm: 1, variant_attributes: {} })
const variantText = ref('{}')
const descriptionText = computed(() => productDescriptionText(form.description))
const descriptionTooLong = computed(() => form.description.length > maximumDescriptionLength)
const checklist = computed(() => ({
  profile: Boolean(form.name && descriptionText.value && !descriptionTooLong.value && form.category_id && form.tax_class_id && form.slug),
  media: Boolean(product.value?.images.length),
  sku: Boolean(product.value?.skus.length),
  package: Boolean(product.value?.skus.every(sku => sku.weight_g && sku.length_cm && sku.width_cm && sku.height_cm)),
}))

function slugify() {
  if (!form.slug) form.slug = form.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function load() {
  pending.value = true
  error.value = undefined
  try {
    if (!portal.activeStore.value) await portal.loadStores()
    if (!portal.storeId.value) return
    const [categoryResult, taxResult] = await Promise.all([
      api.GET('/categories', { params: { query: { limit: 100 } } }).then(unwrap),
      api.GET('/vendor/stores/{storeId}/tax-classes', { params: { path: { storeId: portal.storeId.value }, query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    ])
    categories.value = categoryResult.items
    taxes.value = taxResult.items
    if (props.productId) {
      const list = unwrap(await api.GET('/vendor/stores/{storeId}/products', { params: { path: { storeId: portal.storeId.value }, query: { limit: 100 } }, cache: 'no-store' }))
      product.value = list.items.find(item => item.id === props.productId)
      if (!product.value) throw new Error('Produk tidak ditemukan pada toko aktif.')
      Object.assign(form, {
        name: product.value.name,
        description: product.value.description ?? '',
        category_id: product.value.category_id ?? '',
        tax_class_id: product.value.tax_class_id ?? '',
        slug: product.value.slug ?? '',
        attributes: product.value.attributes ?? {},
      })
      attributesText.value = JSON.stringify(form.attributes, null, 2)
    }
  } catch (cause) {
    error.value = cause
  } finally {
    pending.value = false
  }
}

async function save() {
  if (!portal.storeId.value) return
  message.value = ''
  if (!descriptionText.value) {
    message.value = 'Deskripsi produk wajib berisi teks.'
    return
  }
  if (descriptionTooLong.value) {
    message.value = `Deskripsi maksimal ${maximumDescriptionLength.toLocaleString('id-ID')} karakter HTML.`
    return
  }
  saving.value = true
  try {
    form.attributes = JSON.parse(attributesText.value || '{}')
    if (product.value) {
      product.value = unwrap(await api.PUT('/vendor/stores/{storeId}/products/{productId}', {
        params: { path: { storeId: portal.storeId.value, productId: product.value.id }, header: versionHeaders(product.value.row_version) },
        body: { ...form },
      }))
      message.value = 'Produk diperbarui.'
    } else {
      product.value = unwrap(await api.POST('/vendor/stores/{storeId}/products', {
        params: { path: { storeId: portal.storeId.value }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        body: { ...form },
      }))
      await navigateTo(`/vendor/produk/${product.value.id}`, { replace: true })
    }
  } catch (cause) {
    message.value = cause instanceof SyntaxError ? 'JSON atribut tidak valid.' : displayError(cause).message
  } finally {
    saving.value = false
  }
}

async function addSku() {
  if (!product.value) return
  saving.value = true
  message.value = ''
  try {
    skuForm.variant_attributes = JSON.parse(variantText.value || '{}')
    const sku = unwrap(await api.POST('/vendor/stores/{storeId}/products/{productId}/skus', {
      params: { path: { storeId: portal.storeId.value, productId: product.value.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { ...skuForm },
    }))
    product.value.skus.push(sku)
    Object.assign(skuForm, { sku_code: '', unit_label: 'pcs', unit_price_gross: 0, weight_g: 1, length_cm: 1, width_cm: 1, height_cm: 1, variant_attributes: {} })
    variantText.value = '{}'
    message.value = 'SKU ditambahkan.'
  } catch (cause) {
    message.value = cause instanceof SyntaxError ? 'JSON varian tidak valid.' : displayError(cause).message
  } finally {
    saving.value = false
  }
}

async function updateSku(sku: Sku) {
  try {
    const body = { sku_code: sku.sku_code, variant_attributes: sku.variant_attributes ?? {}, unit_label: sku.unit_label ?? 'pcs', unit_price_gross: sku.unit_price_gross, weight_g: sku.weight_g ?? 1, length_cm: sku.length_cm ?? 1, width_cm: sku.width_cm ?? 1, height_cm: sku.height_cm ?? 1 }
    const updated = unwrap(await api.PUT('/vendor/stores/{storeId}/skus/{skuId}', { params: { path: { storeId: portal.storeId.value, skuId: sku.id }, header: versionHeaders(sku.row_version) }, body }))
    product.value!.skus = product.value!.skus.map(item => item.id === updated.id ? updated : item)
    message.value = 'SKU diperbarui.'
  } catch (cause) {
    message.value = displayError(cause).message
  }
}

async function publish() {
  if (!product.value) return
  try {
    product.value = unwrap(await api.POST('/vendor/stores/{storeId}/products/{productId}/publish', { params: { path: { storeId: portal.storeId.value, productId: product.value.id }, header: { ...versionHeaders(product.value.row_version), 'Idempotency-Key': crypto.randomUUID() } } }))
    message.value = 'Produk dipublikasikan.'
  } catch (cause) {
    message.value = displayError(cause).message
  }
}

watch(() => portal.storeId.value, () => { void load() })
onMounted(() => { void load() })
</script>

<template>
  <ApiState :pending="pending" :error="error ? displayError(error) : null" skeleton="form" :skeleton-count="6" loading-label="Memuat editor produk" @retry="load">
    <div class="editor-layout">
      <form class="surface address-form" novalidate @submit.prevent="save">
        <div class="section-heading form-span"><h2>{{ product ? 'Edit produk' : 'Produk baru' }}</h2><span v-if="product" class="badge">{{ product.status }}</span></div>
        <label class="form-field">Nama<input v-model.trim="form.name" required maxlength="200" @blur="slugify"></label>
        <label class="form-field">Slug<input v-model.trim="form.slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></label>
        <label class="form-field">Kategori<select v-model="form.category_id" required><option value="">Pilih</option><option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label>
        <label class="form-field">Kelas pajak<select v-model="form.tax_class_id" required><option value="">Pilih</option><option v-for="tax in taxes" :key="tax.id" :value="tax.id">{{ tax.code }} · {{ tax.name }}</option></select></label>

        <div class="form-field form-span">
          <span class="field-label"><Icon name="lucide:file-text" /> Deskripsi produk</span>
          <ClientOnly>
            <RichTextEditor v-model="form.description" :disabled="saving" placeholder="Jelaskan manfaat, bahan, spesifikasi, dan cara penggunaan produk…" />
            <template #fallback><LoadingSkeleton variant="form" :count="2" label="Menyiapkan editor deskripsi" /></template>
          </ClientOnly>
          <div class="editor-help" :class="{ 'editor-help--error': descriptionTooLong }"><span>Gunakan heading, daftar, kutipan, dan tautan untuk deskripsi yang mudah dibaca.</span><span>{{ form.description.length.toLocaleString('id-ID') }}/{{ maximumDescriptionLength.toLocaleString('id-ID') }}</span></div>
        </div>

        <label class="form-field form-span">Atribut (JSON)<textarea v-model="attributesText" rows="5" spellcheck="false" /></label>
        <button :disabled="saving || !descriptionText || descriptionTooLong" type="submit"><Icon :name="saving ? 'lucide:loader-circle' : 'lucide:save'" :class="{ 'animate-spin': saving }" />{{ saving ? 'Menyimpan…' : 'Simpan produk' }}</button>
      </form>

      <aside class="surface">
        <h2>Checklist publikasi</h2>
        <ul class="check-list"><li :class="{ done: checklist.profile }">Profil lengkap</li><li :class="{ done: checklist.media }">Minimal satu gambar</li><li :class="{ done: checklist.sku }">Minimal satu SKU</li><li :class="{ done: checklist.package }">Berat dan dimensi lengkap</li></ul>
        <button v-if="product?.status === 'DRAFT'" :disabled="!Object.values(checklist).every(Boolean)" @click="publish">Publikasikan</button>
        <p v-if="message" role="status">{{ message }}</p>
      </aside>
    </div>

    <template v-if="product">
      <section class="surface section"><div class="section-heading"><h2>Gambar produk</h2><span>{{ product.images.length }}/8</span></div><div class="media-grid"><figure v-for="image in product.images" :key="image.id"><img :src="image.url" :alt="image.alt_text"><figcaption>{{ image.sort_order }} · {{ image.alt_text }}</figcaption></figure></div><ProductMediaUploader :store-id="portal.storeId.value" :product-id="product.id" :current-count="product.images.length" @uploaded="product!.images.push($event)" /></section>
      <section class="surface section">
        <h2>SKU dan kemasan</h2>
        <div class="sku-editor-grid"><form v-for="sku in product.skus" :key="sku.id" class="sku-editor" @submit.prevent="updateSku(sku)"><label>Kode<input v-model="sku.sku_code"></label><label>Harga<input v-model.number="sku.unit_price_gross" type="number" min="1"></label><label>Berat g<input v-model.number="sku.weight_g" type="number" min="1"></label><label>P × L × T cm<div class="dimension-fields"><input v-model.number="sku.length_cm" type="number" min="0.01" step="0.01"><input v-model.number="sku.width_cm" type="number" min="0.01" step="0.01"><input v-model.number="sku.height_cm" type="number" min="0.01" step="0.01"></div></label><small>{{ variantLabel(sku.variant_attributes) }} · {{ formatRupiah(sku.unit_price_gross) }}</small><button class="button--secondary">Perbarui SKU</button></form></div>
        <form class="address-form add-sku" @submit.prevent="addSku"><h3 class="form-span">Tambah SKU</h3><label class="form-field">Kode<input v-model.trim="skuForm.sku_code" required></label><label class="form-field">Unit<input v-model.trim="skuForm.unit_label" required></label><label class="form-field">Harga<input v-model.number="skuForm.unit_price_gross" type="number" min="1" required></label><label class="form-field">Berat gram<input v-model.number="skuForm.weight_g" type="number" min="1" required></label><label class="form-field">Panjang cm<input v-model.number="skuForm.length_cm" type="number" min="0.01" step="0.01" required></label><label class="form-field">Lebar cm<input v-model.number="skuForm.width_cm" type="number" min="0.01" step="0.01" required></label><label class="form-field">Tinggi cm<input v-model.number="skuForm.height_cm" type="number" min="0.01" step="0.01" required></label><label class="form-field form-span">Varian JSON<textarea v-model="variantText" rows="3" /></label><button :disabled="saving">Tambah SKU</button></form>
      </section>
    </template>
  </ApiState>
</template>
