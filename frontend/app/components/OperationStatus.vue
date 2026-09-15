<script setup lang="ts">
import type { components } from '~/api/schema';
import { unwrap } from '~/api/client';
import { displayError } from '~/utils/errors';
import { statusLabel } from '~/utils/format';
const props = defineProps<{ operationId: string; pollMs?: number }>();
const emit = defineEmits<{ complete: [value: components['schemas']['AsyncOperation']] }>();
const api = useMarketplaceApi(); const operation = ref<components['schemas']['AsyncOperation']>(); const error = ref<unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;
const terminal = computed(() => operation.value && ['SUCCEEDED','FAILED','REVIEW'].includes(operation.value.state));
async function load() { clearTimeout(timer); try { operation.value = unwrap(await api.GET('/operations/{operationId}', { params: { path: { operationId: props.operationId } }, cache: 'no-store' })); error.value = undefined; if (terminal.value) emit('complete', operation.value); else timer = setTimeout(load, props.pollMs ?? 2500); } catch (cause) { error.value = cause; timer = setTimeout(load, 5000); } }
watch(() => props.operationId, () => { if (props.operationId) void load(); }, { immediate: true }); onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <div class="operation-status" role="status" aria-live="polite">
    <LoadingSkeleton v-if="!operation && !error" variant="compact" :count="2" label="Memeriksa status proses" />
    <template v-if="operation"><span v-if="!terminal" class="operation-pulse skeleton-block" aria-hidden="true"/><strong>{{ statusLabel(operation.state) }}</strong><small v-if="operation.error" class="error">{{ operation.error }}</small></template>
    <button v-if="error" class="text-button" type="button" @click="load">{{ displayError(error).message }} · Coba lagi</button>
  </div>
</template>
