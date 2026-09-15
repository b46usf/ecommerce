<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap, versionHeaders } from '~/api/client'
import { displayError } from '~/utils/errors'
import { statusLabel } from '~/utils/format'

type Category = components['schemas']['Category']
type TaxClass = components['schemas']['TaxClass']

definePageMeta({ middleware: ['auth', 'admin'] })
const api = useMarketplaceApi()
const categories = ref<Category[]>([])
const taxClasses = ref<TaxClass[]>([])
const editing = ref<Category>()
const category = reactive({ name: '', slug: '', parent_id: '' as string, attribute_schema: '{}' })
const tax = reactive({ code: '', name: '' })
const pending = ref(true)
const message = ref('')

async function load() {
  pending.value = true
  const [cats, taxes] = await Promise.allSettled([
    api.GET('/categories', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    api.GET('/admin/tax-classes', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
  ])
  if (cats.status === 'fulfilled') categories.value = cats.value.items
  if (taxes.status === 'fulfilled') taxClasses.value = taxes.value.items
  pending.value = false
}

function edit(item?: Category) {
  editing.value = item
  Object.assign(category, item ? { name: item.name, slug: item.slug, parent_id: item.parent_id || '', attribute_schema: JSON.stringify(item.attribute_schema || {}, null, 2) } : { name: '', slug: '', parent_id: '', attribute_schema: '{}' })
}

async function saveCategory() {
  try {
    const body = { name: category.name, slug: category.slug, parent_id: category.parent_id || null, attribute_schema: JSON.parse(category.attribute_schema) as Record<string, unknown> }
    if (editing.value) unwrap(await api.PUT('/admin/categories/{categoryId}', { params: { path: { categoryId: editing.value.id }, header: versionHeaders(editing.value.row_version) }, body }))
    else unwrap(await api.POST('/admin/categories', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, body }))
    message.value = 'Kategori disimpan.'; edit(); await load()
  }
  catch (cause) { message.value = displayError(cause).message }
}

async function createTax() {
  try { unwrap(await api.POST('/admin/tax-classes', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, body: { ...tax } })); Object.assign(tax, { code: '', name: '' }); await load() }
  catch (cause) { message.value = displayError(cause).message }
}

async function activate(item: TaxClass) {
  const reason = prompt('Alasan aktivasi minimal 3 karakter')
  if (!reason) return
  try { unwrap(await api.POST('/admin/tax-classes/{taxClassId}/activate', { params: { path: { taxClassId: item.id }, header: { ...versionHeaders(item.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { reason } })); await load() }
  catch (cause) { message.value = displayError(cause).message }
}

onMounted(() => { void load() })
useSeoMeta({ title: 'Kategori dan kelas pajak — Niaga' })
</script>

<template><main id="main-content" class="page-shell"><PortalNav area="admin" /><div class="section-heading"><div><p class="eyebrow">Master data</p><h1>Kategori dan kelas pajak</h1></div></div><p v-if="message" class="surface" role="status">{{ message }}</p><ApiState :pending="pending"><div class="admin-split"><section class="surface"><div class="section-heading"><h2>Pohon kategori</h2><button class="button--secondary" @click="edit()">Baru</button></div><ul class="data-list"><li v-for="item in categories" :key="item.id"><button class="text-button" @click="edit(item)"><strong>{{ item.name }}</strong><small>{{ item.slug }} · induk {{ item.parent_id?.slice(0,8) || 'root' }}</small></button></li></ul></section><form class="surface form-stack" @submit.prevent="saveCategory"><h2>{{ editing ? 'Edit kategori' : 'Kategori baru' }}</h2><label class="form-field">Nama<input v-model="category.name" required></label><label class="form-field">Slug<input v-model="category.slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required></label><label class="form-field">Induk<select v-model="category.parent_id"><option value="">Root</option><option v-for="item in categories.filter(x=>x.id!==editing?.id)" :key="item.id" :value="item.id">{{ item.name }}</option></select></label><label class="form-field">JSON Schema atribut<textarea v-model="category.attribute_schema" rows="8" spellcheck="false" /></label><button>Simpan kategori</button></form></div><section class="section"><h2>Kelas pajak</h2><form class="surface filter-bar" @submit.prevent="createTax"><label class="form-field">Kode<input v-model="tax.code" required></label><label class="form-field">Nama<input v-model="tax.name" required></label><button>Tambah</button></form><div class="table-wrap surface"><table><thead><tr><th>Kode</th><th>Nama</th><th>Status</th><th>Aksi</th></tr></thead><tbody><tr v-for="item in taxClasses" :key="item.id"><td>{{ item.code }}</td><td>{{ item.name }}</td><td><span class="badge">{{ statusLabel(item.status) }}</span></td><td><button v-if="item.status==='UNVERIFIED'" class="button--secondary" @click="activate(item)">Aktifkan</button></td></tr></tbody></table></div></section></ApiState></main></template>
