import { createMarketplaceApi } from '~/api/client';

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const baseUrl = import.meta.server ? config.apiServerBase : config.public.apiBase;
  const fetcher = import.meta.server ? useRequestFetch() : globalThis.fetch;
  const api = createMarketplaceApi({ baseUrl, fetch: fetcher as typeof globalThis.fetch });
  return { provide: { api } };
});
