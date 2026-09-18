// Capture the real UI with synthetic data only. No server, credentials or live APIs.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, extname } from 'node:path'
import { chromium, expect } from '@playwright/test'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../', import.meta.url))
const client = resolve(root, 'dist/client')
const output = resolve(root, 'docs/screenshots')
const origin = 'http://127.0.0.1:5198'
const day = '2026-09-18'
const iconSets = Object.fromEntries(await Promise.all(['heroicons', 'lucide'].map(async name =>
  [`/${name}.json`, JSON.parse(await readFile(resolve(root, `scripts/fixtures/readme-${name}.json`), 'utf8'))],
)))
const child = { id: 1, email: 'alex@example.test', displayName: 'Alex', role: 'non-admin' }
const parent = { id: 2, email: 'parent@example.test', displayName: 'Parent', role: 'admin' }
const pool = (key, name, minutes, used, weekend) => ({
  id: `pool:1:${key}`, legacyKey: key, name, weekdayMinutes: minutes, weekendMinutes: weekend,
  requiresClaim: key === 'cartoon', usedSeconds: used * 60, remainingSeconds: (minutes - used) * 60,
  allowanceMinutes: minutes, extensionMinutes: 0, unlocked: false, locked: false,
})
const pools = [pool('restricted', 'General videos', 45, 12, 60), pool('cartoon', 'Cartoons', 30, 8, 45), pool('exempt', 'Learning', 90, 20, 120)]
const watchTime = { pools }
const policy = { blocked: false, breakCycleRemainingSeconds: 1200 }
const settings = { timeZone: 'Europe/London', weekdayAllowanceMinutes: 45, weekendAllowanceMinutes: 60, safetyCapMinutes: 90, allowedStartMinute: 480, allowedEndMinute: 1140, breakAfterMinutes: 30, breakDurationMinutes: 10 }

