<script setup lang="ts">
definePageMeta({ middleware: 'auth' }); const route = useRoute(); const done = ref(false); useSeoMeta({ title: 'Status operasi — Niaga' });
</script>
<template><main id="main-content" class="page-shell narrow"><p class="eyebrow">Proses latar belakang</p><h1>Status operasi</h1><section class="surface"><OperationStatus :operation-id="String(route.params.id)" @complete="done=true"/><p v-if="done" class="success">Pemrosesan telah mencapai status akhir.</p></section><button class="button--secondary" type="button" @click="$router.back()">Kembali</button></main></template>
