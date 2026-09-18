import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema.ts'

// Reuse only the stateless query builder for this binding, never query results,
// authorization decisions, or in-flight I/O. Rebuilding the relational schema
// several times per media request can exhaust a Worker's CPU budget.
const clients = new WeakMap<D1Database, ReturnType<typeof drizzle<typeof schema>>>()
export function database(binding: D1Database) {
  let client = clients.get(binding)
  if (!client) {
    client = drizzle(binding, { schema })
    clients.set(binding, client)
  }
  return client
}
