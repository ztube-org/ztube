import { expect, test } from '@playwright/test'

test('library separates YouTube and cartoon series and hides legacy WebDAV content', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const video = (videoId: string, videoTitle: string) => ({ videoId, videoTitle, duration: 600, channelTitle: 'Library', videoThumbnail: '/art.svg', isAvailable: true, positionSeconds: 90 })
  const youtube = video('yt1', 'Ocean discovery')
  const episode = { ...video('jf:1:e1', 'S1 E1 · Summer adventure'), season: 'Season 1', position: 0 }
  const lockedEpisode = { ...video('jf:1:e2', 'S1 E2 · A new adventure'), season: 'Season 1', position: 1, positionSeconds: undefined }
  const nextSeasonEpisode = { ...video('jf:1:e3', 'S2 E1 · Mountain adventure'), season: 'Season 2', position: 2, positionSeconds: undefined }
  const legacy = video('ol:1:old', 'Legacy WebDAV episode')
  const playlists = [
    { id: 10, playlistId: 'PLscience', playlistTitle: 'Discover science', isAvailable: true },
    { id: 11, playlistId: 'pl:jf:1:series', playlistTitle: 'Little adventures', cartoonPool: true, isAvailable: true, playlistThumbnail: '/art.svg' },
    { id: 12, playlistId: 'pl:old', playlistTitle: 'Legacy WebDAV playlist', isAvailable: true },
  ]
  const watchTime = { pools: [{ id: 'general', name: 'General videos', remainingSeconds: 3600 }, { id: 'cartoon', name: 'Jellyfin', remainingSeconds: 1800 }, { id: 'learning', name: 'Learning', remainingSeconds: 7200 }] }
  await page.route('**/art.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#355f73"/><circle cx="460" cy="100" r="60" fill="#ffd28a"/><path d="M0 280 Q180 140 350 300T640 240V360H0" fill="#73b3a0"/></svg>' }))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = {}
    if (path === '/api/auth/session') json = { user: { id: 1, email: 'viewer@example.test', displayName: 'Explorer', role: 'non-admin' } }
    else if (path === '/api/child/watch-time') json = { ...watchTime, policy: { blocked: false } }
    else if (path === '/api/child/browse') json = { seriesNavigation: [{ playlistId: 11, seriesTitle: 'Little adventures', previousVideoId: episode.videoId, previousTitle: episode.videoTitle, nextVideoId: 'jf:1:e2', nextTitle: 'S1 E2 · A new adventure' }], channels: [{ id: 1, channelTitle: 'Science', isAvailable: true }], playlists, videos: [], continueWatching: [youtube, episode, legacy], favorites: [], recommendations: [], favoriteVideoIds: [], watchTime, policy: { blocked: false } }
    else if (path === '/api/child/cartoon-pool') json = { dailyLimit: 1, remaining: 1, claimedVideoIds: [], claimedVideos: [], videos: [episode, legacy], nextPage: null, timePools: [watchTime.pools[1]] }
    else if (path === '/api/child/playlist/11/videos') json = { playlist: { id: 11, title: 'Little adventures', curated: true }, videos: [{ ...episode, requiresClaim: true }, { ...lockedEpisode, requiresClaim: true }, { ...nextSeasonEpisode, requiresClaim: true }], favoriteVideoIds: [], unlockedVideoIds: [episode.videoId], nextPage: null, watchTime, policy: { blocked: false } }
    await route.fulfill({ json })
  })
  await page.goto('/browse')
  const nav = page.getByRole('navigation', { name: 'Library sections' })
  await expect(nav.getByRole('link', { name: 'YouTube' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'Ocean discovery', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'S1 E1 · Summer adventure', exact: true })).toHaveCount(0)
  await expect(page.getByText(/Legacy WebDAV/)).toHaveCount(0)
  await expect(page.getByText('Cartoon Pool', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('library-ipad-portrait.png'), fullPage: true })
  await nav.getByRole('link', { name: 'YouTube' }).click()
  await expect(page.getByRole('link', { name: 'Ocean discovery', exact: true })).toBeVisible()
  await expect(page.getByText('Little adventures')).toHaveCount(0)
  await expect(page.getByText('S1 E1 · Summer adventure')).toHaveCount(0)
  await nav.getByRole('link', { name: 'Jellyfin' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a series' })).toBeVisible()
  await expect(page.getByText('Next: S1 E2 · A new adventure')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pick your next episode' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Choose an episode' })).toHaveCount(0)
  await expect(page.getByText(/Legacy WebDAV/)).toHaveCount(0)
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.screenshot({ path: testInfo.outputPath('cartoons-ipad-landscape.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('textbox').fill('Little')
  await expect(page.getByRole('link', { name: /Little adventures/ })).toBeVisible()
  await page.getByRole('link', { name: /Little adventures/ }).click()
  await expect(page.getByRole('heading', { name: 'Little adventures' })).toBeVisible()
  await expect(page.getByRole('combobox')).toBeVisible()
  await expect(page.getByRole('combobox')).toHaveValue('Season 1')
  await expect(page.getByRole('option', { name: 'All seasons' })).toHaveCount(0)
  await expect(page.getByText('S2 E1 · Mountain adventure', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Unlocked', { exact: true })).toBeVisible()
  await expect(page.getByText('1 credit to unlock', { exact: true })).toBeVisible()
  await page.getByRole('combobox').selectOption('Season 2')
  await expect(page.getByText('S2 E1 · Mountain adventure', { exact: true })).toBeVisible()
  await expect(page.getByText('S1 E1 · Summer adventure', { exact: true })).toHaveCount(1)
  await page.getByRole('combobox').selectOption('Season 1')
  await expect(page.getByRole('region', { name: 'Choose what to watch next' }).getByRole('link', { name: /Next episode/ })).toHaveAttribute('href', /v=jf:1:e2/)
  await expect(page.getByRole('link', { name: /Summer adventure/ }).last()).toHaveAttribute('href', /watch\?v=jf:1:e1&playlist=11/)
  await page.screenshot({ path: testInfo.outputPath('series-episodes-ipad.png'), fullPage: true })
  await page.getByRole('link', { name: 'Back to Jellyfin' }).click()
  await expect(nav.getByRole('link', { name: 'Jellyfin' })).toHaveAttribute('aria-current', 'page')
  expect(errors).toEqual([])
})
