import assert from 'node:assert/strict'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import test from 'node:test'
import { createApp } from './app.ts'

async function fixture() {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (10, 'child@example.com'), (20, 'other@example.com');
    INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes, safety_cap_minutes)
      VALUES (10, 'America/Los_Angeles', 60, 120, 180), (20, 'UTC', 60, 120, 180);
    INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds, exempt_seconds)
      VALUES (10, '2026-08-16', 301, 601);
  `)
  const clock = new Date('2026-08-16T19:00:00.000Z')
  let user: any = { id: 1, email: 'parent@example.com', displayName: null, role: 'admin' }
  const app = createApp({ now: () => new Date(clock), resolveUser: async () => user })
  const env = { DB: d1 as unknown as D1Database } as Env
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  return { d1, clock, request, asChild() { user = { id: 10, email: 'child@example.com', displayName: null, role: 'non-admin' } } }
}

test('Admin sees whole-minute buckets and can extend each independently', async () => {
  const { request } = await fixture()
  const initial = await (await request('/api/admin/children/10/watch-time')).json() as any
  assert.equal(initial.viewingDay, '2026-08-16')
  assert.deepEqual([initial.restricted.usedMinutes, initial.restricted.remainingMinutes], [5, 115])
  assert.deepEqual([initial.exempt.usedMinutes, initial.exempt.remainingMinutes], [10, 170])

  const restricted = await (await request('/api/admin/children/10/watch-time/extensions', 'POST', { bucket: 'restricted', minutes: 15 })).json() as any
  assert.equal(restricted.restricted.extensionMinutes, 15)
  assert.equal(restricted.exempt.extensionMinutes, 0)
  const exempt = await (await request('/api/admin/children/10/watch-time/extensions', 'POST', { bucket: 'exempt', minutes: 30 })).json() as any
  assert.equal(exempt.exempt.extensionMinutes, 30)
  assert.equal((await request('/api/admin/children/20/watch-time/extensions', 'POST', { bucket: 'restricted', minutes: 15 })).status, 200)
})

test('ordinary unlock is isolated from the Safety Cap and expires at local midnight across DST', async () => {
  const { clock, request } = await fixture()
  const unlocked = await (await request('/api/admin/children/10/watch-time/restricted-unlock', 'PUT', { unlocked: true })).json() as any
  assert.equal(unlocked.restricted.unlocked, true)
  assert.equal(unlocked.restricted.remainingMinutes, null)
  assert.equal(unlocked.exempt.unlocked, undefined)

  // November 1, 2026 repeats an hour in Los Angeles; the intervention remains tied to its local date.
  clock.setTime(new Date('2026-11-01T08:30:00.000Z').getTime())
  await request('/api/admin/children/10/watch-time/extensions', 'POST', { bucket: 'restricted', minutes: 15 })
  clock.setTime(new Date('2026-11-01T09:30:00.000Z').getTime())
  assert.equal(((await (await request('/api/admin/children/10/watch-time')).json() as any).restricted.extensionMinutes), 15)
  clock.setTime(new Date('2026-11-02T08:00:00.000Z').getTime())
  const nextDay = await (await request('/api/admin/children/10/watch-time')).json() as any
  assert.equal(nextDay.restricted.extensionMinutes, 0)
  assert.equal(nextDay.restricted.unlocked, false)
})

test('a recurring reduction requires warning confirmation and ends affected Active Playback', async () => {
  const { d1, request } = await fixture()
  d1.sqlite.exec(`
    UPDATE daily_usage_summaries SET restricted_seconds = 900 WHERE child_id = 10 AND viewing_day = '2026-08-16';
    INSERT INTO playback_sessions (id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, lease_expires_at, usage_bucket)
      VALUES ('active', 10, '2026-08-16', 1, 'playing', 1786906800, 1786906860, 'restricted');
  `)
  const settings = { timeZone: 'America/Los_Angeles', weekdayAllowanceMinutes: 15, weekendAllowanceMinutes: 15, safetyCapMinutes: 180 }
  const warning = await request('/api/admin/children/10/time-settings', 'PUT', settings)
  assert.equal(warning.status, 409)
  assert.equal((await warning.json() as any).requiresConfirmation, true)
  assert.equal((d1.sqlite.prepare("SELECT ended_at FROM playback_sessions WHERE id = 'active'").get() as any).ended_at, null)

  assert.equal((await request('/api/admin/children/10/time-settings', 'PUT', { ...settings, confirmReduction: true })).status, 200)
  assert.notEqual((d1.sqlite.prepare("SELECT ended_at FROM playback_sessions WHERE id = 'active'").get() as any).ended_at, null)
})

test('Viewing Pause and Required Break block playback while preserving aggregate-only usage history', async () => {
  const { d1, clock, request, asChild } = await fixture()
  d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, duration, is_available) VALUES (10, 'approved', 'Approved', 600, 1)")
  assert.equal((await request('/api/admin/children/10/watch-time/viewing-pause', 'PUT', { paused: true })).status, 200)
  asChild()
  assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'approved' })).status, 403)

  d1.sqlite.exec("UPDATE daily_usage_summaries SET playback_paused = 0, break_cycle_seconds = 900, break_until = 1786907100 WHERE child_id = 10 AND viewing_day = '2026-08-16'")
  assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'approved' })).status, 403)
  clock.setTime(new Date('2026-08-16T19:06:00.000Z').getTime())
  assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'approved' })).status, 200)
})

test('lowering the Break Cycle threshold starts a Required Break including pending playback', async () => {
  for (const active of [false, true]) {
    const { d1, clock, request, asChild } = await fixture()
    d1.sqlite.exec(`
      UPDATE child_time_settings SET break_after_minutes = 30, break_duration_minutes = 5 WHERE child_id = 10;
      UPDATE daily_usage_summaries SET break_cycle_seconds = ${active ? 890 : 1200} WHERE child_id = 10;
      INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES (10, 'approved', 'Approved', 1800);
    `)
    const epoch = Math.floor(clock.getTime() / 1000)
    if (active) {
      d1.sqlite.prepare(`INSERT INTO playback_sessions
        (id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, lease_expires_at, usage_bucket, video_id)
        VALUES ('active', 10, '2026-08-16', 1, 'playing', ?, ?, 'restricted', 'approved')`).run(epoch - 20, epoch + 40)
    }
    const settings = { timeZone: 'America/Los_Angeles', weekdayAllowanceMinutes: 60, weekendAllowanceMinutes: 120, safetyCapMinutes: 180, breakAfterMinutes: 15, breakDurationMinutes: 5 }
    assert.equal((await request('/api/admin/children/10/time-settings', 'PUT', settings)).status, 200)
    const usage = d1.sqlite.prepare('SELECT break_cycle_seconds, break_until, restricted_seconds FROM daily_usage_summaries WHERE child_id = 10').get()!
    assert.equal(usage.break_cycle_seconds, active ? 910 : 1200)
    assert.equal(usage.break_until, epoch + 300)
    assert.equal(usage.restricted_seconds, active ? 321 : 301)
    if (active) assert.equal(d1.sqlite.prepare("SELECT ended_at FROM playback_sessions WHERE id = 'active'").get()?.ended_at, epoch)

    // Saving unchanged settings must not extend an already-running break.
    clock.setTime(clock.getTime() + 60_000)
    assert.equal((await request('/api/admin/children/10/time-settings', 'PUT', settings)).status, 200)
    assert.equal(d1.sqlite.prepare('SELECT break_until FROM daily_usage_summaries WHERE child_id = 10').get()?.break_until, epoch + 300)
    asChild()
    const denied = await request('/api/child/playback-authorizations', 'POST', { videoId: 'approved' })
    assert.equal(denied.status, 403)
    assert.match((await denied.json() as any).message, /Required Break/)
    if (active) {
      const heartbeat = await request('/api/child/playback-authorizations/active/heartbeats', 'POST', { sequence: 2, state: 'playing' })
      assert.equal((await heartbeat.json() as any).authorized, false)
    }
    clock.setTime((epoch + 300) * 1000)
    assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'approved' })).status, 200)
    assert.equal(d1.sqlite.prepare('SELECT break_cycle_seconds FROM daily_usage_summaries WHERE child_id = 10').get()?.break_cycle_seconds, 0)
  }
})

test('Admin receives a zero-filled 7 or 30 day Daily Usage Summary', async () => {
  const { request } = await fixture()
  const summary = await (await request('/api/admin/children/10/usage?days=7')).json() as any
  assert.equal(summary.days.length, 7)
  assert.deepEqual(summary.days.at(-1), { viewingDay: '2026-08-16', restrictedSeconds: 301, exemptSeconds: 601, cartoonSeconds: 0, totalSeconds: 902 })
  assert.equal(summary.days[0].totalSeconds, 0)
})

test('custom whole-minute allowances persist and stop playback exactly at 50 minutes', async () => {
  const { d1, clock, request, asChild } = await fixture()
  try {
    const input = { timeZone: 'America/Los_Angeles', weekdayAllowanceMinutes: 50, weekendAllowanceMinutes: 50, safetyCapMinutes: 55 }
    assert.equal((await request('/api/admin/children/10/time-settings', 'PUT', input)).status, 200)
    const saved = await (await request('/api/admin/children/10/time-settings')).json() as any
    assert.equal(saved.settings.weekdayAllowanceMinutes, 50)
    assert.equal(saved.settings.weekendAllowanceMinutes, 50)
    assert.equal(saved.settings.safetyCapMinutes, 55)
    assert.equal(saved.viewingDay.allowanceMinutes, 50)
    for (const field of ['weekdayAllowanceMinutes', 'weekendAllowanceMinutes', 'safetyCapMinutes']) {
      for (const invalid of [-1, 50.5, 1441, '50', null]) {
        assert.equal((await request('/api/admin/children/10/time-settings', 'PUT', { ...input, [field]: invalid })).status, 400)
      }
    }
    d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, duration, is_available) VALUES (10, 'approved', 'Approved', 600, 1)")
    d1.sqlite.exec("UPDATE daily_usage_summaries SET restricted_seconds = 2999 WHERE child_id = 10 AND viewing_day = '2026-08-16'")
    asChild()
    const { authorization } = await (await request('/api/child/playback-authorizations', 'POST', { videoId: 'approved' })).json() as any
    assert.equal(authorization.remainingSeconds, 1)
    const path = `/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`
    await request(path, 'POST', { sequence: 1, state: 'playing' })
    clock.setTime(clock.getTime() + 1000)
    const last = await (await request(path, 'POST', { sequence: 2, state: 'playing' })).json() as any
    assert.equal(last.authorized, false)
    assert.equal(last.remainingSeconds, 0)
    assert.equal(d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries WHERE child_id = 10').get()!.restricted_seconds, 3000)
  } finally { d1.sqlite.close() }
})

test('whole-minute migration preserves every existing setting and Child relationship', async () => {
  const { readFile, readdir } = await import('node:fs/promises')
  const d1 = new IsolatedD1()
  try {
    const directory = new URL('../migrations/', import.meta.url)
    for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql') && n < '0020').sort()) {
      await d1.exec(await readFile(new URL(name, directory), 'utf8'))
    }
    d1.sqlite.exec("PRAGMA foreign_keys = ON; INSERT INTO children (id, email) VALUES (10, 'existing@example.com')")
    d1.sqlite.exec(`INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes,
      safety_cap_minutes, updated_at, allowed_start_minute, allowed_end_minute, break_after_minutes, break_duration_minutes)
      VALUES (10, 'Asia/Shanghai', 45, 75, 105, 1786906800, 480, 1200, 45, 10)`)
    const before = d1.sqlite.prepare('SELECT * FROM child_time_settings').get()
    const migration = await readFile(new URL('0020_whole_minute_allowances.sql', directory), 'utf8')
    await d1.batch(migration.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean).map(s => d1.prepare(s)))
    assert.deepEqual(d1.sqlite.prepare('SELECT * FROM child_time_settings').get(), before)
    d1.sqlite.exec('UPDATE child_time_settings SET weekday_allowance_minutes = 50')
    assert.throws(() => d1.sqlite.exec('UPDATE child_time_settings SET weekday_allowance_minutes = 50.5'))
    assert.throws(() => d1.sqlite.exec('UPDATE child_time_settings SET weekday_allowance_minutes = 1441'))
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM children').get()!.count, 1)
    d1.sqlite.exec('DELETE FROM children WHERE id = 10')
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM child_time_settings').get()!.count, 0)
  } finally { d1.sqlite.close() }
})
