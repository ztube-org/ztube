import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchChannelMetadata, fetchVideoMetadata, YouTubeApiError } from './utils/youtube-api.ts'

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

test('reads the video description without requesting comments', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return Response.json({ items: [{ id: 'video', snippet: { title: 'Title', description: 'First line\nSecond line', channelTitle: 'Channel' }, contentDetails: { duration: 'PT10M' } }] })
  }

  try {
    const video = await fetchVideoMetadata('video', 'test-key')
    assert.equal(video.description, 'First line\nSecond line')
    assert.match(requestedUrl, /part=snippet(?:%2C|,)contentDetails(?:%2C|,)status/)
    assert.doesNotMatch(requestedUrl, /comment/i)
  } finally {
    globalThis.fetch = originalFetch
  }
})