// Original vector illustrations, deliberately unrelated to any real media library.
const scenes = {
  ocean: ['#d1edf0', '<path d="M0 150Q160 80 320 150T640 150V360H0" fill="#5dabb7"/><path d="M0 240Q160 170 320 240T640 240V360H0" fill="#26738d"/><ellipse cx="330" cy="225" rx="105" ry="56" fill="#194e68"/><path d="m245 225-65-40v80Z" fill="#194e68"/><circle cx="392" cy="213" r="6" fill="white"/><path d="M110 360q-25-60 0-110m24 110q35-80 10-135M550 360q-25-60 0-110" stroke="#9ed8c1" stroke-width="12" fill="none"/>'],
  space: ['#252d51', '<g fill="#f8e3ac"><circle cx="88" cy="66" r="3"/><circle cx="180" cy="138" r="4"/><circle cx="520" cy="73" r="4"/><circle cx="554" cy="260" r="3"/><circle cx="102" cy="283" r="4"/></g><circle cx="330" cy="190" r="93" fill="#ddb07c"/><path d="M253 140q77 45 155 17M239 190q88 45 179 22M264 247q70 24 130 6" stroke="#bc825f" stroke-width="17" fill="none"/><ellipse cx="330" cy="190" rx="165" ry="37" transform="rotate(-24 330 190)" stroke="#e7d4b0" stroke-width="14" fill="none"/>'],
  forest: ['#e8edcf', '<circle cx="498" cy="80" r="45" fill="#f2c96a"/><path d="M0 270Q180 130 360 240T640 200V360H0" fill="#91b391"/><path d="M0 315Q240 235 640 300V360H0" fill="#427565"/><g fill="#315e53"><path d="m145 58-73 186h146Z"/><path d="m460 120-65 163h130Z"/></g><g stroke="#705c48" stroke-width="15"><path d="M145 222v92M460 259v60"/></g><path d="M267 360q110-75 70-118" stroke="#e4cc9c" stroke-width="38" fill="none"/>'],
  garden: ['#f4e3cf', '<circle cx="495" cy="90" r="46" fill="#efbc68"/><path d="M0 282Q320 225 640 280V360H0" fill="#a5bc85"/><g stroke="#527951" stroke-width="12" fill="none"><path d="M205 295V148M345 295V110M452 300V185"/></g><g fill="#749554"><ellipse cx="175" cy="210" rx="42" ry="19" transform="rotate(30 175 210)"/><ellipse cx="380" cy="195" rx="45" ry="21" transform="rotate(-30 380 195)"/></g><g fill="#e58b73"><circle cx="205" cy="136" r="38"/><circle cx="345" cy="101" r="44"/><circle cx="452" cy="177" r="32"/></g><g fill="#f8d67e"><circle cx="205" cy="136" r="15"/><circle cx="345" cy="101" r="18"/><circle cx="452" cy="177" r="12"/></g>'],
}
const artwork = name => {
  const [background, shapes] = scenes[name]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="${background}"/>${shapes}</svg>`
}
const video = (id, title, art, channel, duration = 720) => ({ videoId: id, videoTitle: title, videoThumbnail: `/demo-art/${art}.svg`, channelTitle: channel, duration, isAvailable: true, contentRule: 'restricted', tags: ['Discover'] })
const videos = [
  video('demo-ocean', 'What lives in the deep ocean?', 'ocean', 'Curious Planet', 864),
  video('demo-space', 'A journey around Saturn', 'space', 'Little Space Lab', 1080),
  video('demo-forest', 'The secret life of a forest', 'forest', 'Outside Together', 756),
  video('demo-garden', 'From tiny seed to sunflower', 'garden', 'Make & Grow', 612),
]
const recommendations = [
  video('demo-new-garden', 'Build a tiny garden of your own', 'garden', 'Make & Grow', 780),
  video('demo-new-ocean', 'Why do whales sing?', 'ocean', 'Curious Planet', 960),
  video('demo-new-space', 'Meet our neighbours in space', 'space', 'Little Space Lab', 840),
  video('demo-new-forest', 'Who left these footprints?', 'forest', 'Outside Together', 690),
]
const episodes = ['The woodland trail', 'A garden full of surprises', 'Across the blue lagoon'].map((title, i) => ({
  ...video(`jf:demo:ep${i + 1}`, `S1 E${i + 1} · ${title}`, ['forest', 'garden', 'ocean', 'space'][i], 'Little Adventures', 660 + i * 60),
  season: 'Season 1', position: i, requiresClaim: true, ...(i === 0 ? { positionSeconds: 180 } : {}),
}))
const channels = videos.map((v, i) => ({ id: i + 1, channelId: `demo-channel-${i}`, channelTitle: v.channelTitle, channelThumbnail: v.videoThumbnail, isAvailable: true, tags: ['Nature', 'Space', 'Nature', 'Making'][i].split(',') }))
const playlists = [{ id: 11, playlistId: 'pl:jf:demo', playlistTitle: 'Little Adventures', playlistThumbnail: '/demo-art/forest.svg', cartoonPool: true, isAvailable: true }]
const browse = {
  channels, playlists, videos: [], continueWatching: videos.map((v, i) => ({ ...v, positionSeconds: [210, 360, 150, 90][i] })),
  favorites: [], recommendations, favoriteVideoIds: [], watchTime, policy,
  seriesNavigation: [{ playlistId: 11, seriesTitle: 'Little Adventures', previousVideoId: episodes[0].videoId, previousTitle: episodes[0].videoTitle, nextVideoId: episodes[1].videoId, nextTitle: episodes[1].videoTitle }],
}

function api(path, admin) {
  const responses = {
    '/api/auth/session': { user: admin ? parent : child },
    '/api/child/recommendations/count': { count: admin ? 0 : recommendations.length },
    '/api/child/browse': browse,
    '/api/child/watch-time': { ...watchTime, policy },
    '/api/child/playlist/11/videos': { playlist: { id: 11, title: 'Little Adventures', thumbnail: '/demo-art/forest.svg', curated: true }, videos: episodes, favoriteVideoIds: [], unlockedVideoIds: [episodes[0].videoId], nextPage: null, watchTime, policy },
    '/api/admin/children': { children: [child, parent] },
    '/api/admin/children/1/content': { child, channels, playlists, videos: [], videoRules: [] },
    '/api/admin/children/1/time-pools': { pools, bindings: [], viewingDay: day },
    '/api/admin/children/1/cartoon-pool': { dailyLimit: 1, timePoolId: pools[1].id, playlistIds: [11] },
    '/api/admin/children/1/unlock-credits': { viewingDay: day, dailyLimit: 1, bonusCredits: 0, totalCredits: 1, remaining: 1, claimedVideoIds: [] },
    '/api/admin/children/1/time-settings': { settings, viewingDay: { localDate: day, isWeekend: false, allowanceMinutes: 45 } },
    '/api/admin/children/1/watch-time': { viewingDay: day, restricted: { usedMinutes: 12, remainingMinutes: 33 }, exempt: { usedMinutes: 20, remainingMinutes: 70 }, policy },
    '/api/admin/children/1/usage': { days: [] },
    '/api/admin/children/1/viewing-events': { events: [], nextCursor: null, timeZone: settings.timeZone },
  }
  assert.ok(Object.hasOwn(responses, path), `Missing screenshot fixture: ${path}`)
  return responses[path]
}

await mkdir(output, { recursive: true })
await readFile(resolve(client, 'index.html')) // Build first; fail before launching if absent.
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
const problems = []
try {
  for (const admin of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, locale: 'en-GB', timezoneId: 'Europe/London', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' })
    // Every request is handled locally. Nothing falls through to a live endpoint.
    await context.route('**/*', async route => {
      try {
        const url = new URL(route.request().url())
        if (url.origin === 'https://api.iconify.design' && Object.hasOwn(iconSets, url.pathname)) {
          const icons = iconSets[url.pathname]
          for (const name of (url.searchParams.get('icons') ?? '').split(',')) assert.ok(icons.icons[name], `Missing icon fixture: ${name}`)
          return await route.fulfill({ json: icons })
        }
        assert.equal(url.origin, origin, `External request blocked: ${url.origin}${url.pathname}${url.search}`)
        assert.equal(route.request().method(), 'GET')
        if (url.pathname.startsWith('/api/')) return await route.fulfill({ json: api(url.pathname, admin) })
        if (url.pathname.startsWith('/demo-art/')) return await route.fulfill({ contentType: 'image/svg+xml', body: artwork(url.pathname.split('/').pop().replace('.svg', '')) })
        const filename = url.pathname.startsWith('/assets/') ? resolve(client, `.${url.pathname}`) : resolve(client, 'index.html')
        assert.ok(filename.startsWith(`${client}/`))
        const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[extname(filename)]
        await route.fulfill({ contentType, body: await readFile(filename) })
      } catch (error) { problems.push(error.message); await route.abort() }
    })
    const page = await context.newPage()
    page.on('pageerror', error => problems.push(error.message))
    const capture = async name => {
      await page.evaluate(() => document.fonts.ready)
      await expect(page.getByRole('alert')).toHaveCount(0)
      await page.waitForFunction(() => [...document.images].every(img => img.complete && img.naturalWidth > 0))
      await expect(page.locator('.zt-brand-mark svg')).toBeVisible()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow')
      const screenshot = await page.screenshot({ animations: 'disabled' })
      // Re-encode without metadata; no browser chrome, URL bar or desktop is captured.
      await sharp(screenshot).png({ compressionLevel: 9 }).toFile(resolve(output, `${name}.png`))
      console.log(`Captured ${name}.png with synthetic ${admin ? 'Admin' : 'Child'} data`)
    }
    if (admin) {
      await page.goto(`${origin}/admin/child/1/manage`)
      await expect(page.getByRole('form', { name: 'Cartoons time pool' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Refresh pools' })).toBeEnabled()
      await capture('parent-controls')
    } else {
      await page.goto(`${origin}/browse`)
      await expect(page.getByRole('heading', { name: 'Continue Watching' })).toBeVisible()
      await capture('child-library')
      await page.goto(`${origin}/browse/playlist/11`)
      await expect(page.getByRole('heading', { name: 'Little Adventures' })).toBeVisible()
      await expect(page.getByText('Unlocked', { exact: true })).toBeVisible()
      await capture('jellyfin-episodes')
    }
    await context.close()
  }
  assert.deepEqual(problems, [], 'Screenshots must have no failed requests or UI errors')
} finally { await browser.close() }
