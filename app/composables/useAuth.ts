import type { SessionUser } from '~/server/utils/auth'

export function useAuth() {
  const user = useState<SessionUser | null>('auth-user', () => null)
  const loading = useState('auth-loading', () => true)

  async function fetchSession() {
    loading.value = true
    try {
      const { data } = await useFetch('/api/auth/session')
      user.value = data.value?.user || null
    } finally {
      loading.value = false
    }
  }

  async function login(username: string, password: string) {
    const response = await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    await fetchSession()
    return response
  }

  async function register(invitationCode: string, username: string, password: string) {
    const response = await $fetch('/api/auth/register', {
      method: 'POST',
      body: { invitationCode, username, password },
    })
    await fetchSession()
    return response
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
    await navigateTo('/login')
  }

  return {
    user: readonly(user),
    loading: readonly(loading),
    fetchSession,
    login,
    register,
    logout,
  }
}
