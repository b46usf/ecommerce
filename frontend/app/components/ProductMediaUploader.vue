<script setup lang="ts">
import type { components } from '~/api/schema'
import { errorFromResponse } from '~/api/client'
const props = defineProps<{ storeId: string; productId: string; currentCount: number }>()
const emit = defineEmits<{ uploaded: [media: components['schemas']['Media']] }>()
const api = useMarketplaceApi(); const config = useRuntimeConfig(); const file = ref<File>(); const fileInput = ref<HTMLInputElement>(); const alt = ref(''); const pending = ref(false); const message = ref(''); const dragging = ref(false)
const preview = computed(() => file.value ? URL.createObjectURL(file.value) : '')
watch(preview, (value, old) => { if (old) URL.revokeObjectURL(old) }); onUnmounted(() => { if (preview.value) URL.revokeObjectURL(preview.value) })
function validate(selected?: File) {
  message.value = ''
  if (!selected) { file.value = undefined; return }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) { message.value = `${selected.name}: format harus JPG, PNG, atau WebP.`; file.value = undefined; return }
  if (selected.size > 5 * 1024 * 1024) { message.value = `${selected.name}: gambar maksimal 5 MB.`; file.value = undefined; return }
  if (props.currentCount >= 8) { message.value = 'Maksimal 8 gambar per produk.'; file.value = undefined; return }
  file.value = selected
}
function choose(event: Event) { validate((event.target as HTMLInputElement).files?.[0]) }
function openChooser() { fileInput.value?.click() }
function drop(event: DragEvent) { dragging.value = false; validate(event.dataTransfer?.files?.[0]) }
async function upload() {
  if (!file.value || props.currentCount >= 8) return
  pending.value = true; message.value = ''
  try {
    const body = new FormData(); body.append('file', file.value); body.append('alt_text', alt.value); body.append('sort_order', String(props.currentCount + 1))
    const response = await fetch(`${String(config.public.apiBase).replace(/\/$/, '')}/vendor/stores/${props.storeId}/products/${props.productId}/media`, { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': await api.refreshCsrf(), 'Idempotency-Key': crypto.randomUUID() }, body })
    const data = await response.json(); if (!response.ok) throw errorFromResponse(response, data)
    emit('uploaded', data); file.value = undefined; alt.value = ''; message.value = 'Gambar diproses dan diterbitkan.'
  }
  catch (cause) { message.value = cause instanceof Error ? cause.message : 'Upload gagal.' }
  finally { pending.value = false }
}
</script>
<template><form class="upload-box" @submit.prevent="upload"><h3>Tambah gambar ({{ currentCount }}/8)</h3><label class="media-dropzone" :class="{ dragging }" tabindex="0" @dragover.prevent="dragging=true" @dragleave.prevent="dragging=false" @drop.prevent="drop" @keydown.enter.prevent="openChooser"><input ref="fileInput" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" :disabled="currentCount>=8" @change="choose"><img v-if="preview" :src="preview" alt="Pratinjau gambar pilihan"><span v-else>Tarik gambar ke sini atau tekan Enter untuk memilih</span><small>JPG, PNG, atau WebP · maksimal 5 MB</small></label><label class="form-field">Teks alternatif<input v-model.trim="alt" maxlength="300" required></label><button :disabled="pending||!file||!alt||currentCount>=8">{{pending?'Mengunggah…':'Unggah gambar'}}</button><p v-if="message" role="status" :class="{error:!message.includes('diterbitkan')}">{{message}}</p></form></template>
