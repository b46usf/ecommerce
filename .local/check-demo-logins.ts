import { createMarketplaceApi, unwrap } from '../frontend/app/api/client.ts';

const accounts = [
  { role: 'ADMIN', email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD },
  { role: 'BUYER', email: process.env.SEED_BUYER_EMAIL, password: process.env.SEED_BUYER_PASSWORD },
  { role: 'VENDOR', email: process.env.SEED_VENDOR_EMAIL, password: process.env.SEED_VENDOR_PASSWORD },
];
const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001/api/v1';
const frontendOrigin = new URL(baseUrl).origin;

async function main() {
for (const account of accounts) {
  if (!account.email || !account.password) throw new Error(`Missing ${account.role} seed credentials`);
  let cookie = '';
  const browserFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const headers = new Headers(request.headers);
    if (cookie) headers.set('Cookie', cookie);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) headers.set('Origin', frontendOrigin);
    const response = await fetch(new Request(request, { headers }));
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = /Max-Age=0/i.test(setCookie) ? '' : setCookie.split(';')[0] ?? '';
    return response;
  };
  const api = createMarketplaceApi({ baseUrl, fetch: browserFetch });
  const login = unwrap(await api.POST('/auth/login', { body: { email: account.email, password: account.password } }));
  const me = unwrap(await api.GET('/me', { cache: 'no-store' }));
  const logout = await api.POST('/auth/logout');
  console.log(JSON.stringify({ role: account.role, email: account.email, userId: me.id, loginMatchesProfile: login.id === me.id, logoutStatus: logout.response.status }));
}
}

void main();
