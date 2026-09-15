import type { components } from '~/api/schema';
import { unwrap } from '~/api/client';

type User = components['schemas']['User'];

export function useAuth() {
  const api = useMarketplaceApi();
  const user = useState<User | null>('auth-user', () => null);
  const pending = useState('auth-pending', () => false);

  async function load(): Promise<User | null> {
    pending.value = true;
    try {
      const result = await api.GET('/me', { cache: 'no-store' });
      if (result.response.status === 401) return (user.value = null);
      return (user.value = unwrap(result));
    } finally { pending.value = false; }
  }

  async function login(email: string, password: string): Promise<User> {
    pending.value = true;
    try {
      const result = await api.POST('/auth/login', { body: { email, password } });
      user.value = unwrap(result);
      await api.refreshCsrf(true);
      return user.value;
    } finally { pending.value = false; }
  }

  async function register(name: string, email: string, password: string) {
    pending.value = true;
    try { return unwrap(await api.POST('/auth/register', { body: { name, email, password } })); }
    finally { pending.value = false; }
  }

  async function logout(): Promise<void> {
    pending.value = true;
    try {
      const result = await api.POST('/auth/logout');
      if (result.error !== undefined) unwrap(result);
      user.value = null;
      api.clearCsrf();
    } finally { pending.value = false; }
  }

  return { user, pending, load, login, register, logout };
}
