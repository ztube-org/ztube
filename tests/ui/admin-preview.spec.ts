import { test, expect } from '@playwright/test'

test('Admin can inspect a Child library and source without switching profiles or starting playback', async ({ page }) => {
  const writes: string[] = []
  const video = { videoId: 'approved-video', videoTitle: 'Approved video', videoThumbnail: null, channelTitle: 'Science', duration: 600, contentRule: 'restricted', isAvailable: true, publishedAt: null, tags: [] }
  const status = { watchTime: { restricted: { remainingSeconds: 1800, locked: false }, exempt: { remainingSeconds: 3600, locked: false }, pools: [] }, policy: { blocked: false, reason: null } }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') writes.push(path)
    let response: unknown = {}
    if (path === '/api/auth/session') response = { user: { id: 1, email: 'admin@example.com', displayName: 'Admin', avatarUrl: null, role: 'admin' } }
    else if (path === '/api/child/recommendations/count') response = { count: 0 }
    else if (path === '/api/admin/children') response = { children: [{ id: 2, displayName: 'Mina', email: 'mina@example.com', stats: { channels: 1, playlists: 0, videos: 1 } }] }
    else if (path === '/api/admin/children/2/content') response = { child: { id: 2, displayName: 'Mina', email: 'mina@example.com' }, channels: [], playlists: [], videos: [] }
    else if (path === '/api/admin/children/2/preview') response = { ...status, channels: [{ id: 50, channelTitle: 'Science', channelThumbnail: null, tags: [] }], playlists: [], videos: [video], recommendations: [], favorites: [], continueWatching: [], favoriteVideoIds: [] }
    else if (path === '/api/admin/children/2/preview/channel/50') response = { ...status, channel: { id: 50, title: 'Science', thumbnail: null, tags: [] }, videos: [video], favoriteVideoIds: [], nextPage: null }
    await route.fulfill({ json: response })
  })
  await page.goto('/admin', { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Preview viewer' }).click()
  await expect(page.getByText('Viewer preview · Mina')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible()
  await expect(page.getByRole('paragraph').filter({ hasText: 'Approved video' })).toBeVisible()
  await page.getByRole('link', { name: 'Science' }).click()
  await expect(page.getByRole('heading', { name: 'Science' })).toBeVisible()
  await expect(page.getByRole('paragraph').filter({ hasText: 'Approved video' })).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/admin/child/2/preview')
  expect(writes).toEqual([])
  await expect(page.locator('a[href^="/watch"]')).toHaveCount(0)
})
