import { expect, test } from '@playwright/test'
import type { TimePoolStatus, TimePoolBinding } from '../../src/domain'

test('Admin edits independent time pools, binds content and saves daily unlock credits', async ({ page }, testInfo) => {
  const makePool = (key: 'restricted' | 'cartoon' | 'exempt', name: string, minutes: number, used: number): TimePoolStatus => ({ id: `pool:1:${key}`, legacyKey: key, name, weekdayMinutes: minutes, weekendMinutes: minutes, requiresClaim: key === 'cartoon', usedSeconds: used * 60, remainingSeconds: (minutes - used) * 60, allowanceMinutes: minutes, extensionMinutes: 0, unlocked: false, locked: false })
  const pools = [makePool('restricted', 'General videos', 60, 18), makePool('cartoon', 'Cartoons', 30, 12), makePool('exempt', 'Learning', 180, 25)]
  let tags = ['Stories']
  let tagWrites = 0
  let confirmedReductions = 0
  const bindings: TimePoolBinding[] = [{ kind: 'channel', contentId: 'science', poolId: 'pool:1:exempt' }]
  const grantIds = new Set<string>()
  let loseGrantResponse = true
  let cartoon = { dailyLimit: 1, timePoolId: 'pool:1:cartoon', playlistIds: [10, 12] }
  const settings = { timeZone: 'America/Los_Angeles', weekdayAllowanceMinutes: 60, weekendAllowanceMinutes: 60, safetyCapMinutes: 180, allowedStartMinute: 480, allowedEndMinute: 1200, breakAfterMinutes: 30, breakDurationMinutes: 10 }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    const child = { id: 1, email: 'preview@example.com', displayName: 'Explorer', role: 'admin' }
    let body: unknown = {}
    if (path === '/api/auth/session') body = { user: child }
    else if (path === '/api/admin/children') body = { children: [child] }
    else if (path.endsWith('/content')) body = { child, channels: [
      { id: 1, channelId: 'stories', channelTitle: 'Weekend stories', isAvailable: true, contentRule: 'restricted', tags },
      { id: 2, channelId: 'science', channelTitle: 'Science for kids', isAvailable: true, contentRule: 'restricted', tags: ['Science', 'Learning'] },
    ], playlists: [{ id: 10, playlistId: 'adventure', playlistTitle: 'Adventure cartoons', isAvailable: true }, { id: 11, playlistId: 'animals', playlistTitle: 'Animal cartoons', isAvailable: true }, { id: 12, playlistId: 'pl:legacy', playlistTitle: 'Hidden WebDAV series', isAvailable: true }], videos: [{ id: 13, videoId: 'ol:legacy', videoTitle: 'Hidden WebDAV video' }], videoRules: [] }
    else if (path.endsWith('/content/channel/1/tags')) {
      tags = route.request().postDataJSON().tags
      tagWrites++
    } else if (path.endsWith('/time-pools')) body = { pools, bindings, viewingDay: '2026-09-17' }
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
    else if (path.endsWith('/watch-time')) body = { viewingDay: '2026-09-17', restricted: { usedMinutes: 18, remainingMinutes: 42 }, exempt: { usedMinutes: 25, remainingMinutes: 155 }, policy: { blocked: false, breakCycleRemainingSeconds: 1200 } }
    else if (path.endsWith('/usage')) body = { days: [] }
    else if (path.endsWith('/viewing-events')) body = { events: [
      { kind: 'unlock', videoId: 'jf:episode-1', videoTitle: 'First episode', channelTitle: 'Adventure cartoons', unlockedAt: 1789671600 },
      { kind: 'playback', sessionId: 'watch-1', videoId: 'jf:episode-1', videoTitle: 'First episode', channelTitle: 'Adventure cartoons', usageBucket: 'cartoon', timePoolId: 'pool:1:cartoon', timePoolName: 'Cartoons', startedAt: 1789671660, lastWatchedAt: 1789671675, watchedSeconds: 15, status: 'ended' },
    ], nextCursor: null, timeZone: settings.timeZone }
    await route.fulfill({ json: body })
  })
  await page.goto('/admin/child/1/manage')
  await expect(page.getByRole('form', { name: 'Cartoons time pool' })).toBeVisible()
  await expect(page.getByText(/Hidden WebDAV/)).toHaveCount(0)
  await expect(page.locator('a[href="/admin/library"]')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('child-settings-overview.png'), fullPage: true })
  await page.getByText('Unlock credits', { exact: true }).click()
  await expect(page.getByLabel('Time pool for the cartoon library')).toHaveValue('pool:1:cartoon')
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
  await page.getByLabel('Time pool for Weekend stories').click()
  await page.getByRole('option', { name: 'Learning', exact: true }).click()
  await expect(page.getByLabel('Time pool for Weekend stories')).toContainText('Learning')
  expect(bindings).toContainEqual({ kind: 'channel', contentId: 'stories', poolId: 'pool:1:exempt' })
  await page.getByRole('tab', { name: 'Time & limits', exact: true }).click()
  const general = page.getByRole('form', { name: 'General videos time pool' })
  const learning = page.getByRole('form', { name: 'Learning time pool' })
  await general.getByText('Edit daily limits', { exact: true }).click()
  await learning.getByText('Edit daily limits', { exact: true }).click()
  await learning.getByLabel('Weekday minutes').fill('200')
  await general.getByLabel('Weekday minutes').fill('50')
  await general.getByRole('button', { name: 'Save pool', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('General videos saved.')
  await expect(learning.getByLabel('Weekday minutes')).toHaveValue('200')
  await general.getByRole('button', { name: 'Add 15 minutes to General videos today' }).click()
  await expect(general).toContainText('+15 min today')
  expect(pools[1]!.extensionMinutes).toBe(0)
  expect(pools[2]!.extensionMinutes).toBe(0)
  await page.getByLabel('Unlock credits per day').selectOption('2')
  const todayCredits = page.getByRole('region', { name: 'Today’s unlock credits' })
  await expect(todayCredits).toContainText('0 of 1 left · 0 extra granted')
  await todayCredits.getByRole('button', { name: 'Add 1 credit today' }).click()
  await expect(todayCredits.getByRole('alert')).toContainText('Response interrupted')
  await todayCredits.getByRole('button', { name: 'Retry granting 1 credit' }).click()
  await expect(todayCredits).toContainText('1 of 2 left · 1 extra granted')
  expect(grantIds.size).toBe(1)
  await expect(page.getByLabel('Unlock credits per day')).toHaveValue('2')
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
  await expect(page.getByRole('form', { name: 'General videos time pool' }).getByLabel('Weekday minutes')).toHaveValue('50')
  await expect(page.getByRole('form', { name: 'Learning time pool' }).getByLabel('Weekday minutes')).toHaveValue('180')
  await page.getByText('Unlock credits', { exact: true }).click()
  await expect(page.getByLabel('Unlock credits per day')).toHaveValue('2')
  await page.getByRole('tab', { name: 'Content', exact: true }).click()
  await expect(page.getByLabel('Time pool for Weekend stories')).toContainText('Learning')
  await expect(page.getByRole('form', { name: 'General videos time pool' })).toBeHidden()
  await page.getByRole('tab', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Daily Usage Summary' })).toBeVisible()
  const activity = page.getByRole('listitem').filter({ hasText: 'Episode Unlock' })
  await expect(activity).toContainText('First episode')
  await expect(activity).toContainText('1 Unlock Credit · No Watch Time')
  await expect(page.getByRole('listitem').filter({ hasText: 'Last watched' })).toContainText('0m 15s')
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
})
