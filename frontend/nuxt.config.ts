import tailwindcss from '@tailwindcss/vite';

export default defineNuxtConfig({
  compatibilityDate: '2026-09-13',
  devtools: { enabled: false },
  features: { devLogs: 'silent' },
  modules: ['@nuxt/icon'],
  css: ['sweetalert2/dist/sweetalert2.min.css', '~/assets/css/tailwind.css', '~/assets/css/main.css'],
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
      offlineDemo: process.env.NUXT_PUBLIC_OFFLINE_DEMO === 'true',
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
