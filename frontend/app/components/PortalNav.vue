<script setup lang="ts">
defineProps<{ area: 'vendor' | 'admin' }>();
</script>

<template>
  <nav v-if="area === 'vendor'" class="buyer-nav portal-nav" aria-label="Menu vendor">
    <NuxtLink to="/vendor">Dashboard</NuxtLink><NuxtLink to="/vendor/produk">Produk</NuxtLink>
    <NuxtLink to="/vendor/persediaan">Persediaan</NuxtLink><NuxtLink to="/vendor/rfq">RFQ</NuxtLink>
    <NuxtLink to="/vendor/pesanan">Pesanan</NuxtLink><NuxtLink to="/vendor/keuangan">Keuangan</NuxtLink>
    <NuxtLink to="/vendor/profil">Profil</NuxtLink><NuxtLink to="/vendor/rekening">Rekening</NuxtLink>
  </nav>
  <nav v-else class="buyer-nav portal-nav" aria-label="Menu admin">
    <NuxtLink to="/admin">Dashboard</NuxtLink><NuxtLink to="/admin/moderasi">Moderasi</NuxtLink>
    <NuxtLink to="/admin/katalog">Katalog</NuxtLink><NuxtLink to="/admin/pajak">Pajak</NuxtLink>
    <NuxtLink to="/admin/kebijakan">Kebijakan</NuxtLink><NuxtLink to="/admin/pembayaran">Pembayaran</NuxtLink>
    <NuxtLink to="/admin/rekonsiliasi">Rekonsiliasi</NuxtLink><NuxtLink to="/admin/refund">Refund</NuxtLink>
    <NuxtLink to="/admin/kasus">Kasus</NuxtLink><NuxtLink to="/admin/pengiriman">Pengiriman</NuxtLink>
    <NuxtLink to="/admin/payout">Payout</NuxtLink><NuxtLink to="/admin/jurnal">Jurnal & audit</NuxtLink>
  </nav>
</template>
