import type { components } from '~/api/schema';
import { MarketplaceApiError, unwrap, versionHeaders } from '~/api/client';

type BuyerAccount = components['schemas']['BuyerAccount'];
type Cart = components['schemas']['Cart'];

export function useCart() {
  const api = useMarketplaceApi();
  const account = useState<BuyerAccount | null>('active-buyer-account', () => null);
  const accounts = useState<BuyerAccount[]>('buyer-accounts', () => []);
  const cart = useState<Cart | null>('buyer-cart', () => null);
  const pending = useState('cart-pending', () => false);
  const error = useState<unknown | null>('cart-error', () => null);
  const itemCount = computed(() => cart.value?.items.reduce((total, item) => total + item.quantity, 0) ?? 0);

  async function resolveAccount(): Promise<BuyerAccount> {
    if (account.value) return account.value;
    const result = unwrap(await api.GET('/me/buyer-accounts', { params: { query: { limit: 100 } }, cache: 'no-store' }));
    accounts.value = result.items;
    const preferred = result.items.find(item => item.id === account.value?.id) ?? result.items.find(item => item.kind === 'INDIVIDUAL') ?? result.items[0];
    if (!preferred) throw new MarketplaceApiError(404, 'BUYER_ACCOUNT_NOT_FOUND', 'Konteks pembelian belum tersedia.');
    account.value = preferred;
    return preferred;
  }

  async function loadAccounts() { account.value = null; await resolveAccount(); return accounts.value; }
  async function selectAccount(id: string) {
    const selected = accounts.value.find(item => item.id === id);
    if (!selected) throw new MarketplaceApiError(404, 'BUYER_ACCOUNT_NOT_FOUND', 'Konteks pembelian tidak ditemukan.');
    account.value = selected; cart.value = null; await load();
  }

  async function load(): Promise<Cart> {
    pending.value = true;
    error.value = null;
    try {
      const buyer = await resolveAccount();
      return (cart.value = unwrap(await api.GET('/buyer-accounts/{buyerAccountId}/cart', {
        params: { path: { buyerAccountId: buyer.id } }, cache: 'no-store',
      })));
    } catch (cause) {
      error.value = cause;
      throw cause;
    } finally { pending.value = false; }
  }

  async function ensureCart(): Promise<{ buyer: BuyerAccount; value: Cart }> {
    const buyer = await resolveAccount();
    const value = cart.value ?? await load();
    return { buyer, value };
  }

  async function add(skuId: string, quantity: number): Promise<Cart> {
    pending.value = true;
    error.value = null;
    try {
      const current = await ensureCart();
      return (cart.value = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/cart/items', {
        params: { path: { buyerAccountId: current.buyer.id }, header: {
          ...versionHeaders(current.value.row_version), 'Idempotency-Key': crypto.randomUUID(),
        } },
        body: { sku_id: skuId, quantity },
      })));
    } catch (cause) {
      error.value = cause;
      if (cause instanceof MarketplaceApiError && cause.status === 412) await load();
      throw cause;
    } finally { pending.value = false; }
  }

  async function update(itemId: string, quantity: number): Promise<Cart> {
    pending.value = true;
    error.value = null;
    try {
      const current = await ensureCart();
      return (cart.value = unwrap(await api.PATCH('/buyer-accounts/{buyerAccountId}/cart/items/{cartItemId}', {
        params: { path: { buyerAccountId: current.buyer.id, cartItemId: itemId },
          header: versionHeaders(current.value.row_version) }, body: { quantity },
      })));
    } catch (cause) {
      error.value = cause;
      if (cause instanceof MarketplaceApiError && cause.status === 412) await load();
      throw cause;
    } finally { pending.value = false; }
  }

  async function remove(itemId: string): Promise<Cart> {
    pending.value = true;
    error.value = null;
    try {
      const current = await ensureCart();
      return (cart.value = unwrap(await api.DELETE('/buyer-accounts/{buyerAccountId}/cart/items/{cartItemId}', {
        params: { path: { buyerAccountId: current.buyer.id, cartItemId: itemId },
          header: versionHeaders(current.value.row_version) },
      })));
    } catch (cause) {
      error.value = cause;
      if (cause instanceof MarketplaceApiError && cause.status === 412) await load();
      throw cause;
    } finally { pending.value = false; }
  }

  function clear() {
    account.value = null;
    accounts.value = [];
    cart.value = null;
    error.value = null;
  }

  return { account, accounts, cart, pending, error, itemCount, load, loadAccounts, selectAccount, add, update, remove, clear };
}
