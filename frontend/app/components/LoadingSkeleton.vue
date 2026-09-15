<script setup lang="ts">
export type SkeletonVariant = 'page' | 'cards' | 'table' | 'list' | 'detail' | 'form' | 'dashboard' | 'compact'

const props = withDefaults(defineProps<{
  variant?: SkeletonVariant
  count?: number
  label?: string
}>(), {
  variant: 'page',
  count: 4,
  label: 'Memuat data',
})

const itemCount = computed(() => Math.min(12, Math.max(1, props.count)))
</script>

<template>
  <div class="loading-skeleton" :class="`loading-skeleton--${variant}`" role="status" aria-live="polite" aria-busy="true">
    <span class="sr-only">{{ label }}…</span>

    <template v-if="variant === 'cards'">
      <div class="skeleton-card-grid" aria-hidden="true">
        <article v-for="index in itemCount" :key="index" class="skeleton-card">
          <span class="skeleton-block skeleton-card__image" />
          <span class="skeleton-block skeleton-line skeleton-line--short" />
          <span class="skeleton-block skeleton-line" />
          <span class="skeleton-block skeleton-line skeleton-line--medium" />
        </article>
      </div>
    </template>

    <template v-else-if="variant === 'table'">
      <div class="skeleton-table" aria-hidden="true">
        <div class="skeleton-table__head"><span v-for="column in 4" :key="column" class="skeleton-block skeleton-line" /></div>
        <div v-for="row in itemCount" :key="row" class="skeleton-table__row"><span v-for="column in 4" :key="column" class="skeleton-block skeleton-line" /></div>
      </div>
    </template>

    <template v-else-if="variant === 'list'">
      <div class="skeleton-list" aria-hidden="true">
        <article v-for="index in itemCount" :key="index" class="skeleton-list__item">
          <span class="skeleton-block skeleton-avatar" />
          <span class="skeleton-list__copy"><span class="skeleton-block skeleton-line skeleton-line--medium" /><span class="skeleton-block skeleton-line" /></span>
          <span class="skeleton-block skeleton-pill" />
        </article>
      </div>
    </template>

    <template v-else-if="variant === 'detail'">
      <div class="skeleton-detail" aria-hidden="true">
        <span class="skeleton-block skeleton-detail__media" />
        <div class="skeleton-detail__copy">
          <span class="skeleton-block skeleton-pill" />
          <span class="skeleton-block skeleton-title" />
          <span class="skeleton-block skeleton-line skeleton-line--medium" />
          <span class="skeleton-block skeleton-price" />
          <span class="skeleton-block skeleton-field" />
          <span class="skeleton-block skeleton-button" />
        </div>
      </div>
    </template>

    <template v-else-if="variant === 'form'">
      <div class="skeleton-form" aria-hidden="true">
        <span class="skeleton-block skeleton-title" />
        <div v-for="index in itemCount" :key="index" class="skeleton-form__field"><span class="skeleton-block skeleton-line skeleton-line--short" /><span class="skeleton-block skeleton-field" /></div>
        <span class="skeleton-block skeleton-button" />
      </div>
    </template>

    <template v-else-if="variant === 'dashboard'">
      <div aria-hidden="true">
        <div class="skeleton-metrics"><span v-for="index in itemCount" :key="index" class="skeleton-block skeleton-metric" /></div>
        <div class="skeleton-list"><article v-for="index in 3" :key="index" class="skeleton-list__item"><span class="skeleton-block skeleton-avatar" /><span class="skeleton-list__copy"><span class="skeleton-block skeleton-line skeleton-line--medium" /><span class="skeleton-block skeleton-line" /></span></article></div>
      </div>
    </template>

    <template v-else-if="variant === 'compact'">
      <div class="skeleton-compact" aria-hidden="true"><span v-for="index in itemCount" :key="index" class="skeleton-block skeleton-line" /></div>
    </template>

    <template v-else>
      <div class="skeleton-page" aria-hidden="true">
        <span class="skeleton-block skeleton-title" />
        <span class="skeleton-block skeleton-line skeleton-line--medium" />
        <div class="skeleton-list"><article v-for="index in itemCount" :key="index" class="skeleton-list__item"><span class="skeleton-block skeleton-avatar" /><span class="skeleton-list__copy"><span class="skeleton-block skeleton-line skeleton-line--medium" /><span class="skeleton-block skeleton-line" /></span><span class="skeleton-block skeleton-pill" /></article></div>
      </div>
    </template>
  </div>
</template>
