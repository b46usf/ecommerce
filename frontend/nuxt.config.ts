import tailwindcss from '@tailwindcss/vite';

const backendOrigin = (process.env.NUXT_BACKEND_ORIGIN ?? 'http://127.0.0.1:3001').replace(/\/+$/, '');

export default defineNuxtConfig({
  compatibilityDate: '2026-09-13',
  devtools: { enabled: false },
  modules: ['@nuxt/icon'],
  css: ['~/assets/css/tailwind.css', '~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  icon: {
    fallbackToApi: false,
    serverBundle: { collections: ['lucide'] },
    clientBundle: { scan: true },
  },
  runtimeConfig: {
    apiServerBase: 'http://127.0.0.1:3001/api/v1',
    public: {
      apiBase: '/api/v1',
      ckeditorLicenseKey: process.env.NUXT_PUBLIC_CKEDITOR_LICENSE_KEY ?? 'GPL',
    },
  },
  nitro: {
    devProxy: {
      '/api/v1': {
        // Nitro removes the matched proxy prefix, so restore it on the upstream target.
        target: `${backendOrigin}/api/v1`,
        changeOrigin: false,
      },
    },
  },
  routeRules: {
    '/': { prerender: true },
    '/kategori/**': { swr: 300 },
    '/produk/**': { swr: 300 },
    '/toko/**': { swr: 900 },
    '/kebijakan/**': { prerender: true },
    '/login': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/register': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/lupa-password': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/reset-password': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/verifikasi-email': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/akun/**': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/vendor/**': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/admin/**': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
  },
  typescript: { strict: true, typeCheck: true },
});
