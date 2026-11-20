import { expect, test } from '@playwright/test'
import type { TimePoolStatus, TimePoolBinding } from '../../src/domain'
import type { PlaybackViewingEvent, ViewingEvent } from '../../src/viewing-events'

test('Admin edits independent time pools, binds content and saves daily unlock credits', async ({ page }, testInfo) => {
  const makePool = (key: 'restricted' | 'cartoon' | 'exempt', name: string, minutes: number, used: number): TimePoolStatus => ({ id: `pool:1:${key}`, legacyKey: key, name, weekdayMinutes: minutes, weekendMinutes: minutes, requiresClaim: key === 'cartoon', usedSeconds: used * 60, remainingSeconds: (minutes - used) * 60, allowanceMinutes: minutes, extensionMinutes: 0, unlocked: false, locked: false })
  const pools = [makePool('restricted', 'General videos', 60, 18), makePool('cartoon', 'Cartoons', 30, 12), makePool('exempt', 'Learning', 180, 25)]
  let tags = ['Stories']
  let tagWrites = 0
  let paused = false
  let confirmedReductions = 0
  const bindings: TimePoolBinding[] = [{ kind: 'channel', contentId: 'science', poolId: 'pool:1:exempt' }]
  const grantIds = new Set<string>()
  let loseGrantResponse = true
  let cartoon = { dailyLimit: 1, timePoolId: 'pool:1:cartoon', playlistIds: [10, 12] }
  const settings = { timeZone: 'America/Los_Angeles', weekdayAllowanceMinutes: 60, weekendAllowanceMinutes: 60, safetyCapMinutes: 180, allowedStartMinute: 480, allowedEndMinute: 1200, breakAfterMinutes: 30, breakDurationMinutes: 10 }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname)
    const method = route.request().method()
    const child = { id: 1, email: 'preview@example.com', displayName: 'Explorer', role: 'admin' }
    let body: unknown = {}
    if (path === '/api/auth/session') body = { user: child }
    else if (path === '/api/admin/children') body = { children: [child] }
    else if (path.endsWith('/content')) body = { child, channels: [
      { id: 1, channelId: 'stories', channelTitle: 'Weekend stories', isAvailable: true, contentRule: 'restricted', tags },
      { id: 2, channelId: 'science', channelTitle: 'Science for kids', isAvailable: true, contentRule: 'restricted', tags: ['Science', 'Learning'] },
    ], playlists: [{ id: 10, playlistId: 'adventure', playlistTitle: 'Adventure cartoons', isAvailable: true }, { id: 11, playlistId: 'animals', playlistTitle: 'Animal cartoons', isAvailable: true }, { id: 12, playlistId: 'pl:jf:import', playlistTitle: 'Imported series', isAvailable: true }], videos: [], videoRules: [] }
    else if (path.endsWith('/content/channel/1/tags')) {
      tags = route.request().postDataJSON().tags
      tagWrites++
    } else if (path.endsWith('/time-pools')) {
      if (method === 'POST') {
        const input = route.request().postDataJSON()
        const pool = { ...makePool('restricted', input.name, input.weekdayMinutes, 0), ...input, legacyKey: null, id: 'new-pool' }
        pools.push(pool)
        body = { pool }
      } else body = { pools, bindings, viewingDay: '2026-09-17' }
    }
    else if (path.includes('/time-pools/')) {
      const pool = pools.find(pool => path.includes(pool.id))!
      if (path.endsWith('/extensions')) { const minutes = route.request().postDataJSON().minutes; pool.extensionMinutes += minutes; pool.remainingSeconds += minutes * 60 }
      else if (method === 'PUT') Object.assign(pool, route.request().postDataJSON())
      body = { pool }
    } else if (path.endsWith('/time-pool-bindings')) {
      const binding = route.request().postDataJSON() as TimePoolBinding
      const index = bindings.findIndex(item => item.kind === binding.kind && item.contentId === binding.contentId)
      if (index >= 0) bindings.splice(index, 1)
      bindings.push(binding)
      body = { success: true }
    } else if (path.endsWith('/unlock-credits')) {
      if (method === 'POST') {
        const grant = route.request().postDataJSON()
        expect(grant.viewingDay).toBe('2026-09-17')
        grantIds.add(grant.requestId)
        if (loseGrantResponse) { loseGrantResponse = false; return route.fulfill({ status: 503, json: { message: 'Response interrupted. Retry safely.' } }) }
      }
      body = { viewingDay: '2026-09-17', dailyLimit: cartoon.dailyLimit, bonusCredits: grantIds.size, totalCredits: cartoon.dailyLimit + grantIds.size, remaining: cartoon.dailyLimit + grantIds.size - 1, claimedVideoIds: ['ep1'] }
    } else if (path.endsWith('/cartoon-pool')) {
      if (method === 'PUT') cartoon = route.request().postDataJSON()
      body = cartoon
    } else if (path.endsWith('/time-settings')) {
      if (method === 'PUT') {
        if (!route.request().postDataJSON().confirmReduction) {
          return route.fulfill({ status: 409, json: { message: 'Current usage meets the proposed allowance.', requiresConfirmation: true } })
        }
        confirmedReductions++
      }
      body = { settings, viewingDay: { localDate: '2026-09-17', isWeekend: false, allowanceMinutes: settings.weekdayAllowanceMinutes } }
    }
    else if (path.endsWith('/watch-time/viewing-pause')) paused = route.request().postDataJSON().paused
    else if (path.endsWith('/watch-time')) body = { viewingDay: '2026-09-17', restricted: { usedMinutes: 18, remainingMinutes: 42 }, exempt: { usedMinutes: 25, remainingMinutes: 155 }, policy: { blocked: paused, reason: paused ? 'viewing-pause' : null, breakCycleRemainingSeconds: 1200 } }
    else if (path.endsWith('/usage')) body = { days: [] }
    else if (path.endsWith('/viewing-events')) body = { events: [], nextCursor: null, timeZone: settings.timeZone }
    await route.fulfill({ json: body })
  })
  await page.goto('/admin/child/1/manage')
  await expect(page.getByRole('article', { name: 'Cartoons time pool' })).toBeVisible()
  await expect(page.locator('a[href="/admin/library"]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('child-settings-overview.png'), fullPage: true })
  const viewingToday = page.getByRole('region', { name: 'Viewing today' })
  const todayCredits = page.getByRole('region', { name: 'Today’s unlock credits' })
  for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(size)
    const left = (await viewingToday.boundingBox())!
    const right = (await todayCredits.boundingBox())!
    expect(left.y).toBeCloseTo(right.y, 0)
    expect(right.x).toBeGreaterThan(left.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 820, height: 1180 })
  await viewingToday.getByRole('button', { name: 'Pause viewing today' }).tap()
  await expect(viewingToday.getByRole('status')).toHaveText('Paused')
  await viewingToday.getByRole('button', { name: 'Resume viewing' }).tap()
  await expect(viewingToday.getByRole('status')).toHaveText('Viewing allowed')
  await todayCredits.getByRole('button', { name: 'Edit unlock rules' }).click()
  await expect(page.getByRole('combobox', { name: 'Time pool for the cartoon library' })).toContainText('Cartoons')
  const poolSection = page.getByRole('region', { name: 'Time pools', exact: true })
  await poolSection.scrollIntoViewIfNeeded()
  await page.evaluate(() => { const el = document.querySelector('[aria-label="Time pools"]')!; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 76) })
  await page.screenshot({ path: testInfo.outputPath('time-pools-ipad.png') })
  await page.getByRole('tab', { name: 'Content', exact: true }).click()
  await page.getByText('Viewing time for approved content', { exact: true }).scrollIntoViewIfNeeded()
  await page.evaluate(() => { const el = [...document.querySelectorAll('p')].find(el => el.textContent === 'Viewing time for approved content')!; window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96) })
  await page.screenshot({ path: testInfo.outputPath('content-bindings-ipad.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const tagsButton = page.getByRole('button', { name: 'Tags', exact: true }).first()
  await tagsButton.click()
  const tagDialog = page.getByRole('dialog', { name: 'Edit tags' })
  await tagDialog.getByRole('button', { name: 'Learning' }).click()
  await tagDialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(tagDialog).toBeHidden()
  expect(tagWrites).toBe(0)
  await tagsButton.click()
  await expect(tagDialog.getByRole('button', { name: 'Stories', pressed: true })).toBeVisible()
  await tagDialog.getByRole('button', { name: 'Stories' }).click()
  await tagDialog.getByRole('button', { name: 'Science' }).click()
  await tagDialog.getByLabel('New tag').fill('a'.repeat(25))
  await tagDialog.getByRole('button', { name: 'Add tag' }).click()
  await expect(tagDialog.getByRole('alert')).toContainText('24 characters or fewer')
  await tagDialog.getByLabel('New tag').fill('  Space  ')
  await tagDialog.getByRole('button', { name: 'Add tag' }).click()
  await tagDialog.getByLabel('New tag').fill('Space')
  await tagDialog.getByRole('button', { name: 'Save tags' }).click()
  await expect(tagDialog).toBeHidden()
  expect(tags).toEqual(['Science', 'Space'])
  await expect(page.locator('.zt-toast-viewport').getByText('Tags saved.', { exact: true })).toBeVisible()
  await page.getByLabel('Time pool for Weekend stories').click()
  await page.getByRole('option', { name: 'Learning', exact: true }).click()
  await expect(page.getByLabel('Time pool for Weekend stories')).toContainText('Learning')
  expect(bindings).toContainEqual({ kind: 'channel', contentId: 'stories', poolId: 'pool:1:exempt' })
  await page.getByRole('tab', { name: 'Time & limits', exact: true }).click()
  const general = page.getByRole('article', { name: 'General videos time pool' })
  const learning = page.getByRole('article', { name: 'Learning time pool' })
  const editor = page.getByRole('dialog', { name: 'Edit time pool' })
  await learning.getByRole('button', { name: 'Edit Learning' }).click()
  await editor.getByLabel('Weekday minutes').fill('200')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await expect(learning.getByRole('button', { name: 'Edit Learning' })).toBeFocused()
  await general.getByRole('button', { name: 'Edit General videos' }).click()
  await expect(editor.getByLabel('Pool name')).toBeFocused()
  await editor.getByLabel('Weekday minutes').fill('50')
  await editor.getByRole('button', { name: 'Save pool', exact: true }).click()
  await expect(poolSection.getByRole('status')).toContainText('General videos saved.')
  await learning.getByRole('button', { name: 'Edit Learning' }).click()
  await expect(editor.getByLabel('Weekday minutes')).toHaveValue('180')
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await poolSection.getByRole('button', { name: 'Add time pool', exact: true }).click()
  const adding = page.getByRole('dialog', { name: 'Add time pool' })
  await adding.getByLabel('Pool name').fill('Music')
  await adding.getByLabel('Weekend minutes').fill('45')
  await adding.getByRole('checkbox', { name: 'Unlock required before first play' }).check()
  await adding.getByRole('button', { name: 'Add time pool', exact: true }).click()
  await expect(poolSection.getByRole('article', { name: 'Music time pool' })).toBeVisible()
  await expect(poolSection.getByRole('status')).toContainText('Music added.')
  expect(pools.at(-1)).toMatchObject({ name: 'Music', weekdayMinutes: 30, weekendMinutes: 45, requiresClaim: true })
  await general.getByRole('button', { name: 'Add 15 minutes to General videos today' }).click()
  await expect(general).toContainText('+15 min today')
  expect(pools[1]!.extensionMinutes).toBe(0)
  expect(pools[2]!.extensionMinutes).toBe(0)
  await page.getByRole('combobox', { name: 'Unlock credits per day' }).click()
  await page.getByRole('option', { name: '2 credits' }).click()
  await expect(todayCredits).toContainText('0 of 1 left · 0 extra granted')
  await todayCredits.getByRole('button', { name: 'Add 1 credit today' }).click()
  await expect(todayCredits.getByRole('alert')).toContainText('Response interrupted')
  await todayCredits.getByRole('button', { name: 'Retry granting 1 credit' }).click()
  await expect(todayCredits).toContainText('1 of 2 left · 1 extra granted')
  expect(grantIds.size).toBe(1)
  await expect(page.getByRole('combobox', { name: 'Unlock credits per day' })).toContainText('2 credits')
  expect(cartoon.dailyLimit).toBe(1, 'granting must not save unsaved daily settings')
  await todayCredits.getByRole('button', { name: 'Add 1 credit today' }).click()
  await expect(todayCredits).toContainText('2 of 3 left · 2 extra granted')
  expect(grantIds.size).toBe(2)
  await todayCredits.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('temporary-unlock-credits-ipad.png') })
  await page.getByRole('checkbox', { name: 'Animal cartoons' }).check()
  await page.getByRole('button', { name: 'Save unlock settings', exact: true }).click()
  await expect(page.getByText('Unlock settings saved.', { exact: true })).toBeVisible()
  expect(cartoon).toEqual({ dailyLimit: 2, timePoolId: 'pool:1:cartoon', playlistIds: [10, 12, 11] })
  await page.reload()
  await general.getByRole('button', { name: 'Edit General videos' }).click()
  await expect(editor.getByLabel('Weekday minutes')).toHaveValue('50')
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await todayCredits.getByRole('button', { name: 'Edit unlock rules' }).click()
  await expect(page.getByRole('combobox', { name: 'Unlock credits per day' })).toContainText('2 credits')
  await page.getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(page.getByLabel('Time pool for Weekend stories')).toContainText('Learning')
  await expect(page.getByRole('article', { name: 'General videos time pool' })).toBeHidden()
  await page.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Daily Usage Summary' })).toBeVisible()
  await page.getByRole('tab', { name: 'Time & limits', exact: true }).click()
  await page.getByText('Viewing hours & breaks', { exact: true }).click()
  const saveRoutine = page.getByRole('button', { name: 'Save viewing routine' })
  const reduction = page.getByRole('dialog', { name: 'Save reduced allowances?' })
  await saveRoutine.click()
  await expect(reduction).toContainText('Current usage meets the proposed allowance.')
  await reduction.getByRole('button', { name: 'Cancel' }).click()
  await expect(reduction).toBeHidden()
  expect(confirmedReductions).toBe(0)
  await saveRoutine.click()
  await reduction.getByRole('button', { name: 'Save allowances' }).click()
  await expect(page.getByText('Viewing routine saved', { exact: true })).toBeVisible()
  expect(confirmedReductions).toBe(1)
  await page.getByRole('tab', { name: 'Profile', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Child profile', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Activity groups sessions and unlocks and opens days from the usage chart', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-20T04:00:00Z'))
  const child = { id: 1, email: 'admin@example.com', displayName: 'Explorer', role: 'admin' }
  const video = { videoId: 'jf:494ca5d441aae1fc4025403ad9a3a989', videoTitle: 'First episode', channelTitle: 'Adventure cartoons' }
  const epoch = (time: string) => Date.parse(time) / 1000
  const session: PlaybackViewingEvent = {
    kind: 'playback', ...video, sessionId: 'first', usageBucket: 'cartoon', timePoolId: 'pool:1:cartoon', timePoolName: 'Cartoons',
    startedAt: epoch('2026-11-20T03:02:00Z'), lastWatchedAt: epoch('2026-11-20T03:11:00Z'), watchedSeconds: 540, status: 'ended',
  }
  const today: ViewingEvent[] = [
    { ...session, sessionId: 'second', startedAt: epoch('2026-11-20T03:30:00Z'), lastWatchedAt: epoch('2026-11-20T03:45:00Z'), watchedSeconds: 868, status: 'paused' },
    session,
    { kind: 'unlock', ...video, unlockedAt: epoch('2026-11-20T03:00:00Z') },
  ]
  const yesterday = { ...session, sessionId: 'yesterday', videoTitle: 'Second episode', startedAt: epoch('2026-11-18T20:00:00Z'), lastWatchedAt: epoch('2026-11-18T20:09:00Z') }
  const older = { ...session, sessionId: 'older', videoTitle: 'Earlier episode', startedAt: epoch('2026-11-10T16:00:00Z'), lastWatchedAt: epoch('2026-11-10T16:10:00Z'), watchedSeconds: 600 }
  const totals = { '2026-11-10': 600, '2026-11-18': 540, '2026-11-19': 1408 }
  const requestedDays: (string | null)[] = []
  await page.route('**/api/**', async route => {
    const { pathname: path, searchParams } = new URL(route.request().url())
    let body: unknown = {}
    if (path === '/api/auth/session') body = { user: child }
    else if (path === '/api/admin/children') body = { children: [child] }
    else if (path.endsWith('/content')) body = { child, channels: [], playlists: [], videos: [], videoRules: [] }
    else if (path.endsWith('/usage')) {
      const days = Number(searchParams.get('days'))
      body = { days: Array.from({ length: days }, (_, index) => {
        const viewingDay = new Date(Date.UTC(2026, 10, 20 - days + index)).toISOString().slice(0, 10)
        return { viewingDay, totalSeconds: totals[viewingDay as keyof typeof totals] ?? 0 }
      }) }
    } else if (path.endsWith('/viewing-events')) {
      const day = searchParams.get('day')
      requestedDays.push(day)
      body = { events: day === '2026-11-10' ? [older] : day === '2026-11-18' ? [yesterday] : day ? [] : [...today, yesterday], nextCursor: day ? null : 'older-pages', timeZone: 'America/Los_Angeles', retentionDays: 30 }
    }
    await route.fulfill({ json: body })
  })
  await page.goto('/admin/child/1/manage')
  await page.getByRole('tab', { name: 'Activity', exact: true }).click()
  const daySection = (name: string) => page.locator('[data-viewing-day]').filter({ has: page.getByRole('heading', { name }) })
  const todaySection = daySection('Today · Thu, Nov 19')
  const grouped = todaySection.getByRole('button', { name: /First episode/ })
  await expect(todaySection).toContainText('23m 28s watched')
  await expect(todaySection).toContainText('1 video')
  await expect(todaySection).toContainText('1 unlock')
  await expect(grouped).toHaveCount(1)
  await expect(grouped).toContainText('Adventure cartoons')
  await expect(grouped).toContainText('Unlocked')
  await expect(grouped).toContainText('2 sessions')
  await expect(grouped).toContainText('Cartoons')
  await expect(grouped).not.toContainText(video.videoId)
  await expect(grouped).toHaveAttribute('aria-expanded', 'false')
  expect((await grouped.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await grouped.tap()
  await expect(grouped).toHaveAttribute('aria-expanded', 'true')
  await expect(todaySection.getByText('7:02 PM – 7:11 PM', { exact: true })).toBeVisible()
  await expect(todaySection.getByText('Paused', { exact: true })).toBeVisible()
  await expect(todaySection.getByText('Unlocked at 7:00 PM', { exact: true })).toBeVisible()
  await expect(todaySection.getByText('ended', { exact: true })).toHaveCount(0)

  const currentBar = page.getByRole('button', { name: 'Nov 19 · 23m 28s watched' })
  await currentBar.tap()
  await expect(currentBar).toHaveAttribute('aria-pressed', 'true')
  await expect(todaySection.getByRole('heading')).toBeInViewport()
  expect(requestedDays).toEqual([null])
  await currentBar.click()
  await expect(currentBar).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: 'Nov 18 · 9m watched' }).click()
  await expect(daySection('Yesterday · Wed, Nov 18')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load older events' })).toBeHidden()
  expect(requestedDays).toEqual([null, '2026-11-18'])

  await page.getByRole('combobox', { name: 'Usage date range' }).click()
  await page.getByRole('option', { name: '30 days' }).click()
  const olderBar = page.getByRole('button', { name: 'Nov 10 · 10m watched' })
  for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(size)
    await expect(olderBar).toBeVisible()
    expect((await olderBar.boundingBox())!.width).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await olderBar.tap()
  await expect(olderBar).toHaveAttribute('aria-pressed', 'true')
  await expect(daySection('Tue, Nov 10').getByText('Earlier episode')).toBeInViewport()
  await expect(todaySection).toBeHidden()
  await page.getByRole('button', { name: 'Showing Nov 10 · Show all days' }).tap()
  await expect(todaySection).toBeVisible()
  await expect(olderBar).toHaveAttribute('aria-pressed', 'false')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await page.getByRole('tab', { name: 'Activity', exact: true }).click()
  await page.getByRole('combobox', { name: 'Usage date range' }).click()
  await page.getByRole('option', { name: '30 days' }).click()
  await page.getByRole('button', { name: 'Oct 21 · 0s watched' }).click()
  await expect(page.getByText('No viewing events or unlocks on Oct 21.')).toBeVisible()
  expect(requestedDays).toEqual([null, '2026-11-18', '2026-11-10', null, '2026-10-21'])
})

test('Admin dashboard pauses a Child and grants minutes to one Time Pool', async ({ page }) => {
  let paused = false
  let watching = true
  let remainingSeconds = 120
  await page.route('**/api/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname)
    const user = { id: 1, role: 'admin', email: 'admin@example.com' }
    if (path === '/api/auth/session') return route.fulfill({ json: { user } })
    if (path === '/api/admin/children') return route.fulfill({ json: { children: [{
      id: 2, email: 'explorer@example.com', displayName: 'Explorer', isAdmin: false,
      policy: { blocked: paused, reason: paused ? 'viewing-pause' : null },
      activePlayback: { watching, videoTitle: watching ? 'Space science' : null },
      pools: [{ id: 'pool:2:restricted', name: 'General videos', remainingSeconds, allowanceMinutes: 60, locked: false }],
    }] } })
    if (path === '/api/admin/children/2/watch-time/viewing-pause') {
      expect(route.request().method()).toBe('PUT')
      paused = route.request().postDataJSON().paused
      watching = false
    }
    if (path === '/api/admin/children/2/time-pools/pool:2:restricted/extensions') {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({ minutes: 15 })
      remainingSeconds += 900
    }
    await route.fulfill({ json: {} })
  })
  await page.goto('/admin')
  const header = page.getByRole('banner')
  const navigation = header.getByRole('navigation', { name: 'Administration' })
  await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(1)
  await expect(navigation.getByRole('link', { name: 'Children' })).toHaveAttribute('aria-current', 'page')
  await expect(navigation.getByRole('link', { name: 'Jellyfin' })).toHaveAttribute('href', '/admin/jellyfin')
  await expect(navigation.getByRole('link', { name: 'Open viewer' })).toHaveAttribute('href', '/browse')
  const card = page.getByRole('article', { name: 'Explorer' })
  await expect(card).toContainText('Watching · Space science')
  await expect(card).toContainText('2 min left')
  await card.getByRole('button', { name: 'Pause today' }).click()
  await expect(card).toContainText('Paused for today')
  const extend = card.getByRole('button', { name: 'Add 15 minutes to General videos today' })
  expect((await extend.boundingBox())?.height).toBeGreaterThanOrEqual(44)
  await extend.click()
  await expect(card).toContainText('17 min left')
  await card.getByRole('button', { name: 'Resume today' }).click()
  await expect(card).toContainText('Ready to watch')
  await expect(page.getByRole('status')).toContainText('Explorer’s viewing resumed.')
  const toast = page.locator('.zt-toast-viewport').getByText('Explorer’s viewing resumed.', { exact: true })
  await expect(toast).toBeVisible()
})

test('the Child switcher stays beside Preview with one Admin navigation bar on iPad', async ({ page }) => {
  const children = [
    { id: 1, email: 'explorer@example.com', displayName: 'Explorer', role: 'admin' },
    { id: 2, email: 'scout@example.com', displayName: 'Scout', role: 'non-admin' },
  ]
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let json: unknown = {}
    if (path === '/api/auth/session') json = { user: children[0] }
    else if (path === '/api/admin/children') json = { children }
    else if (path.endsWith('/content')) json = { child: children.find(child => path.includes(`/${child.id}/`)), channels: [], playlists: [], videos: [] }
    else if (path.endsWith('/time-pools')) json = { pools: [], bindings: [] }
    else if (path.endsWith('/usage')) json = { days: [] }
    else if (path.endsWith('/viewing-events')) json = { events: [] }
    await route.fulfill({ json })
  })
  await page.goto('/admin/child/1/manage')
  const navigation = page.getByRole('banner').getByRole('navigation', { name: 'Administration' })
  const childSwitch = page.getByRole('combobox', { name: 'Switch Child' })
  const preview = page.getByRole('link', { name: 'Preview viewer' })
  for (const size of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    await page.setViewportSize(size)
    await expect(childSwitch).toContainText('Explorer')
    const [nav, child, action] = await Promise.all([navigation.boundingBox(), childSwitch.boundingBox(), preview.boundingBox()])
    expect(nav!.height).toBeLessThanOrEqual(56)
    for (const link of await navigation.getByRole('link').all()) {
      const target = (await link.boundingBox())!
      expect(target.height).toBeGreaterThanOrEqual(44)
      expect(target.width).toBeGreaterThanOrEqual(44)
    }
    expect(child!.height).toBeGreaterThanOrEqual(44)
    expect(action!.y).toBeCloseTo(child!.y, 0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await childSwitch.click()
  await page.getByRole('option', { name: 'Scout', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/child\/2\/manage$/)
  await expect(childSwitch).toContainText('Scout')
  await expect(preview).toHaveAttribute('href', '/admin/child/2/preview')
  await expect(page.getByRole('navigation', { name: 'Administration' })).toHaveCount(1)
})
