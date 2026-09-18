import { DatabaseSync } from 'node:sqlite'
import { readFile, readdir } from 'node:fs/promises'

export class IsolatedD1 {
  readonly sqlite = new DatabaseSync(':memory:')
  private pendingBatch: Promise<void> = Promise.resolve()
  prepare(sql: string) {
    const database = this.sqlite
    let values: unknown[] = []
    const statement = () => {
      if (values.length > 100) throw new Error('too many SQL variables')
      return database.prepare(sql)
    }
    const api = {
      bind(...bindings: unknown[]) { values = bindings; return api },
      async first<T>(column?: string) { const row = statement().get(...values) as Record<string, unknown> | undefined; return (column ? row?.[column] : row) as T | null ?? null },
      async all<T>() { return { success: true, results: statement().all(...values) as T[] } },
      async run() { const result = statement().run(...values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } },
      async raw<T>() { return statement().all(...values).map(row => Object.values(row)) as T[] },
    }
    return api
  }
  async batch(statements: ReturnType<IsolatedD1['prepare']>[]) {
    let release!: () => void
    const previous = this.pendingBatch
    this.pendingBatch = new Promise(resolve => { release = resolve })
    await previous
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    } finally {
      release()
    }
  }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 1, duration: 0 } }
  withSession() { return this }
}

export async function migrate(d1: IsolatedD1) {
  const directory = new URL('../../migrations/', import.meta.url)
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await d1.exec(await readFile(new URL(name, directory), 'utf8'))
  }
}
