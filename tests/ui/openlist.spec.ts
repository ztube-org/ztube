import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function fixture(page: Page, admin = false) {
  const state = { blocked: false, heartbeats: [] as { sequence: number; state: string; positionSeconds: number }[], authorizations: [] as string[], savedItems: [] as { duration: number }[], shared: false, savedProvider: null as Record<string, unknown> | null, previewPaths: [] as string[], failedPaths: new Set<string>() }
  const provider = { id: 'provider-1', name: 'Home cartoons', url: 'https://openlist.example.com/dav/', rootPath: '/Cartoons', enabled: true, username: 'parent', hasPassword: true, revision: 1, headers: [{ name: 'X-ZTube-Access', hasValue: true }] }
  const playlist = { id: 'pl:animation', title: 'Animation', thumbnail: null, revision: 1 }
  const videos = [1, 2, 3].map((n, index) => ({ videoId: `ol:episode-${n}`, videoTitle: `Episode ${n}`, videoThumbnail: null, duration: 240, channelTitle: 'Animation', publishedAt: null, contentRule: 'restricted', season: n < 2 ? 'Season 1' : 'Season 2', position: index, positionSeconds: n === 2 ? 45 : undefined }))
  const watchTime = { restricted: { remainingSeconds: 1800, locked: false }, exempt: { remainingSeconds: 3600, locked: false } }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const method = route.request().method()
    const body = () => route.request().postDataJSON()
    let response: unknown = {}
    if (url.pathname === '/api/auth/session') response = { user: { id: 2, email: 'child@example.com', displayName: 'Explorer', role: admin ? 'admin' : 'non-admin' } }
    else if (url.pathname === '/api/child/recommendations/count') response = { count: 0 }
    else if (url.pathname === '/api/child/watch-time') response = { ...watchTime, policy: { blocked: false } }
    else if (url.pathname === '/api/admin/children') response = { children: [{ id: 2, email: 'child@example.com', displayName: 'Explorer' }] }
    else if (url.pathname === '/api/admin/providers') response = { providers: [provider] }
    else if (url.pathname.endsWith('/browse') && url.pathname.includes('/providers/')) response = { path: '/Cartoons/Season 1', nextPage: null, files: [1, 2, 10].map(n => ({ name: `Episode ${n}.mp4`, path: `/Cartoons/Season 1/Episode ${n}.mp4`, playable: true, isDirectory: false })) }
    else if (url.pathname === '/api/admin/providers/provider-1' && method === 'POST') { state.savedProvider = body(); response = { id: provider.id } }
    else if (url.pathname.endsWith('/preview')) {
      const path = body().path; state.previewPaths.push(path)
      if (state.failedPaths.has(path)) return route.fulfill({ status: 502, json: { message: 'Unable to resolve this video. Check the Provider connection.' } })
      response = { url: '/fixture-native.mp4' }
    }
    else if (url.pathname === '/api/admin/library-playlists') response = { playlists: [] }
    else if (url.pathname.endsWith('/children/2')) { state.shared = true; response = { success: true } }
    else if (url.pathname.startsWith('/api/admin/library-playlists/') && method === 'POST') { state.savedItems = body().items; response = { id: playlist.id } }
    else if (url.pathname === `/api/admin/library-playlists/${playlist.id}`) response = { playlist, items: state.savedItems, approvals: state.shared ? [{ childId: 2, contentRule: 'restricted', tags: [] }] : [] }
    else if (url.pathname.endsWith('/videos')) response = { playlist: { id: 9, title: 'Animation', curated: true, isAvailable: true, contentRule: 'restricted', tags: [] }, videos: videos.filter(v => v.videoTitle.toLowerCase().includes((url.searchParams.get('q') ?? '').toLowerCase())), nextPage: null, favoriteVideoIds: [], watchTime, policy: { blocked: false } }
    else if (url.pathname === '/api/child/playback-authorizations') {
      const videoId = body().videoId; state.authorizations.push(videoId)
      response = { authorization: { sessionId: videoId, playerKind: 'native', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), remainingSeconds: 1800, usageBucket: 'restricted', resumeAt: 45, favorite: false, videoTitle: videos.find(v => v.videoId === videoId)?.videoTitle, channelTitle: 'Animation' } }
    } else if (url.pathname.endsWith('/media')) response = { url: '/fixture-native.mp4' }
    else if (url.pathname.endsWith('/heartbeats')) {
      state.heartbeats.push(body()); response = { sequence: state.blocked ? 0 : body().sequence, authorized: !state.blocked, remainingSeconds: state.blocked ? 0 : 1800 }
    }
    await route.fulfill({ json: response })
  })
  const mp4 = await readFile(new URL('../fixtures/native-video.mp4', import.meta.url))
  await page.route('**/fixture-native.mp4', async route => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/)
    if (!range) return route.fulfill({ contentType: 'video/mp4', body: mp4, headers: { 'accept-ranges': 'bytes' } })
    const start = Number(range[1]); const end = range[2] ? Math.min(Number(range[2]), mp4.length - 1) : mp4.length - 1
    await route.fulfill({ status: 206, contentType: 'video/mp4', body: mp4.subarray(start, end + 1), headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${mp4.length}` } })
  })
  return state
}

test('Admin edits a WebDAV Provider and selects naturally ordered episodes, preserves masked secrets, previews, saves and shares a Playlist', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const state = await fixture(page, true)
  await page.goto('/admin/library')
  await page.getByRole('button', { name: 'Home cartoons · Edit' }).click()
  await expect(page.getByPlaceholder('Leave blank to keep saved password')).toHaveValue('')
  await expect(page.getByLabel('WebDAV URL', { exact: true })).toHaveValue('https://openlist.example.com/dav/')
  await expect(page.getByLabel('Directory password (optional)')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save Provider', exact: true }).click()
  await expect.poll(() => Boolean(state.savedProvider)).toBe(true)
  expect(state.savedProvider?.password).toBeUndefined()
  expect(state.savedProvider?.headers).toEqual([{ name: 'X-ZTube-Access' }])
  await page.getByLabel('Playlist title').fill('Animation')
  await page.getByLabel('Provider', { exact: true }).selectOption('provider-1')
  await page.getByRole('button', { name: 'Select listed videos' }).click()
  await page.getByRole('button', { name: 'Add 3 files' }).click()
  await expect.poll(() => page.getByLabel('Episode title').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value))).toEqual(['Episode 1', 'Episode 2', 'Episode 10'])
  await expect(page.getByRole('button', { name: 'Save Playlist', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Preview', exact: true }).last().click()
  await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.duration)).toBe(240)
  await page.getByRole('button', { name: 'Save Playlist', exact: true }).click()
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect.poll(() => state.shared).toBe(true)
  expect(state.savedItems).toHaveLength(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('admin-openlist-playlist.png') })
  expect(errors).toEqual([])
})

test('Admin can save selected MP4 episodes without entering durations or previewing each file', async ({ page }) => {
  const state = await fixture(page, true)
  await page.goto('/admin/library')
  await page.getByLabel('Playlist title').fill('Animation')
  await page.getByLabel('Provider', { exact: true }).selectOption('provider-1')
  await page.getByRole('button', { name: 'Select listed videos' }).click()
  await page.getByRole('button', { name: 'Add 3 files' }).click()
  await expect(page.getByLabel('Episode title')).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Save Playlist', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Save Playlist', exact: true }).click()
  await expect.poll(() => state.savedItems.length).toBe(3)
  expect(state.savedItems.map(i => i.duration)).toEqual([240, 240, 240])
  expect(state.previewPaths).toHaveLength(3)
  await expect(page.getByLabel('Confirmed duration in minutes')).toHaveCount(0)
  await expect(page.getByLabel('Seconds', { exact: true })).toHaveCount(0)
})

test('Admin sees which episode failed and can retry automatic details without losing the draft', async ({ page }) => {
  const state = await fixture(page, true)
  state.failedPaths.add('/Cartoons/Season 1/Episode 2.mp4')
  await page.goto('/admin/library')
  await page.getByLabel('Playlist title').fill('Animation')
  await page.getByLabel('Provider', { exact: true }).selectOption('provider-1')
  await page.getByRole('button', { name: 'Select listed videos' }).click()
  await page.getByRole('button', { name: 'Add 3 files' }).click()
  const retry = page.getByRole('button', { name: 'Retry reading Episode 2', exact: true })
  await expect(retry).toBeEnabled()
  await expect(page.getByText('Some episodes need attention.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save Playlist', exact: true })).toBeDisabled()
  state.failedPaths.clear()
  await retry.click()
  await expect(page.getByRole('button', { name: 'Save Playlist', exact: true })).toBeEnabled()
  await expect(retry).toHaveCount(0)
  await page.getByRole('button', { name: 'Save Playlist', exact: true }).click()
  await expect.poll(() => state.savedItems.length).toBe(3)
  expect(state.savedItems.map(i => i.duration)).toEqual([240, 240, 240])
  expect(state.previewPaths).toHaveLength(4)
})

test('Admin can remove an unreadable episode and gets a clear missing-title prompt', async ({ page }) => {
  const state = await fixture(page, true)
  state.failedPaths.add('/Cartoons/Season 1/Episode 2.mp4')
  await page.goto('/admin/library')
  await page.getByLabel('Provider', { exact: true }).selectOption('provider-1')
  await page.getByRole('button', { name: 'Select listed videos' }).click()
  await page.getByRole('button', { name: 'Add 3 files' }).click()
  await expect(page.getByRole('button', { name: 'Retry reading Episode 2', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Remove', exact: true }).nth(1).click()
  await expect(page.getByText('Enter a Playlist title to save.', { exact: true })).toBeVisible()
  await page.getByLabel('Playlist title').fill('Animation')
  await page.getByRole('button', { name: 'Save Playlist', exact: true }).click()
  await expect.poll(() => state.savedItems.length).toBe(2)
})

test('Unreadable media shows a recoverable error instead of leaving Save silently disabled', async ({ page }) => {
  await fixture(page, true)
  await page.route('**/fixture-native.mp4', route => route.fulfill({ status: 403, body: 'Download expired' }))
  await page.goto('/admin/library')
  await page.getByLabel('Playlist title').fill('Animation')
  await page.getByLabel('Provider', { exact: true }).selectOption('provider-1')
  await page.getByRole('checkbox', { name: 'Episode 1.mp4', exact: true }).check()
  await page.getByRole('button', { name: 'Add 1 files' }).click()
  await expect(page.getByText('Unable to read this video. Check that Preview works, then retry.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry reading Episode 1', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Save Playlist', exact: true })).toBeDisabled()
})

test('A stalled metadata download times out and releases the editor for retry', async ({ page }) => {
  await fixture(page, true)
  await page.clock.install()
  let release: (() => Promise<void>) | undefined
  await page.route('**/fixture-native.mp4', route => new Promise<void>(resolve => {
    release = async () => { await route.abort(); resolve() }
  }))
  await page.goto('/admin/library')
  await page.getByLabel('Playlist title').fill('Animation')
  await page.getByLabel('Provider', { exact: true }).selectOption('provider-1')
  await page.getByRole('checkbox', { name: 'Episode 1.mp4', exact: true }).check()
  await page.getByRole('button', { name: 'Add 1 files' }).click()
  await expect.poll(() => Boolean(release)).toBe(true)
  await page.clock.fastForward(30_001)
  await expect(page.getByText('Reading video details timed out. Retry to try again.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry reading Episode 1', exact: true })).toBeEnabled()
  await release!()
})

test('Child chooses a season, resumes native playback, selects Next and stops on authoritative denial', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const state = await fixture(page)
  await page.goto('/browse/playlist/9')
  await page.getByRole('combobox').selectOption('Season 2')
  await expect(page.getByText('Episode 1', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Resume at 0:45/)).toBeVisible()
  await page.getByRole('link').filter({ hasText: 'Episode 2' }).click()
  const video = page.locator('video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0)
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(45)
  await video.evaluate((v: HTMLVideoElement) => v.pause())
  await expect.poll(() => state.heartbeats.at(-1)?.state).toBe('paused')
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = 120 })
  await expect.poll(() => state.heartbeats.at(-1)?.positionSeconds).toBe(120)
  expect(state.heartbeats.at(-1)?.state).toBe('paused')
  await page.getByRole('link', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('combobox')).toHaveValue('Season 2')
  await page.getByRole('link').filter({ hasText: 'Episode 2' }).click()
  await page.getByRole('link', { name: 'Next episode · Episode 3' }).click()
  await expect.poll(() => state.authorizations.at(-1)).toBe('ol:episode-3')
  await expect(page.getByRole('heading', { name: 'Episode 3', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('child-native-player.png') })
  state.blocked = true
  await video.evaluate((v: HTMLVideoElement) => { v.pause(); v.dispatchEvent(new Event('pause')) })
  await expect(page.locator('video')).toHaveCount(0)
  await expect(page.getByText('Today’s viewing allowance is used up.', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Admin can cancel or confirm deleting a saved legacy Playlist', async ({ page }) => {
  await fixture(page, true)
  let deleted = false
  await page.route('**/api/admin/library-playlists', route => route.fulfill({ json: { playlists: deleted ? [] : [{ id: 'pl:animation', title: 'testpl1', revision: 1 }] } }))
  await page.route('**/api/admin/library-playlists/pl:animation', route => {
    if (route.request().method() === 'DELETE') {
      expect(route.request().postDataJSON()).toEqual({ revision: 1 })
      deleted = true
      return route.fulfill({ json: { success: true } })
    }
    return route.fulfill({ json: { playlist: { id: 'pl:animation', title: 'testpl1', revision: 1 }, items: [], approvals: [] } })
  })
  await page.goto('/admin/library')
  await page.getByRole('button', { name: 'testpl1', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete Playlist', exact: true }).click()
  expect(deleted).toBe(false)
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('Files on WebDAV are kept'); await dialog.accept() })
  await page.getByRole('button', { name: 'Delete Playlist', exact: true }).click()
  await expect(page.getByText('Playlist deleted. Files on WebDAV were kept.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'testpl1', exact: true })).toHaveCount(0)
  expect(deleted).toBe(true)
})
