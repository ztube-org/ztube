import { database } from '../database/client.ts'
import { HTTPException } from 'hono/http-exception'
import { eq } from 'drizzle-orm'
import * as schema from '../database/schema.ts'

export type Provider = typeof schema.mediaProviders.$inferSelect
export type Credentials = { username: string; password: string; directoryPassword?: string; headers: Record<string, string> }
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
async function key(env: Env) {
  if (!env.PROVIDER_ENCRYPTION_KEY) throw new HTTPException(503, { message: 'Provider encryption is not configured' })
  return crypto.subtle.importKey('raw', decode(env.PROVIDER_ENCRYPTION_KEY), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function seal(env: Env, id: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(id) }, await key(env), new TextEncoder().encode(JSON.stringify(value)))
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`
}
export async function unseal<T>(env: Env, id: string, value: string): Promise<T> {
  try {
    const [iv, data] = value.split('.')
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(id) }, await key(env), decode(data))))
  } catch { throw new HTTPException(503, { message: 'Provider credentials could not be decrypted' }) }
}
export function httpsUrl(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new HTTPException(400, { message: 'Use a public HTTPS URL' }) }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || host.includes(':') || /^[\d.]+$/.test(host)) throw new HTTPException(400, { message: 'Use a public HTTPS domain without embedded credentials' })
  return url
}
export function normalizePath(path: string) {
  if (!path.startsWith('/') || ([...path].some(char => char.charCodeAt(0) < 32) || path.includes('\\')) || path.split('/').some(p => p === '.' || p === '..')) throw new HTTPException(400, { message: 'Invalid library path' })
  return '/' + path.split('/').filter(Boolean).join('/')
}
export function scopedPath(provider: Provider, path: string) {
  const normalized = normalizePath(path)
  if (provider.rootPath !== '/' && normalized !== provider.rootPath && !normalized.startsWith(provider.rootPath + '/')) throw new HTTPException(403, { message: 'Path is outside this Provider’s root directory' })
  return normalized
}
export function validateHeaders(headers: Record<string, string>) {
  const names = new Set<string>()
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || /[\r\n]/.test(value) || names.has(lower) || ['authorization', 'host', 'cookie', 'content-type', 'content-length', 'connection', 'transfer-encoding', 'proxy-authorization', 'accept', 'range', 'depth', 'destination', 'if'].includes(lower)) throw new HTTPException(400, { message: 'Invalid or reserved authentication header name' })
    names.add(lower)
  }
}
export async function getProvider(env: Env, id: string) {
  const row = await database(env.DB).query.mediaProviders.findFirst({ where: eq(schema.mediaProviders.id, id) })
  if (!row) throw new HTTPException(404, { message: 'Provider not found' })
  return row
}

