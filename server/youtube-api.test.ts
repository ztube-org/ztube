import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchChannelMetadata, YouTubeApiError } from './utils/youtube-api.ts'

test('reports an invalid YouTube API key instead of misreporting a missing channel', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] },
  }), { status: 400, headers: { 'content-type': 'application/json' } })

  try {
    await assert.rejects(
      fetchChannelMetadata('@MarkRober', 'invalid-key'),
      (error: unknown) => error instanceof YouTubeApiError && error.message === 'YouTube API key is invalid; update YOUTUBE_API_KEY',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
