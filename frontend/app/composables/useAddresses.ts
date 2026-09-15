import type { components } from '~/api/schema';
import { unwrap, versionHeaders } from '~/api/client';

type Address = components['schemas']['Address'];
type AddressWrite = components['schemas']['AddressWrite'];

export function useAddresses() {
  const api = useMarketplaceApi(); const cart = useCart(); const { account } = cart;
  const addresses = useState<Address[]>('buyer-addresses', () => []); const pending = ref(false); const error = ref<unknown>();
  async function accountId() { if (!account.value) await cart.load(); if (!account.value) throw new Error('Konteks pembeli tidak tersedia.'); return account.value.id; }
  async function load() { pending.value = true; error.value = undefined; try { const id = await accountId(); const result = unwrap(await api.GET('/buyer-accounts/{buyerAccountId}/addresses', { params: { path: { buyerAccountId: id }, query: { limit: 100 } }, cache: 'no-store' })); addresses.value = result.items; return result.items; } catch (cause) { error.value = cause; throw cause; } finally { pending.value = false; } }
  async function create(body: AddressWrite) { pending.value = true; try { const id = await accountId(); const value = unwrap(await api.POST('/buyer-accounts/{buyerAccountId}/addresses', { params: { path: { buyerAccountId: id }, header: { 'Idempotency-Key': crypto.randomUUID() } }, body })); await load(); return value; } finally { pending.value = false; } }
  async function update(address: Address, body: AddressWrite) { pending.value = true; try { const id = await accountId(); const value = unwrap(await api.PUT('/buyer-accounts/{buyerAccountId}/addresses/{addressId}', { params: { path: { buyerAccountId: id, addressId: address.id }, header: versionHeaders(address.row_version) }, body })); await load(); return value; } finally { pending.value = false; } }
  async function archive(address: Address) { pending.value = true; try { const id = await accountId(); const result = await api.DELETE('/buyer-accounts/{buyerAccountId}/addresses/{addressId}', { params: { path: { buyerAccountId: id, addressId: address.id }, header: versionHeaders(address.row_version) } }); if (result.error !== undefined) unwrap(result); await load(); } finally { pending.value = false; } }
  return { addresses, pending, error, load, create, update, archive };
}
