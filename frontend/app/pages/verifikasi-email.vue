<script setup lang="ts">
import { unwrap } from '~/api/client'; import { displayError } from '~/utils/errors';
const api = useMarketplaceApi(); const route = useRoute(); const token = ref(typeof route.query.token === 'string' ? route.query.token : ''); const pending = ref(false); const message = ref(''); const error = ref('');
async function verify() { pending.value = true; error.value = ''; try { message.value = unwrap(await api.POST('/auth/verify-email', { body: { token: token.value } })).message; } catch (cause) { error.value = displayError(cause).message; } finally { pending.value = false; } }
useSeoMeta({ title: 'Verifikasi email — Niaga' });
</script>
<template><main id="main-content" class="auth-shell"><section class="auth-card"><p class="eyebrow">Verifikasi akun</p><h1>Verifikasi email</h1><label v-if="!message" class="form-field">Token verifikasi<input v-model.trim="token" autocomplete="off"></label><p v-if="message" class="success" role="status">{{ message }}</p><p v-if="error" class="error" role="alert">{{ error }} Minta tautan baru melalui proses pendaftaran atau hubungi dukungan.</p><button v-if="!message" :disabled="pending || !token" type="button" @click="verify">{{ pending ? 'Memverifikasi…' : 'Verifikasi email' }}</button><NuxtLink v-else class="button" to="/login">Masuk sekarang</NuxtLink></section></main></template>
