import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { instance, requireInstance } from './cloudflare-instance.ts'

const [operation, target, ...extra] = process.argv.slice(2)
if (!['migrate', 'list', 'clear'].includes(operation) || !['--local', '--remote'].includes(target) || extra.length) {
  throw new Error('Usage: node scripts/cloudflare-db.ts migrate|list|clear --local|--remote')
}
if (target === '--remote') requireInstance()
// Clear is invoked only after the shell wrapper's explicit confirmation.
const args = operation === 'clear'
  ? ['d1', 'query', instance.databaseId, '--sql', readFileSync(new URL('./clear-app-data.sql', import.meta.url), 'utf8')]
  : ['d1', 'migrations', operation === 'migrate' ? 'apply' : 'list', instance.databaseId, '--dir', 'migrations']
if (target === '--local') args.push('--local', '--persist-to', '.cloudflare/state')
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/cf/bin/cf', import.meta.url)), ...args], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
