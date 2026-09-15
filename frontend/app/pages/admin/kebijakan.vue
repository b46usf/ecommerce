<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap, versionHeaders } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, formatRupiah, statusLabel } from '~/utils/format'

type Fee = components['schemas']['FeePolicy']
type Tax = components['schemas']['TaxPolicy']

definePageMeta({ middleware: ['auth', 'admin'] })
const api = useMarketplaceApi()
const fees = ref<Fee[]>([])
const taxes = ref<Tax[]>([])
const fee = reactive({ policy_key: '', category_id: '', commission_rate: 0.05, buyer_fee_amount: 0, valid_from: new Date().toISOString().slice(0, 16), valid_until: '' })
const tax = reactive({ policy_key: '', tax_class_id: '', kind: 'ITEM_VAT' as 'ITEM_VAT'|'COMMISSION_VAT'|'SELLER_WITHHOLDING', rate: 0.11, dpp_numerator: 11, dpp_denominator: 12, valid_from: new Date().toISOString().slice(0, 16), valid_until: '', rule_parameters: '{}' })
const simulation = ref(1_000_000)
const pending = ref(true)
const message = ref('')
const commissionPreview = computed(() => Math.round(simulation.value * fee.commission_rate))

async function load() {
  pending.value = true
  const result = await Promise.allSettled([
    api.GET('/admin/fee-policies', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
    api.GET('/admin/tax-policies', { params: { query: { limit: 100 } }, cache: 'no-store' }).then(unwrap),
  ])
  if (result[0].status === 'fulfilled') fees.value = result[0].value.items
  if (result[1].status === 'fulfilled') taxes.value = result[1].value.items
  pending.value = false
}
async function createFee() {
  try { unwrap(await api.POST('/admin/fee-policies', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, body: { ...fee, category_id: fee.category_id || null, valid_from: new Date(fee.valid_from).toISOString(), valid_until: fee.valid_until ? new Date(fee.valid_until).toISOString() : null } })); message.value='Kebijakan komisi dibuat sebagai draft.'; await load() }
  catch (cause) { message.value = displayError(cause).message }
}
async function createTax() {
  try { unwrap(await api.POST('/admin/tax-policies', { params: { header: { 'Idempotency-Key': crypto.randomUUID() } }, body: { ...tax, tax_class_id: tax.tax_class_id || null, valid_from: new Date(tax.valid_from).toISOString(), valid_until: tax.valid_until ? new Date(tax.valid_until).toISOString() : null, rule_parameters: JSON.parse(tax.rule_parameters) as Record<string, unknown> } })); message.value='Kebijakan pajak dibuat sebagai draft.'; await load() }
  catch (cause) { message.value = displayError(cause).message }
}
async function activate(kind: 'fee'|'tax', item: Fee|Tax) {
  const reason = prompt('Alasan aktivasi minimal 3 karakter. Periode yang tumpang tindih akan ditolak server.')
  if (!reason) return
  try {
    if (kind === 'fee') unwrap(await api.POST('/admin/fee-policies/{feePolicyId}/activate', { params: { path: { feePolicyId: item.id }, header: { ...versionHeaders(item.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { reason } }))
    else unwrap(await api.POST('/admin/tax-policies/{taxPolicyId}/activate', { params: { path: { taxPolicyId: item.id }, header: { ...versionHeaders(item.row_version), 'Idempotency-Key': crypto.randomUUID() } }, body: { reason } }))
    await load()
  }
  catch (cause) { message.value = displayError(cause).message }
}
onMounted(() => { void load() })
useSeoMeta({ title: 'Kebijakan biaya dan pajak — Niaga' })
</script>

<template><main id="main-content" class="page-shell"><PortalNav area="admin" /><div class="section-heading"><div><p class="eyebrow">Finance configuration</p><h1>Kebijakan biaya dan pajak</h1></div></div><p v-if="message" class="surface" role="status">{{ message }}</p><ApiState :pending="pending"><div class="metric-grid"><article class="surface metric"><span>Nilai simulasi</span><input v-model.number="simulation" type="number" min="0"><strong>{{ formatRupiah(simulation) }}</strong></article><article class="surface metric"><span>Komisi</span><strong>{{ formatRupiah(commissionPreview) }}</strong></article><article class="surface metric"><span>Hak vendor sebelum pajak</span><strong>{{ formatRupiah(simulation-commissionPreview) }}</strong></article></div><div class="admin-split section"><section><h2>Kebijakan komisi</h2><form class="surface form-stack" @submit.prevent="createFee"><label class="form-field">Kunci kebijakan<input v-model="fee.policy_key" required></label><label class="form-field">Category ID<input v-model="fee.category_id"></label><label class="form-field">Tarif (desimal)<input v-model.number="fee.commission_rate" type="number" min="0" max="1" step="0.0001" required></label><label class="form-field">Biaya pembeli<input v-model.number="fee.buyer_fee_amount" type="number" min="0" required></label><label class="form-field">Mulai<input v-model="fee.valid_from" type="datetime-local" required></label><label class="form-field">Selesai<input v-model="fee.valid_until" type="datetime-local"></label><button>Buat draft</button></form><article v-for="item in fees" :key="item.id" class="surface policy-card"><div class="section-heading"><strong>{{ item.policy_key }}</strong><span class="badge">{{ statusLabel(item.status) }}</span></div><p>{{ (item.commission_rate*100).toFixed(2) }}% + {{ formatRupiah(item.buyer_fee_amount) }}</p><small>{{ formatDate(item.valid_from) }} — {{ item.valid_until ? formatDate(item.valid_until) : 'tanpa akhir' }}</small><button v-if="item.status==='DRAFT'" class="button--secondary" @click="activate('fee',item)">Aktifkan</button></article></section><section><h2>Kebijakan pajak</h2><form class="surface form-stack" @submit.prevent="createTax"><label class="form-field">Kunci kebijakan<input v-model="tax.policy_key" required></label><label class="form-field">Jenis<select v-model="tax.kind"><option>ITEM_VAT</option><option>COMMISSION_VAT</option><option>SELLER_WITHHOLDING</option></select></label><label class="form-field">Tax class ID<input v-model="tax.tax_class_id"></label><label class="form-field">Tarif<input v-model.number="tax.rate" type="number" min="0" max="1" step="0.0001"></label><div class="coordinate-grid"><label class="form-field">DPP numerator<input v-model.number="tax.dpp_numerator" type="number"></label><label class="form-field">DPP denominator<input v-model.number="tax.dpp_denominator" type="number"></label></div><label class="form-field">Mulai<input v-model="tax.valid_from" type="datetime-local" required></label><label class="form-field">Rule parameters<textarea v-model="tax.rule_parameters" /></label><button>Buat draft</button></form><article v-for="item in taxes" :key="item.id" class="surface policy-card"><div class="section-heading"><strong>{{ item.policy_key }}</strong><span class="badge">{{ statusLabel(item.status) }}</span></div><p>{{ item.kind }} · {{ (item.rate*100).toFixed(2) }}%</p><button v-if="item.status==='DRAFT'" class="button--secondary" @click="activate('tax',item)">Aktifkan</button></article></section></div></ApiState></main></template>
