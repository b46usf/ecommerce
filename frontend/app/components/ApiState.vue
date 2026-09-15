<script setup lang="ts">
const props = withDefaults(defineProps<{
  pending?: boolean;
  error?: { message: string; requestId?: string } | null;
  empty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
}>(), { pending: false, error: null, empty: false, emptyTitle: 'Belum ada data', emptyMessage: 'Data akan tampil di sini saat tersedia.' });
defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="props.pending" class="state-panel" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true" />
    <p>Memuat data…</p>
  </div>
  <div v-else-if="props.error" class="state-panel state-panel--error" role="alert">
    <strong>Data belum dapat dimuat</strong>
    <p>{{ props.error.message }}</p>
    <small v-if="props.error.requestId">ID permintaan: {{ props.error.requestId }}</small>
    <button class="button button--secondary" type="button" @click="$emit('retry')">Coba lagi</button>
  </div>
  <div v-else-if="props.empty" class="state-panel">
    <span class="state-icon" aria-hidden="true">□</span>
    <strong>{{ props.emptyTitle }}</strong>
    <p>{{ props.emptyMessage }}</p>
    <slot name="action" />
  </div>
  <slot v-else />
</template>
