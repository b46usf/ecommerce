export default defineNuxtRouteMiddleware(async to => {
  if (import.meta.server) return;
  const { user, load } = useAuth();
  if (!user.value) await load().catch(() => null);
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } });
});
