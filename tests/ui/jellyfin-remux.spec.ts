import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

async function fixture(page: Page, delayed = false, incompatible = false, nativeDolby: string | false = false) {
  const state = { blocked: false, stops: [] as string[], heartbeats: [] as { state: string; positionSeconds: number }[], codecs: [] as string[], mediaReads: 0, nativeCodecs: [] as string[], resolve: undefined as (() => Promise<void>) | undefined }
  await page.route('https://media.example.com/**', async route => {
    state.mediaReads++
    const manifest = route.request().url().endsWith('.m3u8')
    const data = await readFile(new URL(`../fixtures/hls/${manifest ? 'video.m3u8' : 'video.m4s'}`, import.meta.url))
    const headers = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/)
    if (range) {
      const start = Number(range[1]), end = range[2] ? Number(range[2]) : data.length - 1
      return route.fulfill({ status: 206, contentType: 'video/mp4', body: data.subarray(start, end + 1), headers: { ...headers, 'content-range': `bytes ${start}-${end}/${data.length}` } })
    }
    return route.fulfill({ contentType: manifest ? 'application/vnd.apple.mpegurl' : 'video/mp4', body: data, headers })
  })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = {}
    if (path === '/api/auth/session') body = { user: { id: 2, role: 'non-admin', email: 'child@example.com', displayName: 'Explorer' } }
    else if (path === '/api/child/playback-authorizations') body = { authorization: { sessionId: 'hls-session', playerKind: 'native', leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), remainingSeconds: 1800, timePoolName: 'Cartoons', usageBucket: 'cartoon', resumeAt: 45, videoTitle: 'HLS test episode' } }
    else if (path.endsWith('/media')) {
      const params = new URL(route.request().url()).searchParams
      state.codecs = params.get('codecs')!.split(',')
      state.nativeCodecs = (params.get('nativeCodecs') ?? '').split(',')
      if (nativeDolby && !state.nativeCodecs.includes('eac3')) return route.fulfill({ status: 415, json: { message: 'This browser cannot play this episode’s original audio or video without transcoding. Try Safari on an Apple device, or use a compatible H.264/AAC version.' } })
      if (incompatible) return route.fulfill({ status: 415, json: { message: 'This browser cannot play this episode’s original audio. Try Safari on an Apple device.' } })
      const fulfill = () => route.fulfill({ json: { url: nativeDolby || 'https://media.example.com/video.m3u8', transport: 'hls', ...(nativeDolby ? { hlsEngine: 'native' } : {}), cleanupId: 'generation-1' } })
      if (delayed) return new Promise<void>(resolve => { state.resolve = async () => { await fulfill(); resolve() } })
      return fulfill()
    } else if (path.endsWith('/stop')) { state.stops.push(path); body = { success: true } }
    else if (path.endsWith('/heartbeats')) {
      const heartbeat = route.request().postDataJSON()
      state.heartbeats.push(heartbeat)
      body = { sequence: heartbeat.sequence, authorized: !state.blocked, remainingSeconds: state.blocked ? 0 : 1799 }
    }
    await route.fulfill({ json: body })
  })
  return state
}

test('HLS plays audio and video, resumes and seeks both ways, then releases media when time is blocked', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const state = await fixture(page)
  await page.goto('/watch?v=jf:hls-test')
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
  await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play() })
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(45)
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeCloseTo(240, 0)
  expect(await video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(160)
  expect(state.codecs).toContain('h264'); expect(state.codecs).toContain('aac')
  for (const position of [180, 10]) {
    await video.evaluate((v: HTMLVideoElement, p) => { v.currentTime = p }, position)
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.seeking && v.readyState >= 2 && v.currentTime)).toBeGreaterThan(position)
  }
  expect(state.heartbeats.some(h => h.state === 'playing' && h.positionSeconds >= 45)).toBe(true)
  expect(state.mediaReads).toBeGreaterThan(2)
  state.blocked = true
  await video.evaluate((v: HTMLVideoElement) => v.pause())
  await expect(video).toHaveCount(0)
  await expect.poll(() => state.stops.length).toBe(1)
  expect(state.stops[0]).toContain('/hls-session/media/generation-1/stop')
  expect(errors).toEqual([])
})

test('a Remux response arriving after the Child leaves is released without creating a player', async ({ page }) => {
  const state = await fixture(page, true)
  await page.goto('/watch?v=jf:hls-test')
  await expect.poll(() => Boolean(state.resolve)).toBe(true)
  // pagehide uses the same teardown path as route changes and closing the tab.
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await state.resolve!()
  await expect.poll(() => state.stops.length).toBe(1)
  await expect(page.locator('video')).toHaveCount(0)
  expect(state.mediaReads).toBe(0)
})

test('unsupported original audio has a useful error and never starts a media download', async ({ page }) => {
  const state = await fixture(page, false, true)
  await page.goto('/watch?v=jf:hls-test')
  await expect(page.getByText(/Try Safari on an Apple device/)).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  expect(state.mediaReads).toBe(0)
})


// Serve real media from a different origin so this regression exercises
// native HLS CORS, decoding and seeking while the ZTube API stays mocked.
async function nativeFixtureServer() {
  const manifest = await readFile(new URL('../fixtures/hls/video.m3u8', import.meta.url))
  const media = await readFile(new URL('../fixtures/hls/video.m4s', import.meta.url))
  const server = createServer((request, response) => {
    const playlist = request.url === '/video.m3u8'
    if (!playlist && request.url !== '/video.m4s') { response.writeHead(404); response.end(); return }
    const body = playlist ? manifest : media
    const headers = { 'content-type': playlist ? 'application/vnd.apple.mpegurl' : 'video/mp4', 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
    const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/)
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
      response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 })
      response.end(body.subarray(start, end + 1))
    } else { response.writeHead(200, { ...headers, 'content-length': body.length }); response.end(body) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/video.m3u8` }
}

test('Chrome can use native HLS for Dolby audio when its MSE interface rejects that codec', async ({ page }) => {
  await page.addInitScript(() => {
    const canPlay = HTMLMediaElement.prototype.canPlayType
    HTMLMediaElement.prototype.canPlayType = function(type) {
      if (type.includes('ec-3') || type.includes('mpegurl')) return 'probably'
      return canPlay.call(this, type)
    }
    const supports = MediaSource.isTypeSupported.bind(MediaSource)
    MediaSource.isTypeSupported = type => !type.includes('ec-3') && supports(type)
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' })
  })
  const { server, url } = await nativeFixtureServer()
  try {
    const state = await fixture(page, false, false, url)
    await page.goto('/watch?v=jf:hls-test')
    await expect(page.getByText(/This browser cannot play this episode/)).toHaveCount(0)
    await expect.poll(() => state.nativeCodecs).toContain('eac3')
    expect(state.codecs).not.toContain('eac3')
    // The returned URL must reach the native video element. Choosing hls.js
    // would repeat the same unsupported-MSE failure after passing negotiation.
    await expect(page.locator('video')).toHaveAttribute('src', url)
    // The local fixture uses AAC (this runner has no EAC3 decoder). Exercise the
    // native HLS transport for real, while the profile override covers selection.
    await page.locator('video').evaluate((v: HTMLVideoElement) => { v.muted = true; void v.play().catch(() => undefined) })
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(45)
    for (const position of [180, 10]) {
      await page.locator('video').evaluate((v: HTMLVideoElement, p) => { v.currentTime = p }, position)
      await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => !v.seeking && v.readyState >= 2 && v.currentTime)).toBeGreaterThan(position)
    }
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
    await expect.poll(() => state.stops.length).toBe(1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})
