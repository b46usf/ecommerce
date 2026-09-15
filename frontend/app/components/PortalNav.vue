<script setup lang="ts">
defineProps<{ area: 'vendor' | 'admin' }>();
</script>

<template>
  <nav v-if="area === 'vendor'" class="buyer-nav portal-nav" aria-label="Menu vendor">
    <NuxtLink to="/vendor"><Icon name="lucide:layout-dashboard" class="size-4" />Dashboard</NuxtLink>
    <NuxtLink to="/vendor/produk"><Icon name="lucide:package" class="size-4" />Produk</NuxtLink>
    <NuxtLink to="/vendor/persediaan"><Icon name="lucide:warehouse" class="size-4" />Persediaan</NuxtLink>
    <NuxtLink to="/vendor/rfq"><Icon name="lucide:messages-square" class="size-4" />RFQ</NuxtLink>
    <NuxtLink to="/vendor/pesanan"><Icon name="lucide:clipboard-list" class="size-4" />Pesanan</NuxtLink>
    <NuxtLink to="/vendor/keuangan"><Icon name="lucide:wallet-cards" class="size-4" />Keuangan</NuxtLink>
    <NuxtLink to="/vendor/profil"><Icon name="lucide:store" class="size-4" />Profil</NuxtLink>
    <NuxtLink to="/vendor/rekening"><Icon name="lucide:landmark" class="size-4" />Rekening</NuxtLink>
  </nav>
  <nav v-else class="buyer-nav portal-nav" aria-label="Menu admin">
    <NuxtLink to="/admin"><Icon name="lucide:layout-dashboard" class="size-4" />Dashboard</NuxtLink>
    <NuxtLink to="/admin/moderasi"><Icon name="lucide:shield-check" class="size-4" />Moderasi</NuxtLink>
    <NuxtLink to="/admin/katalog"><Icon name="lucide:boxes" class="size-4" />Katalog</NuxtLink>
    <NuxtLink to="/admin/pajak"><Icon name="lucide:receipt-text" class="size-4" />Pajak</NuxtLink>
    <NuxtLink to="/admin/kebijakan"><Icon name="lucide:book-open-check" class="size-4" />Kebijakan</NuxtLink>
    <NuxtLink to="/admin/pembayaran"><Icon name="lucide:credit-card" class="size-4" />Pembayaran</NuxtLink>
    <NuxtLink to="/admin/rekonsiliasi"><Icon name="lucide:scale" class="size-4" />Rekonsiliasi</NuxtLink>
    <NuxtLink to="/admin/refund"><Icon name="lucide:rotate-ccw" class="size-4" />Refund</NuxtLink>
    <NuxtLink to="/admin/kasus"><Icon name="lucide:briefcase-business" class="size-4" />Kasus</NuxtLink>
    <NuxtLink to="/admin/pengiriman"><Icon name="lucide:truck" class="size-4" />Pengiriman</NuxtLink>
    <NuxtLink to="/admin/payout"><Icon name="lucide:banknote-arrow-up" class="size-4" />Payout</NuxtLink>
    <NuxtLink to="/admin/jurnal"><Icon name="lucide:notebook-tabs" class="size-4" />Jurnal & audit</NuxtLink>
  </nav>
</template>
