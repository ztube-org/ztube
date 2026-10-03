import { existsSync, readFileSync } from 'node:fs'

const local = new URL('../cloudflare.instance.json', import.meta.url)
const example = new URL('../cloudflare.instance.example.json', import.meta.url)
export const instance: {
  accountId: string; workerName: string; domain: string; databaseId: string
  databaseName: string; accessIssuer: string; accessAud: string
} = JSON.parse(readFileSync(existsSync(local) ? local : example, 'utf8'))

export function requireInstance() {
  if (!existsSync(local) || !/^[a-f0-9]{32}$/i.test(instance.accountId)
    || !instance.databaseId || instance.databaseId === '00000000-0000-0000-0000-000000000000'
    || !instance.domain || instance.domain.endsWith('.example.com')
    || !instance.accessIssuer || instance.accessIssuer.includes('your-team')
    || !instance.accessAud || instance.accessAud.startsWith('REPLACE_')) {
    throw new Error('Configure cloudflare.instance.json from cloudflare.instance.example.json before accessing production.')
  }
  return instance
}
