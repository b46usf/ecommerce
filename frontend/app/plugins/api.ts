import { createMarketplaceApi } from '~/api/client';
import { browserOfflineNotifier, createOfflineTransport } from '~/api/offline';

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig();
  const baseUrl = import.meta.server ? config.apiServerBase : config.public.apiBase;
  const fetcher = import.meta.server ? useRequestFetch() : globalThis.fetch;
  const offline = import.meta.client ? createOfflineTransport({
    fetch: fetcher as typeof globalThis.fetch,
    storage: globalThis.localStorage,
    notify: browserOfflineNotifier,
    // navigator.onLine can be false while localhost is fully reachable. Always
    // probe the API and let an actual fetch failure activate the offline store.
    isOnline: () => config.public.offlineDemo !== true,
  }) : undefined;
  const api = createMarketplaceApi({ baseUrl, fetch: fetcher as typeof globalThis.fetch, offline });
  return { provide: { api } };
});
