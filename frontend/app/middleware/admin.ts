export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) return
  const { user, load } = useAuth()
  if (!user.value) await load().catch(() => null)
  if (!user.value) return navigateTo('/login')
  if (!user.value.admin_roles.length) throw createError({ statusCode: 403, statusMessage: 'Akses admin diperlukan.' })
})
