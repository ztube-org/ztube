import { expect, test } from '@playwright/test'

test('Admin saves Jellyfin without connecting, imports a season and explicitly shares it with a Child', async ({ page }, testInfo) => {
  let saved = false, imported = false, shared = false, browses = 0
  const server = { id: 'home', name: 'Home Jellyfin', url: 'https://jellyfin.example.com/', enabled: true, revision: 1 }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname
    let body: unknown = {}
    if (path === '/api/auth/session') body = { user: { id: 1, role: 'admin', email: 'parent@example.com', displayName: 'Parent' } }
    else if (path === '/api/admin/children') body = { children: [{ id: 2, displayName: 'Explorer', email: 'child@example.com' }] }
    else if (path === '/api/admin/jellyfin/servers') body = { servers: saved ? [server] : [] }
    else if (path === '/api/admin/jellyfin/servers/new') {
      expect(route.request().postDataJSON()).toMatchObject({ name: server.name, url: server.url, apiKey: 'test-key', enabled: true })
      saved = true; body = { id: server.id }
    } else if (path.endsWith('/items')) {
      browses++
      const type = url.searchParams.get('type')
      body = { items: type === 'libraries' ? [{ id: 'library', name: 'Cartoons', type: 'CollectionFolder' }] : type === 'series' ? [{ id: 'series', name: 'Adventure', type: 'Series' }] : [{ id: 'season', name: 'Season 1', type: 'Season' }], nextPage: null }
    } else if (path.endsWith('/import')) {
      expect(route.request().postDataJSON()).toEqual({ itemId: 'season' })
      imported = true; body = { id: 'pl:jf:season', title: 'Adventure · Season 1', imported: 12, skipped: 1 }
    } else if (path === '/api/admin/jellyfin/imports') body = { imports: imported ? [{ id: 'pl:jf:season', revision: 1, title: 'Adventure · Season 1', serverId: 'home', itemId: 'season', episodeCount: 12, lastSyncedAt: 1789646400 }] : [], approvals: shared ? [{ playlistId: 'pl:jf:season', childId: 2, cartoonPool: 1 }] : [] }
    else if (path === '/api/admin/jellyfin/imports/pl:jf:season' && route.request().method() === 'DELETE') { expect(route.request().postDataJSON()).toEqual({ revision: 1 }); imported = false; shared = false; body = { success: true } }
    else if (path.endsWith('/children/2')) { shared = route.request().postDataJSON().approved; body = { success: true } }
    await route.fulfill({ json: body })
  })
  await page.goto('/admin/jellyfin')
  await page.getByRole('tab', { name: 'Connections', exact: true }).click()
  await page.getByRole('button', { name: 'Add Jellyfin server' }).click()
  await page.getByLabel('Name', { exact: true }).fill(server.name)
  await page.getByLabel('Server URL').fill(server.url)
  await page.getByLabel('Jellyfin API key').fill('test-key')
  await page.getByRole('button', { name: 'Save connection' }).click()
  await expect(page.getByRole('status')).toContainText('Connection saved')
  expect(browses).toBe(0)
  await page.getByRole('button', { name: 'Browse library' }).click()
  await page.getByRole('button', { name: 'View series' }).click()
  await page.getByRole('button', { name: 'View seasons' }).click()
  await page.getByRole('button', { name: 'Import Season 1', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('12 episodes imported; 1 unsupported episodes skipped')
  expect(shared).toBe(false)
  await page.getByRole('checkbox', { name: 'Explorer', exact: true }).check()
  await expect(page.getByRole('link', { name: 'Explorer’s time & credit settings' })).toBeVisible()
  expect(shared).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('jellyfin-ipad.png'), fullPage: true })
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Explorer', exact: true })).toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Delete Adventure · Season 1' }).click()
  expect(imported).toBe(true)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Delete Adventure · Season 1' }).click()
  await expect(page.getByRole('button', { name: 'Delete Adventure · Season 1' })).toHaveCount(0)
  expect(imported).toBe(false)
  expect(errors).toEqual([])
})
