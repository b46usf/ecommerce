<script setup lang="ts">
import type { components } from '~/api/schema'
import { unwrap } from '~/api/client'
import { displayError } from '~/utils/errors'
import { formatDate, formatRupiah, statusLabel } from '~/utils/format'

type Receipt = components['schemas']['PaymentReceipt']
definePageMeta({ middleware: ['auth', 'admin'] })
const api = useMarketplaceApi()
const receipts = ref<Receipt[]>([])
const attemptId = ref('')
const reason = ref('Verifikasi ulang status pembayaran')
const operationId = ref('')
const pending = ref(true)
const message = ref('')
async function load() { pending.value=true; try { receipts.value=unwrap(await api.GET('/admin/payment-receipts',{params:{query:{limit:100}},cache:'no-store'})).items } catch(cause){message.value=displayError(cause).message} finally{pending.value=false} }
async function reconcile(){try{const operation=unwrap(await api.POST('/admin/payment-attempts/{paymentAttemptId}/reconcile',{params:{path:{paymentAttemptId:attemptId.value},header:{'Idempotency-Key':crypto.randomUUID()}},body:{reason:reason.value}}));operationId.value=operation.id}catch(cause){message.value=displayError(cause).message}}
onMounted(()=>{void load()});useSeoMeta({title:'Payment review — Niaga'})
</script>
<template><main id="main-content" class="page-shell"><PortalNav area="admin"/><div class="section-heading"><div><p class="eyebrow">Payment operations</p><h1>Review pembayaran</h1></div></div><p v-if="message" class="surface" role="status">{{message}}</p><section class="surface"><h2>Reconcile payment attempt</h2><form class="filter-bar" @submit.prevent="reconcile"><label class="form-field">Payment attempt ID<input v-model="attemptId" required></label><label class="form-field">Alasan<input v-model="reason" minlength="3" required></label><button>Jalankan</button></form><OperationStatus v-if="operationId" :operation-id="operationId" @complete="load"/></section><section class="section"><h2>Receipt dan alokasi</h2><ApiState :pending="pending" :empty="!pending&&!receipts.length" empty-title="Belum ada receipt"><div class="table-wrap surface"><table><thead><tr><th>Diterima</th><th>Order group</th><th>Attempt</th><th>Nominal</th><th>Refundable</th><th>Alokasi</th></tr></thead><tbody><tr v-for="item in receipts" :key="item.id"><td>{{formatDate(item.received_at)}}</td><td><code>{{item.order_group_id.slice(0,8)}}</code></td><td><button class="text-button" @click="attemptId=item.payment_attempt_id">{{item.payment_attempt_id.slice(0,8)}}</button></td><td>{{formatRupiah(item.amount)}}</td><td>{{formatRupiah(item.refundable_amount)}}</td><td><span class="badge">{{statusLabel(item.application_status)}}</span></td></tr></tbody></table></div></ApiState></section></main></template>
