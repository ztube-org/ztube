import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, useApi } from './api.ts'

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
