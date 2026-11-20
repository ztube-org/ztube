import { HTTPException } from 'hono/http-exception'

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0))
async function key(env: Env) {
  if (!env.PROVIDER_ENCRYPTION_KEY) throw new HTTPException(503, { message: 'Jellyfin credential encryption is not configured' })
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
  } catch { throw new HTTPException(503, { message: 'Jellyfin credentials could not be decrypted' }) }
}
export function httpsUrl(value: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new HTTPException(400, { message: 'Use a public HTTPS URL' }) }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || host.includes(':') || /^[\d.]+$/.test(host)) throw new HTTPException(400, { message: 'Use a public HTTPS domain without embedded credentials' })
  return url
}
