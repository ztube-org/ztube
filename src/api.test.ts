import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, apiFetch, useApi } from './api.ts'

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
