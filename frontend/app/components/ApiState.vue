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
    <Icon name="lucide:loader-circle" class="state-icon animate-spin" aria-hidden="true" />
    <p>Memuat data…</p>
  </div>
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
