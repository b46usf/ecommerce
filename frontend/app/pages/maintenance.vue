<script setup lang="ts">
const checking=ref(false);async function retry(){checking.value=true;await navigateTo('/');checking.value=false}useSeoMeta({title:'Pemeliharaan layanan — Niaga'})
</script>
<template><main id="main-content" class="auth-shell"><section class="auth-card maintenance-card"><span class="state-icon" aria-hidden="true">⚙</span><p class="eyebrow">Pemeliharaan terencana</p><h1>Niaga segera kembali</h1><p class="muted">Kami sedang meningkatkan layanan. Data dan transaksi Anda tetap tersimpan.</p><div class="form-actions"><button :disabled="checking" @click="retry">{{checking?'Memeriksa…':'Coba lagi'}}</button><NuxtLink class="button button--secondary" to="/status">Lihat status</NuxtLink></div></section></main></template>
