import { test, expect, type Page } from '@playwright/test'

const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)) })
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]) })

const video = (i: number) => ({ videoId: `video-${i}`, videoTitle: i === 59 ? 'Deep ocean discovery' : `Science experiment ${i}`, videoThumbnail: '/fixture-thumbnail.svg', duration: 600, channelTitle: 'Science', publishedAt: null, contentRule: 'restricted', isAvailable: true, positionSeconds: 100, tags: ['Science'] })
const videos = Array.from({ length: 60 }, (_, i) => video(i))
async function fixture(page: Page) {
  const state = { failBrowse: false, failFavorite: false, failSource: false, emptySearchPage: false, blocked: false, favorites: ['video-0'], heartbeats: [] as Array<{ state: string; positionSeconds: number }>, breakUntil: null as string | null }
  const watchTime = { restricted: { remainingSeconds: 1800, locked: false }, exempt: { remainingSeconds: 3600, locked: false } }
  const policy = () => ({ blocked: state.blocked, reason: state.blocked ? 'required-break' : null, breakUntil: state.breakUntil })
  const source = { id: 1, title: 'Science', thumbnail: '/fixture-thumbnail.svg', tags: ['Science'], contentRule: 'restricted', isAvailable: true }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let response: unknown = {}
    if (url.pathname === '/api/auth/session') response = { user: { id: 1, email: 'child@example.test', displayName: 'Explorer', avatarUrl: null, role: 'non-admin' } }
    else if (url.pathname === '/api/child/recommendations/count') response = { count: 3 }
    else if (url.pathname === '/api/child/watch-time') response = { ...watchTime, policy: policy() }
    else if (url.pathname === '/api/child/browse') {
      if (state.failBrowse) return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } })
      response = { channels: [{ ...source, channelTitle: 'Science', channelThumbnail: source.thumbnail }], playlists: [], videos: videos.slice(0, 6), recommendations: videos.slice(1, 4), recommendationCount: 3, continueWatching: videos.slice(4, 7), favorites: videos.filter(v => state.favorites.includes(v.videoId)), favoriteVideoIds: state.favorites, watchTime, policy: policy() }
    } else if (url.pathname.endsWith('/videos') || url.pathname === '/api/child/search') {
      if (state.failSource && url.pathname.endsWith('/videos')) return route.fulfill({ status: 503, json: { message: 'Unable to search videos' } })
      const query = (url.searchParams.get('q') ?? '').toLowerCase()
      const matches = videos.filter(v => v.videoTitle.toLowerCase().includes(query))
      const offset = Number(url.searchParams.get('page') ?? 0) * 50
      if (state.emptySearchPage && url.pathname === '/api/child/search') return route.fulfill({ json: { videos: offset ? [video(59)] : [], nextPage: offset ? null : 1, favoriteVideoIds: state.favorites, watchTime, policy: policy() } })
      response = { channel: source, videos: matches.slice(offset, offset + 50), nextPage: offset + 50 < matches.length ? offset / 50 + 1 : null, favoriteVideoIds: state.favorites, watchTime, policy: policy() }
    } else if (url.pathname.startsWith('/api/child/favorites')) {
      if (state.failFavorite) return route.fulfill({ status: 503, json: { message: 'Unable to save Favorite' } })
      if (route.request().method() === 'DELETE') state.favorites = state.favorites.filter(id => id !== url.pathname.split('/').at(-1))
      else state.favorites.push(route.request().postDataJSON().videoId)
      response = { success: true }
    } else if (url.pathname === '/api/child/playback-authorizations') {
      const id = route.request().postDataJSON().videoId
      response = { authorization: { sessionId: id, remainingSeconds: 1800, usageBucket: 'restricted', resumeAt: 45, favorite: state.favorites.includes(id), videoTitle: videos.find(v => v.videoId === id)?.videoTitle, videoDescription: 'Introduction.\n\nChapter one.\n\nChapter two.\n\nThe last chapter.', channelTitle: 'Science' } }
    } else if (url.pathname.endsWith('/heartbeats')) {
      const payload = route.request().postDataJSON()
      state.heartbeats.push(payload)
      response = { sequence: payload.sequence, authorized: true, remainingSeconds: 1800 }
    }
    await route.fulfill({ json: response })
  })
  await page.route('**/fixture-thumbnail.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#385975"/><circle cx="450" cy="110" r="75" fill="#d6aa63"/></svg>' }))
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#152334;color:white;display:grid;place-items:center;height:100vh">Sample player<script>addEventListener("message", () => parent.postMessage(JSON.stringify({event:"initialDelivery",info:{currentTime:45,playerState:1}}),"*"))</script>' }))
  return state
}

