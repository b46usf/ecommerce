<template>
  <nav class="buyer-nav" aria-label="Menu akun pembeli">
    <NuxtLink to="/akun"><Icon name="lucide:layout-dashboard" class="size-4" />Ringkasan</NuxtLink>
    <NuxtLink to="/akun/profil"><Icon name="lucide:user-cog" class="size-4" />Profil</NuxtLink>
    <NuxtLink to="/akun/pesanan"><Icon name="lucide:package-check" class="size-4" />Pesanan</NuxtLink>
    <NuxtLink to="/akun/rfq"><Icon name="lucide:messages-square" class="size-4" />Penawaran</NuxtLink>
    <NuxtLink to="/akun/alamat"><Icon name="lucide:map-pin" class="size-4" />Alamat</NuxtLink>
    <NuxtLink to="/akun/organisasi"><Icon name="lucide:building-2" class="size-4" />Organisasi</NuxtLink>
    <NuxtLink to="/akun/refund"><Icon name="lucide:rotate-ccw" class="size-4" />Refund</NuxtLink>
  </nav>
</template>
