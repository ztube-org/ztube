import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  const videos = [1, 2, 3].map(n => ({ videoId: `jf:ep${n}`, videoTitle: `Cartoon episode ${n}`, duration: 600, videoThumbnail: null, channelTitle: 'Cartoons', contentRule: 'restricted', usageBucket: 'cartoon', publishedAt: null }))
  const state = { bonusCredits: 0, positionSeconds: 0, day: '2026-09-17', unlocks: [] as string[], claims: [] as string[], confirmations: [] as unknown[], players: [] as string[], failClaim: false, loseResponse: false }
  const status = () => ({ viewingDay: state.day, dailyLimit: 1, bonusCredits: state.bonusCredits, totalCredits: 1 + state.bonusCredits, remaining: Math.max(0, 1 + state.bonusCredits - state.claims.length), claimedVideoIds: state.claims, unlockedVideoIds: state.unlocks })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = () => route.request().postDataJSON()
    let result: unknown = {}
    if (path === '/api/auth/session') result = { user: { id: 1, email: 'child@example.com', displayName: 'Explorer', role: 'non-admin' } }
    else if (path === '/api/child/recommendations/count') result = { count: 0 }
    else if (path === '/api/child/browse') result = { playlists: state.positionSeconds ? [{ id: 10, playlistId: 'pl:jf:series', playlistTitle: 'Cartoons' }] : [], continueWatching: state.positionSeconds ? [{ ...videos[0], positionSeconds: state.positionSeconds }] : [] }
    else if (path === '/api/child/cartoon-pool') result = { ...status(), cartoonTime: { usedSeconds: 0, remainingSeconds: 1800, allowanceMinutes: 30, locked: false }, videos: new URL(route.request().url()).searchParams.get('unlocked') === '1' ? videos.filter(v => state.unlocks.includes(v.videoId)) : videos, claimedVideos: videos.filter(v => state.claims.includes(v.videoId)), nextPage: null }
    else if (path === '/api/child/episode-claims') {
      state.confirmations.push(body())
      if (state.failClaim) return route.fulfill({ status: 503, json: { message: 'Unable to save your choice. Try again.' } })
      if (body().viewingDay !== state.day) return route.fulfill({ status: 409, json: { message: 'A new viewing day has started. Confirm your choice again.' } })
      if (!state.unlocks.includes(body().videoId)) { state.claims.push(body().videoId); state.unlocks.push(body().videoId) }
      if (state.loseResponse) return route.abort('failed')
      result = status()
    } else if (path === '/api/child/playback-authorizations') {
      const id = body().videoId
      if (!state.unlocks.includes(id)) return route.fulfill({ status: 409, json: { code: 'episode-claim-required', message: 'Confirm your episode claim before watching.', claim: { ...status(), positionSeconds: state.positionSeconds, duration: 600, videoTitle: videos.find(v => v.videoId === id)!.videoTitle } } })
      state.players.push(id)
      result = { authorization: { sessionId: id, playerKind: 'youtube', remainingSeconds: 1800, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), usageBucket: 'cartoon', resumeAt: 0, videoTitle: videos.find(v => v.videoId === id)!.videoTitle, channelTitle: 'Cartoons' } }
    } else if (path.endsWith('/heartbeats')) result = { sequence: body().sequence, authorized: true, remainingSeconds: 1800 }
    await route.fulfill({ json: result })
  })
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<body>Player<script>addEventListener("message", () => parent.postMessage(JSON.stringify({event:"initialDelivery",info:{currentTime:0,playerState:2}}),"*"))</script></body>' }))
  return state
}

