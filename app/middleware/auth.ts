export default defineNuxtRouteMiddleware(async (to) => {
  const { user, fetchSession } = useAuth()

  await fetchSession()

  if (!user.value) {
    return navigateTo('/login')
  }

  // Role-based route protection
  const path = to.path

  if (path.startsWith('/admin') && user.value.role !== 'superadmin') {
    return navigateTo('/')
  }

  if (path.startsWith('/parent') && user.value.role !== 'parent') {
    return navigateTo('/')
  }

  if (path.startsWith('/browse') && user.value.role !== 'child') {
    return navigateTo('/')
  }
})
