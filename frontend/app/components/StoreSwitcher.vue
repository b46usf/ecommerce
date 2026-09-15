<script setup lang="ts">
import { displayError } from '~/utils/errors';
const portal = usePortal();
onMounted(() => { if (!portal.stores.value.length) void portal.loadStores().catch(() => undefined); });
</script>

<template>
  <div class="store-switcher">
    <label for="active-store">Toko aktif</label>
    <select id="active-store" :value="portal.storeId.value" :disabled="portal.pending.value" @change="portal.selectStore(($event.target as HTMLSelectElement).value)">
      <option v-for="store in portal.stores.value" :key="store.id" :value="store.id">{{ store.name }} · {{ store.status }}</option>
    </select>
    <NuxtLink v-if="!portal.pending.value && !portal.stores.value.length" to="/vendor/onboarding">Buat toko</NuxtLink>
    <small v-if="portal.error.value" class="error">{{ displayError(portal.error.value).message }}</small>
  </div>
</template>