test('Child browses freely, cancels without spending a claim, then confirms one episode and cannot claim another', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const state = await fixture(page)
  await page.goto('/cartoon-pool')
  await expect(page.getByText('30 min left')).toBeVisible()
  await expect(page.getByText('1 of 1 unlock credits left today')).toBeVisible()
  await page.getByRole('link', { name: 'Cartoon episode 2', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Cartoon episode 2')).toBeVisible()
  expect(state.confirmations).toEqual([])
  expect(state.players).toEqual([])
  await expect(page.locator('iframe')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Back to Jellyfin' }).click()
  await expect(page.getByText('1 of 1 unlock credits left today')).toBeVisible()
  expect(state.confirmations).toEqual([])
  await page.getByRole('link', { name: 'Cartoon episode 1', exact: true }).click()
  await expect(dialog).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('episode-claim-confirmation.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  await expect(page.getByText('30:00 Cartoon Time remaining')).toBeVisible()
  expect(state.confirmations).toEqual([{ videoId: 'jf:ep1', confirmed: true, viewingDay: '2026-09-17' }])
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  await expect(dialog).toHaveCount(0)
  expect(state.confirmations).toHaveLength(1)
  await page.goto('/cartoon-pool')
  await page.getByRole('button', { name: 'Unlocked', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cartoon episode 2', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Cartoon episode 3', exact: true })).toHaveCount(0)
  await expect(page.getByText('0 of 1 unlock credits left today')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('cartoon-pool.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto('/watch?v=jf:ep3')
  await expect(dialog.getByText(/Today’s unlock credits are used up/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Unlock episode', exact: true })).toHaveCount(0)
  expect(state.players).not.toContain('jf:ep3')
  expect(errors).toEqual([])
})

test('failed claims remain reviewable and a midnight rollover requires a fresh confirmation', async ({ page }) => {
  const state = await fixture(page)
  state.failClaim = true
  await page.goto('/watch?v=jf:ep1')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Unable to save your choice')
  expect(state.players).toEqual([])
  state.failClaim = false
  state.day = '2026-09-18'
  await dialog.getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('A new viewing day')
  expect(state.claims).toEqual([])
  await dialog.getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  expect(state.confirmations.at(-1)).toEqual({ videoId: 'jf:ep1', confirmed: true, viewingDay: '2026-09-18' })
})

test('a lost claim response recovers the saved choice without claiming again or leaving the dialog over playback', async ({ page }) => {
  const state = await fixture(page)
  state.loseResponse = true
  await page.goto('/watch?v=jf:ep1')
  await page.getByRole('dialog').getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.confirmations).toHaveLength(1)
  expect(state.claims).toEqual(['jf:ep1'])
})


test('an episode stays unlocked tomorrow while a fresh daily credit can unlock the next episode', async ({ page }, testInfo) => {
  const state = await fixture(page)
  await page.goto('/watch?v=jf:ep1')
  await page.getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  state.day = '2026-09-18'; state.claims = []
  await page.goto('/cartoon-pool')
  await expect(page.getByText('1 of 1 unlock credits left today')).toBeVisible()
  await page.getByRole('button', { name: 'Unlocked', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cartoon episode 2', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Cartoon episode 3', exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('unlocked-library.png') })
  await page.getByRole('link', { name: 'Cartoon episode 1', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cartoon episode 1', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.claims).toEqual([])
  expect(state.confirmations).toHaveLength(1)
  await page.goto('/watch?v=jf:ep2')
  await expect(page.getByRole('dialog')).toContainText('This episode stays unlocked')
  await page.getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cartoon episode 2', exact: true })).toBeVisible()
  expect(state.claims).toEqual(['jf:ep2'])
  expect(state.unlocks).toEqual(['jf:ep1', 'jf:ep2'])
})


test('loading another episode page preserves permanent unlock labels from earlier pages', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/child/cartoon-pool?*', async route => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('page'))
    const videoId = `jf:page${pageNumber}`
    await route.fulfill({ json: {
      viewingDay: '2026-09-17', dailyLimit: 1, totalCredits: 1, remaining: 0,
      claimedVideoIds: [], unlockedVideoIds: [videoId],
      videos: [{ videoId, videoTitle: `Unlocked page ${pageNumber}`, duration: 600, channelTitle: 'Cartoons' }],
      nextPage: pageNumber === 0 ? 1 : null,
    } })
  })
  await page.goto('/cartoon-pool')
  await expect(page.getByText('Unlocked · No credit needed', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: 'Load more episodes' }).click()
  await expect(page.getByRole('link', { name: 'Unlocked page 0', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Unlocked page 1', exact: true })).toBeVisible()
  await expect(page.getByText('Unlocked · No credit needed', { exact: true })).toHaveCount(2)
  await expect(page.getByText('More credits tomorrow', { exact: true })).toHaveCount(0)
})

test('a temporary Admin credit appears in the Child balance and permits another unlock', async ({ page }) => {
  const state = await fixture(page)
  state.claims.push('jf:ep1'); state.unlocks.push('jf:ep1')
  await page.goto('/cartoon-pool')
  await expect(page.getByText('0 of 1 unlock credits left today')).toBeVisible()
  state.bonusCredits = 1
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByText('1 of 2 unlock credits left today')).toBeVisible()
  await page.goto('/watch?v=jf:ep2')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('1 of 2 unlock credits left today')
  await dialog.getByRole('button', { name: 'Unlock episode', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(state.unlocks).toEqual(['jf:ep1', 'jf:ep2'])
})
