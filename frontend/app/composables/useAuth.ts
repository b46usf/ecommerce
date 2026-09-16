import type { components } from '~/api/schema';
import { errorFromResponse, unwrap, versionHeaders } from '~/api/client';

type User = components['schemas']['User'];

export function useAuth() {
  const api = useMarketplaceApi();
  const config = useRuntimeConfig();
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

  async function updateProfile(body: components['schemas']['ProfileUpdate']): Promise<User> {
    if (!user.value) throw new Error('Profil pengguna belum dimuat.');
    pending.value = true;
    try {
      const updated = unwrap(await api.PATCH('/me', {
        params: { header: versionHeaders(user.value.row_version) }, body,
      }));
      user.value = updated;
      return updated;
    } finally { pending.value = false; }
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    pending.value = true;
    try {
      const result = await api.PUT('/me/password', { body: {
        current_password: currentPassword, new_password: newPassword,
      } });
      if (result.error !== undefined) unwrap(result);
      user.value = null;
      api.clearCsrf();
    } finally { pending.value = false; }
  }

  async function updateAvatar(file: File): Promise<User> {
    if (!user.value) throw new Error('Profil pengguna belum dimuat.');
    pending.value = true;
    try {
      const body = new FormData(); body.append('file', file);
      const response = await fetch(`${String(config.public.apiBase).replace(/\/$/, '')}/me/avatar`, {
        method: 'PUT', credentials: 'include',
        headers: { 'X-CSRF-Token': await api.refreshCsrf(), ...versionHeaders(user.value.row_version) }, body,
      });
      let data: unknown;
      try { data = await response.json(); } catch { data = undefined; }
      if (!response.ok) throw errorFromResponse(response, data);
      user.value = data as User;
      return user.value;
    } finally { pending.value = false; }
  }

  async function deleteAvatar(): Promise<User> {
    if (!user.value) throw new Error('Profil pengguna belum dimuat.');
    pending.value = true;
    try {
      user.value = unwrap(await api.DELETE('/me/avatar', { params: { header: versionHeaders(user.value.row_version) } }));
      return user.value;
    } finally { pending.value = false; }
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

  return { user, pending, load, login, register, updateProfile, updateAvatar, deleteAvatar, changePassword, logout };
}
