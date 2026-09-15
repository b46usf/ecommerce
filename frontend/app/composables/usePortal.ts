import type { components } from '~/api/schema';
import { unwrap } from '~/api/client';

type Store = components['schemas']['Store'];

export function usePortal() {
  const api = useMarketplaceApi();
  const { user } = useAuth();
  const stores = useState<Store[]>('portal-stores', () => []);
  const storeId = useState<string>('portal-store-id', () => '');
  const pending = useState('portal-pending', () => false);
  const error = useState<unknown | null>('portal-error', () => null);
  const activeStore = computed(() => stores.value.find(store => store.id === storeId.value) ?? stores.value[0] ?? null);
  const isAdmin = computed(() => Boolean(user.value?.admin_roles.length));

  async function loadStores() {
    pending.value = true; error.value = null;
    try {
      const result = unwrap(await api.GET('/vendor/stores', { params: { query: { limit: 100 } }, cache: 'no-store' }));
      stores.value = result.items;
      if (!stores.value.some(store => store.id === storeId.value)) storeId.value = stores.value[0]?.id ?? '';
      return stores.value;
    } catch (cause) { error.value = cause; throw cause; }
    finally { pending.value = false; }
  }

  function selectStore(id: string) { if (stores.value.some(store => store.id === id)) storeId.value = id; }
  function clear() { stores.value = []; storeId.value = ''; error.value = null; }
  return { stores, storeId, activeStore, pending, error, isAdmin, loadStores, selectStore, clear };
}
