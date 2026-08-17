import { readonly, ref, type Ref } from 'vue'

export interface CurrentUser {
  id: number
  email: string
  displayName: string | null
  avatarUrl: string | null
  role: 'admin' | 'non-admin'
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly response: Record<string, unknown>) {
    super(message)
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
  const responseBody = await response.json() as T & { message?: string }
  if (!response.ok) throw new ApiError(responseBody.message || `Request failed (${response.status})`, response.status, responseBody)
  return responseBody
}

export function useApi<T>(url: string) {
  const data = ref<T | null>(null) as Ref<T | null>
  const error = ref<Error | null>(null)
  async function refresh() {
    try { data.value = await apiFetch<T>(url); error.value = null } catch (value) { error.value = value instanceof Error ? value : new Error('Request failed'); throw value }
  }
  void refresh()
  return { data, error: readonly(error), refresh }
}

const currentUser = ref<CurrentUser | null>(null)
export async function fetchCurrentUser() {
  const response = await apiFetch<{ user: CurrentUser }>('/api/auth/session')
  currentUser.value = response.user
  return response.user
}
export function useAuth() {
  return {
    user: readonly(currentUser),
    fetchSession: fetchCurrentUser,
    logout: () => { window.location.assign('/cdn-cgi/access/logout') },
  }
}
