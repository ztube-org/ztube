import { readonly, ref, type Ref } from 'vue'

export interface CurrentUser {
  id: number
  email: string
  displayName: string | null
  avatarUrl: string | null
  role: 'admin' | 'non-admin'
}

export class ApiError extends Error {
  readonly status: number
  readonly response: Record<string, unknown>

  constructor(message: string, status: number, response: Record<string, unknown>) {
    super(message)
    this.status = status
    this.response = response
  }
}

export async function apiFetch<T>(url: string, init?: Omit<RequestInit, 'body'> & { body?: unknown }): Promise<T> {
  const { body, ...requestInit } = init || {}
  const options: RequestInit = { ...requestInit, headers: { Accept: 'application/json', ...requestInit.headers } }
  if (body !== undefined && typeof body !== 'string') {
    options.body = JSON.stringify(body)
    options.headers = { ...options.headers, 'Content-Type': 'application/json' }
  } else if (typeof body === 'string') options.body = body
  const response = await fetch(url, options)
  const html = response.headers.get('content-type')?.includes('text/html')
  const sessionExpired = response.status === 401 || (html && (response.redirected || response.status === 403))
  if (sessionExpired) invalidateSession()
  const fallback = `Request failed (${response.status})`
  let responseBody: unknown
  try {
    responseBody = await response.json()
  } catch {
    const message = sessionExpired ? 'Your session may have expired. Reload the page to sign in again.'
      : response.ok ? 'The server returned an unexpected response. Reload the page and try again.' : fallback
    throw new ApiError(message, response.status, {})
  }
  if (!response.ok) {
    const details = responseBody && typeof responseBody === 'object' ? responseBody as Record<string, unknown> : {}
    const message = typeof details.message === 'string' && details.message ? details.message : fallback
    throw new ApiError(message, response.status, details)
  }
  return responseBody as T
}

export function useApi<T>(url: string) {
  const data = ref<T | null>(null) as Ref<T | null>
  const error = ref<Error | null>(null)
  async function refresh() {
    try { data.value = await apiFetch<T>(url); error.value = null } catch (value) { error.value = value instanceof Error ? value : new Error('Request failed'); throw value }
  }
  void refresh().catch(() => undefined)
  return { data, error: readonly(error), refresh }
}

const SESSION_TTL_MS = 60_000
const currentUser = ref<CurrentUser | null>(null)
let sessionExpiresAt = 0
let sessionRequest: Promise<CurrentUser> | null = null

function invalidateSession() {
  currentUser.value = null
  sessionExpiresAt = 0
  sessionRequest = null
}

export function fetchCurrentUser({ force = false } = {}): Promise<CurrentUser> {
  if (force) sessionExpiresAt = 0
  if (sessionRequest) return sessionRequest
  if (currentUser.value && Date.now() < sessionExpiresAt) return Promise.resolve(currentUser.value)

  const request = apiFetch<{ user: CurrentUser }>('/api/auth/session', { cache: 'no-store' })
    .then(({ user }) => {
      if (sessionRequest !== request) return fetchCurrentUser()
      currentUser.value = user
      sessionExpiresAt = Date.now() + SESSION_TTL_MS
      return currentUser.value
    })
    .finally(() => {
      if (sessionRequest === request) sessionRequest = null
    })
  sessionRequest = request
  return request
}

export function useAuth() {
  return {
    user: readonly(currentUser),
    fetchSession: fetchCurrentUser,
    logout: () => {
      invalidateSession()
      window.location.assign('/cdn-cgi/access/logout')
    },
  }
}
