<script setup lang="ts">
const props = defineProps<{ error: { statusCode?: number; statusMessage?: string; message?: string } }>();
const title = computed(() => props.error.statusCode === 404 ? 'Halaman tidak ditemukan' : props.error.statusCode === 403 ? 'Akses ditolak' : props.error.statusCode === 503 ? 'Layanan sedang dipelihara' : 'Terjadi gangguan');
</script>
<template><NuxtLayout><main id="main-content" class="auth-shell"><section class="auth-card"><p class="eyebrow">Error {{ error.statusCode ?? 500 }}</p><h1>{{ title }}</h1><p class="muted">{{ error.statusMessage || error.message || 'Halaman belum dapat ditampilkan.' }}</p><div class="form-actions"><button type="button" @click="clearError({ redirect: '/' })">Kembali ke beranda</button><NuxtLink v-if="error.statusCode === 503" class="button button--secondary" to="/status">Lihat status</NuxtLink></div></section></main></NuxtLayout></template>
