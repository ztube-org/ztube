import assert from 'node:assert/strict'
import test from 'node:test'
import { database } from './database/client.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'

test('database client reuse keeps bindings isolated and reads current data', async () => {
  const a = new IsolatedD1(), b = new IsolatedD1()
  try {
    await migrate(a); await migrate(b)
    const first = database(a)
    assert.equal(database(a), first)
    assert.notEqual(database(b), first)
    await a.exec("INSERT INTO children (id, email, display_name) VALUES (1, 'a@example.invalid', 'Before')")
    assert.equal((await first.query.children.findFirst())?.displayName, 'Before')
    await a.exec("UPDATE children SET display_name = 'After'")
    assert.equal((await database(a).query.children.findFirst())?.displayName, 'After')
    assert.equal(await database(b).query.children.findFirst(), undefined)
  } finally { a.sqlite.close(); b.sqlite.close() }
})

test('hot pool reads reuse compiled queries without caching balances or crossing children and days', async () => {
  const { poolBalance } = await import('./modules/time-pools.ts')
  const d1 = new IsolatedD1()
  try {
    await migrate(d1)
    await d1.exec("INSERT INTO children (id, email) VALUES (1, 'one@example.invalid'), (2, 'two@example.invalid')")
    const db = database(d1 as unknown as D1Database)
    const now = new Date('2026-09-17T18:00:00Z')
    const pool = await poolBalance(db, 1, 'pool:1:cartoon', now)
    assert.equal(pool.remainingSeconds, 1800)
    let prepared = 0
    const prepare = d1.prepare.bind(d1)
    d1.prepare = sql => { prepared++; return prepare(sql) }
    for (let i = 0; i < 20; i++) assert.equal((await poolBalance(db, 1, pool.id, now)).remainingSeconds, 1800)
    assert.equal(prepared, 0, 'steady-state reads must not rebuild SQL and row mappings')
    await d1.exec("INSERT INTO time_pool_usage (child_id, pool_id, viewing_day, used_seconds) VALUES (1, 'pool:1:cartoon', '2026-09-17', 1800)")
    const [first, second, tomorrow] = await Promise.all([
      poolBalance(db, 1, pool.id, now),
      poolBalance(db, 2, 'pool:2:cartoon', now),
      poolBalance(db, 1, pool.id, new Date('2026-09-18T18:00:00Z')),
    ])
    assert.equal(first.locked, true)
    assert.equal(second.remainingSeconds, 1800)
    assert.equal(tomorrow.remainingSeconds, 1800)
    await assert.rejects(() => poolBalance(db, 2, pool.id, now), /Time pool is no longer available/)
  } finally { d1.sqlite.close() }
})
