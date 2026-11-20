import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, apiFetch, fetchCurrentUser, useApi, useAuth } from './api.ts'

test('useApi captures an initial request failure without leaking an unhandled rejection', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ message: 'Temporarily unavailable' }, { status: 503 })
  try {
    const { data, error } = useApi('/api/example')
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(data.value, null)
    assert.ok(error.value instanceof ApiError)
    assert.equal(error.value.status, 503)
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('apiFetch reports an HTML sign-in redirect through ApiError', async t => {
  const response = new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })
  Object.defineProperty(response, 'redirected', { value: true })
  t.mock.method(globalThis, 'fetch', async () => response)
  await assert.rejects(apiFetch('/api/example'), error => {
    assert.ok(error instanceof ApiError)
    assert.match(error.message, /session.*expired.*Reload/i)
    return true
  })
})

test('apiFetch reports a plaintext gateway error without displaying its response body', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Upstream gateway details', { status: 504 }))
  await assert.rejects(apiFetch('/api/example'), error => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 504)
    assert.equal(error.message, 'Request failed (504)')
    return true
  })
})

test('the session shares in-flight requests and refreshes after the TTL or a forced fetch', async t => {
  let now = 0
  let calls = 0
  t.mock.method(Date, 'now', () => now)
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ user: { id: calls, role: 'admin' } })
  })

  const first = fetchCurrentUser({ force: true })
  assert.equal(fetchCurrentUser(), first)
  assert.equal((await first).id, 1)
  now = 59_999
  assert.equal((await fetchCurrentUser()).id, 1)
  now = 60_000
  assert.equal((await fetchCurrentUser()).id, 2)
  assert.equal((await useAuth().fetchSession({ force: true })).id, 3)
  assert.equal(calls, 3)
})

test('401 and HTML sign-in responses invalidate cached roles and pending session results', async t => {
  let returnPending!: (response: Response) => void
  let sessionCalls = 0
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url === '/api/auth/session') {
      sessionCalls++
      if (sessionCalls === 2) return new Promise<Response>(resolve => { returnPending = resolve })
      return Response.json({ user: { id: sessionCalls, role: sessionCalls === 1 ? 'admin' : 'non-admin' } })
    }
    if (url === '/expired') return new Response('<html>Sign in</html>', { status: 403, headers: { 'content-type': 'text/html' } })
    return Response.json({ message: 'Unauthorized' }, { status: 401 })
  })

  assert.equal((await fetchCurrentUser({ force: true })).role, 'admin')
  const pending = fetchCurrentUser({ force: true })
  await assert.rejects(apiFetch('/unauthorized'), { status: 401 })
  assert.equal(useAuth().user.value, null)
  returnPending(Response.json({ user: { id: 2, role: 'admin' } }))
  assert.equal((await pending).role, 'non-admin')
  await assert.rejects(apiFetch('/expired'), /session may have expired/)
  assert.equal(useAuth().user.value, null)
  assert.equal((await fetchCurrentUser()).id, 4)
})