test('iPad rotation enlarges the player and related videos can be expanded and paged', async ({ page }, testInfo) => {
  await fixture(page)
  await page.setViewportSize({ width: 768, height: 1024 })
  await page.goto('/watch?v=video-0&channel=1', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Science experiment 0', exact: true })).toBeVisible()
  const portrait = (await page.locator('.zt-watch-player').boundingBox())!.width
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect.poll(async () => (await page.locator('.zt-watch-player').boundingBox())!.width).toBeGreaterThan(portrait)
  expect((await page.locator('.zt-watch-player').boundingBox())!.width).toBeGreaterThan(960)
  await expect(page.getByRole('complementary')).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('ipad-landscape.png'), timeout: 5000 })
  await page.getByRole('button', { name: 'Show channel videos' }).click()
  await expect(page.getByRole('complementary')).toBeVisible()
  await page.getByRole('button', { name: 'Load more videos' }).click()
  await expect(page.getByRole('complementary').getByText('Deep ocean discovery')).toBeVisible()
  await page.getByText('Description', { exact: true }).click()
  await expect(page.getByText(/The last chapter/)).toBeVisible()
})

test('home prioritizes Continue Watching, keeps recommendations in one row, and preserves touch targets', async ({ page }, testInfo) => {
  await fixture(page)
  await page.goto('/browse', { waitUntil: 'domcontentloaded' })
  for (const [width, height] of [[768, 1024], [820, 1180], [1024, 768], [1180, 820], [512, 768]]) {
    await page.setViewportSize({ width, height })
    const continuation = page.getByRole('heading', { name: 'Continue Watching' })
    await expect(continuation).toBeVisible()
    const recommendation = page.getByRole('heading', { name: 'New for You' })
    expect((await continuation.boundingBox())!.y).toBeLessThan((await recommendation.boundingBox())!.y)
    const recommendationCards = page.locator('section').filter({ has: recommendation }).locator('article')
    const tops = await recommendationCards.evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top))
    expect(new Set(tops).size).toBe(1)
    const undersized = await page.getByRole('button').evaluateAll(buttons => buttons.filter(button => {
      const box = button.getBoundingClientRect()
      return box.width && box.height && (box.width < 44 || box.height < 44)
    }).map(button => button.getAttribute('aria-label') || button.textContent))
    expect(undersized).toEqual([])
    if (width === 768) await page.screenshot({ path: testInfo.outputPath('ipad-home.png'), timeout: 5000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('browse distinguishes failed loading, successful retry, and empty search results', async ({ page }) => {
  const state = await fixture(page)
  state.failBrowse = true
  await page.goto('/browse', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('alert')).toContainText('Temporarily unavailable')
  await expect(page.getByText('No content yet!')).toHaveCount(0)
  state.failBrowse = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search your videos, channels, or tags' }).fill('absentword')
  await expect(page.getByText('No content matches this search.', { exact: false })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'New for You' })).toHaveCount(0)
  await page.getByRole('textbox').fill('ocean')
  await expect(page.getByRole('link', { name: 'Deep ocean discovery', exact: true })).toBeVisible()
})

test('returning from playback retains source search, loaded pages and scroll position', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/browse/channel/1', { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox').fill('Science')
  await expect(page.locator('article')).toHaveCount(50)
  await page.getByRole('button', { name: 'Load more videos' }).click()
  await expect(page.locator('article')).toHaveCount(59)
  const target = page.getByRole('link', { name: 'Science experiment 57', exact: true })
  await target.scrollIntoViewIfNeeded()
  const scroll = await page.evaluate(() => scrollY)
  await target.click()
  await expect.poll(() => state.heartbeats.length).toBeGreaterThan(0)
  await page.getByRole('link', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveValue('Science')
  await expect(page.locator('article')).toHaveCount(59)
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0)
  expect(state.heartbeats.at(-1)?.state).toBe('paused')
  expect(state.heartbeats.at(-1)?.positionSeconds).toBe(45)
})

