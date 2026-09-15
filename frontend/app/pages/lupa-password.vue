<script setup lang="ts">
import { unwrap } from '~/api/client'; import { displayError } from '~/utils/errors';
const api = useMarketplaceApi(); const email = ref(''); const pending = ref(false); const message = ref(''); const error = ref('');
async function submit() { pending.value = true; error.value = ''; try { message.value = unwrap(await api.POST('/auth/forgot-password', { body: { email: email.value } })).message; } catch (cause) { error.value = displayError(cause).message; } finally { pending.value = false; } }
useSeoMeta({ title: 'Lupa password — Niaga' });
</script>
<template><main id="main-content" class="auth-shell"><form class="auth-card" @submit.prevent="submit"><p class="eyebrow">Pemulihan akun</p><h1>Lupa password</h1><p class="muted">Masukkan email akun. Respons tetap sama untuk menjaga keamanan akun.</p><label class="form-field">Email<input v-model.trim="email" required type="email" autocomplete="email"></label><p v-if="message" class="success" role="status">{{ message }}</p><p v-if="error" class="error" role="alert">{{ error }}</p><button :disabled="pending || !email" type="submit">{{ pending ? 'Mengirim…' : 'Kirim tautan reset' }}</button><NuxtLink to="/login">Kembali ke halaman masuk</NuxtLink></form></main></template>
