import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { requireInstance } from './cloudflare-instance.ts'

requireInstance()
// Build and deploy using the project’s cf configuration.
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/cf/bin/cf', import.meta.url)), 'deploy', ...process.argv.slice(2)], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