test('viewing status refreshes after returning to the foreground and when a break expires', async ({ page }) => {
  const state = await fixture(page)
  state.blocked = true
  state.breakUntil = new Date(Date.now() + 60_000).toISOString()
  await page.goto('/browse/channel/1', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(/Time for a break/)).toBeVisible()
  state.blocked = false
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('30 min Daily Allowance left')).toBeVisible()
  state.blocked = true
  state.breakUntil = new Date(Date.now() + 1800).toISOString()
  await page.getByRole('button', { name: 'Refresh viewing time' }).click()
  await expect(page.getByText(/Time for a break/)).toBeVisible()
  state.blocked = false
  await expect(page.getByText('30 min Daily Allowance left')).toBeVisible({ timeout: 5000 })
})

test('Favorite controls do not navigate, and failed mutations remain actionable', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/browse/channel/1', { waitUntil: 'domcontentloaded' })
  const favorite = page.getByRole('button', { name: 'Add Science experiment 1 to Favorites', exact: true })
  state.failFavorite = true
  await favorite.click()
  await expect(page.getByRole('alert')).toContainText('Unable to save Favorite')
  expect(page.url()).toContain('/browse/channel/1')
  state.failFavorite = false
  await favorite.click()
  await expect(page.getByRole('button', { name: 'Remove Science experiment 1 from Favorites', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Back to browse' }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.locator('#favorites').getByRole('button', { name: 'Remove Science experiment 1 from Favorites', exact: true }).click()
  expect(state.favorites).toContain('video-1')
})

test('a failed new source search cannot display or paginate results from the previous query', async ({ page }) => {
  const state = await fixture(page)
  await page.goto('/browse/channel/1', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('article')).toHaveCount(50)
  state.failSource = true
  await page.getByRole('textbox').fill('ocean')
  await expect(page.getByRole('alert')).toContainText('Unable to search videos')
  await expect(page.locator('article')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Load more videos' })).toHaveCount(0)
  state.failSource = false
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Deep ocean discovery', exact: true })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(1)
})

test('an empty resolved search page still exposes the next page', async ({ page }) => {
  const state = await fixture(page)
  state.emptySearchPage = true
  await page.goto('/browse', { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox').fill('ocean')
  await page.getByRole('button', { name: 'Load more results' }).click()
  await expect(page.getByRole('link', { name: 'Deep ocean discovery', exact: true })).toBeVisible()
})

test('unavailable videos prevent navigation while their separate Favorite control remains usable', async ({ page }) => {
  const state = await fixture(page)
  state.blocked = true
  state.breakUntil = new Date(Date.now() + 60_000).toISOString()
  await page.goto('/browse/channel/1', { waitUntil: 'domcontentloaded' })
  const link = page.getByRole('link', { name: 'Science experiment 1: Playback is unavailable right now', exact: true })
  await expect(link).toHaveAttribute('aria-disabled', 'true')
  await link.click({ force: true })
  expect(page.url()).toContain('/browse/channel/1')
  expect(state.heartbeats).toEqual([])
  await page.getByRole('button', { name: 'Add Science experiment 1 to Favorites', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove Science experiment 1 from Favorites', exact: true })).toBeVisible()
})
