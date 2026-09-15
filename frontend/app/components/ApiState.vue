<script setup lang="ts">
import type { VNode, VNodeArrayChildren } from 'vue'
import type { SkeletonVariant } from './LoadingSkeleton.vue'

const props = withDefaults(defineProps<{
  pending?: boolean
  error?: { message: string; requestId?: string } | null
  empty?: boolean
  emptyTitle?: string
  emptyMessage?: string
  skeleton?: SkeletonVariant | 'auto'
  skeletonCount?: number
  loadingLabel?: string
}>(), {
  pending: false,
  error: null,
  empty: false,
  emptyTitle: 'Belum ada data',
  emptyMessage: 'Data akan tampil di sini saat tersedia.',
  skeleton: 'auto',
  skeletonCount: 4,
  loadingLabel: 'Memuat data',
})

defineEmits<{ retry: [] }>()
const slots = useSlots()

function classText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(classText).join(' ')
  if (value && typeof value === 'object') return Object.entries(value).filter(([, active]) => active).map(([name]) => name).join(' ')
  return ''
}

function collectClasses(nodes: VNodeArrayChildren, output: string[]) {
  for (const child of nodes) {
    if (!child || typeof child !== 'object') continue
    const vnode = child as VNode
    output.push(classText(vnode.props?.class))
    if (Array.isArray(vnode.children)) collectClasses(vnode.children as VNodeArrayChildren, output)
  }
}

const inferredSkeleton = computed<SkeletonVariant>(() => {
  if (props.skeleton !== 'auto') return props.skeleton
  const classes: string[] = []
  collectClasses(slots.default?.() ?? [], classes)
  const content = classes.join(' ')
  if (/product-grid/.test(content)) return 'cards'
  if (/admin-table-wrap|table-wrap/.test(content)) return 'table'
  if (/metric-grid/.test(content)) return 'dashboard'
  if (/order-list|card-list|inventory-grid|data-list|shipping-groups/.test(content)) return 'list'
  if (/product-detail|order-detail-grid|checkout-layout/.test(content)) return 'detail'
  if (/form-stack|rfq-form|address-form|editor-layout/.test(content)) return 'form'
  return 'page'
})
</script>

<template>
  <template v-if="props.pending">
    <slot name="loading">
      <LoadingSkeleton :variant="inferredSkeleton" :count="props.skeletonCount" :label="props.loadingLabel" />
    </slot>
  </template>
  <div v-else-if="props.error" class="state-panel state-panel--error" role="alert">
    <Icon name="lucide:circle-alert" class="state-icon" aria-hidden="true" />
    <strong>Data belum dapat dimuat</strong>
    <p>{{ props.error.message }}</p>
    <small v-if="props.error.requestId">ID permintaan: {{ props.error.requestId }}</small>
    <button class="button button--secondary" type="button" @click="$emit('retry')"><Icon name="lucide:refresh-cw" class="size-4" />Coba lagi</button>
  </div>
  <div v-else-if="props.empty" class="state-panel">
    <Icon name="lucide:package-open" class="state-icon" aria-hidden="true" />
    <strong>{{ props.emptyTitle }}</strong>
    <p>{{ props.emptyMessage }}</p>
    <slot name="action" />
  </div>
  <slot v-else />
</template>
