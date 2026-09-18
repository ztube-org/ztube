import { HTTPException } from 'hono/http-exception'
import { SaxesParser, type SaxesTagNS } from 'saxes'
import { httpsUrl, normalizePath, scopedPath, unseal, type Credentials, type Provider } from './provider-config.ts'

const fail = (message: string) => new HTTPException(502, { message })
const REDIRECTS = new Set([301, 302, 303, 307, 308])
const MAX_LIST_BYTES = 4_000_000
const MAX_FILES = 10_000
const PROPFIND = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>'
export type LibraryFile = { name: string; path: string; isDirectory: boolean; size: number; playable: boolean }

export function normalizeEndpoint(value: string) {
  const url = httpsUrl(value)
  if (url.search || url.hash) throw new HTTPException(400, { message: 'WebDAV URL must not contain a query or fragment' })
  // Decode once and re-encode segments: literal %, Unicode, # and ? remain file names.
  let path: string
  try { path = decodeURIComponent(url.pathname) } catch { throw new HTTPException(400, { message: 'Invalid WebDAV URL encoding' }) }
  path = normalizePath(path)
  url.pathname = path.split('/').map(encodeURIComponent).join('/') + (path === '/' ? '' : '/')
  return url.toString()
}
export function endpoint(provider: Provider) {
  return normalizeEndpoint(provider.webdavUrl ?? new URL('/dav/', provider.url).toString())
}
function fileUrl(provider: Provider, path: string, directory = false) {
  const base = new URL(endpoint(provider))
  const relative = scopedPath(provider, path).slice(1).split('/').map(encodeURIComponent).join('/')
  return new URL(relative + (directory && relative ? '/' : ''), base)
}
function withinBase(url: URL, base: URL) {
  return url.origin === base.origin && (url.pathname === base.pathname.slice(0, -1) || url.pathname.startsWith(base.pathname))
}
function redirectTarget(response: Response, current: URL) {
  const location = response.headers.get('location')
  if (!location) throw fail('WebDAV returned a redirect without a destination')
  let next: URL
  try { next = httpsUrl(new URL(location, current).toString()) } catch { throw fail('WebDAV returned an unsafe download redirect') }
  if (next.hostname.endsWith('.cloudflareaccess.com') || next.pathname.startsWith('/cdn-cgi/access/')) throw fail('Cloudflare Access requires service authentication. Check the custom headers and Service Auth policy.')
  next.hash = ''
  return next
}
async function credentialsHeaders(env: Env, provider: Provider) {
  if (!provider.enabled) throw new HTTPException(409, { message: 'Provider is disabled' })
  const credentials = await unseal<Credentials>(env, provider.id, provider.credentials)
  const bytes = new TextEncoder().encode(`${credentials.username}:${credentials.password}`)
  return { ...credentials.headers, Authorization: `Basic ${btoa(String.fromCharCode(...bytes))}` }
}
async function request(url: URL, init: RequestInit) {
  try { return await fetch(url, { ...init, redirect: 'manual' }) }
  catch { throw fail('Could not reach WebDAV. Check its URL, credentials and custom headers.') }
}
function responseError(response: Response) {
  if (response.status === 401 || response.status === 403) return fail('WebDAV access denied. Check the account’s WebDAV read permission, password and Cloudflare Access headers.')
  if (response.status === 404) return fail('WebDAV path not found. Check the endpoint and directory path.')
  return fail('WebDAV could not read this resource')
}

// Namespace-aware streaming XML, no DTDs/entities from external resources. Only
// successful DAV propstats are used, and hrefs must be immediate children.
export function parseDirectory(xml: string, requested: URL, base: URL, path: string): LibraryFile[] {
  type Properties = { status: string; directory?: boolean; size?: number }
  type Entry = { href: string; status: string; props: Properties[] }
  const stack: SaxesTagNS[] = []
  const files = new Map<string, LibraryFile>()
  let entry: Entry | undefined
  let props: Properties | undefined
  let text = ''
  let responses = 0
  const parser = new SaxesParser({ xmlns: true })
  const is = (tag: SaxesTagNS | undefined, name: string) => tag?.uri === 'DAV:' && tag.local === name
  const ok = (status: string) => /^HTTP\/\d(?:\.\d)? 2\d\d(?:\s|$)/.test(status.trim())
  parser.on('doctype', () => { throw fail('WebDAV XML must not contain a document type') })
  parser.on('opentag', tag => {
    stack.push(tag); text = ''
    if (stack.length === 1 && !is(tag, 'multistatus')) throw fail('WebDAV did not return a DAV directory listing. Check the endpoint and Access headers.')
    if (stack.length > 32) throw fail('WebDAV XML is too deeply nested')
    if (stack.length === 2 && is(tag, 'response')) {
      if (++responses > MAX_FILES + 1) throw fail('Directory is too large. Choose a smaller root directory.')
      entry = { href: '', status: '', props: [] }
    }
    if (entry && stack.length === 3 && is(tag, 'propstat')) props = { status: '' }
    if (props && is(tag, 'resourcetype') && is(stack.at(-2), 'prop')) props.directory = false
    if (props && is(tag, 'collection') && is(stack.at(-2), 'resourcetype')) props.directory = true
  })
  parser.on('text', value => { text += value })
  parser.on('cdata', value => { text += value })
  parser.on('closetag', tag => {
    if (entry && stack.length === 3 && is(tag, 'href')) entry.href = text.trim()
    if (entry && stack.length === 3 && is(tag, 'status')) entry.status = text.trim()
    if (props && stack.length === 4 && is(tag, 'status')) props.status = text.trim()
    if (props && is(tag, 'getcontentlength') && is(stack.at(-2), 'prop')) {
      const size = Number(text.trim())
      if (Number.isSafeInteger(size) && size >= 0) props.size = size
    }
    if (entry && props && stack.length === 3 && is(tag, 'propstat')) { entry.props.push(props); props = undefined }
    if (entry && stack.length === 2 && is(tag, 'response')) {
      if (entry.href && (!entry.status || ok(entry.status))) {
        let href: URL | undefined
        try { href = new URL(entry.href, requested) } catch { /* Ignore malformed hrefs. */ }
        if (href && !href.search && !href.hash && !href.username && !href.password && withinBase(href, base)) {
          let decoded: string | undefined
          try { decoded = decodeURIComponent(href.pathname.slice(base.pathname.length)) } catch { /* Invalid URI encoding. */ }
          if (decoded !== undefined) {
            try {
              const resource = normalizePath('/' + decoded)
              const parent = resource.slice(0, resource.lastIndexOf('/')) || '/'
              const successful = entry.props.filter(p => ok(p.status))
              const kind = successful.find(p => p.directory !== undefined)
              if (resource !== path && parent === path && kind) {
                const name = resource.slice(resource.lastIndexOf('/') + 1)
                files.set(resource, { path: resource, name, isDirectory: kind.directory!, size: successful.find(p => p.size !== undefined)?.size ?? 0, playable: !kind.directory && /\.mp4$/i.test(name) })
              }
            } catch { /* A malformed or escaping resource never enters the picker. */ }
          }
        }
      }
      entry = undefined
    }
    stack.pop(); text = ''
  })
  try { parser.write(xml).close() }
  catch (error) { if (error instanceof HTTPException) throw error; throw fail('WebDAV returned invalid directory XML') }
  return [...files.values()].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.path.localeCompare(b.path))
}
async function readXml(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw fail('WebDAV returned an empty directory listing')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let length = 0; let xml = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_LIST_BYTES) throw fail('Directory listing is too large. Choose a smaller root directory.')
      xml += decoder.decode(value, { stream: true })
    }
    return xml + decoder.decode()
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof HTTPException) throw error
    throw fail('WebDAV directory response was interrupted or is not UTF-8 XML')
  }
}
export async function listDirectory(env: Env, provider: Provider, path: string, page: number) {
  const base = new URL(endpoint(provider))
  let url = fileUrl(provider, path, true)
  const headers = { ...await credentialsHeaders(env, provider), Depth: '1', 'Content-Type': 'application/xml; charset=utf-8', Accept: 'application/xml, text/xml' }
  const signal = AbortSignal.timeout(20_000)
  for (let hop = 0; hop < 5; hop++) {
    const response = await request(url, { method: 'PROPFIND', headers, body: PROPFIND, signal })
    if (REDIRECTS.has(response.status)) {
      await response.body?.cancel()
      const next = redirectTarget(response, url)
      // Only canonical URL spelling may redirect a credentialed directory request.
      if (!withinBase(next, base) || next.search || decodeURIComponent(next.pathname).replace(/\/$/, '') !== decodeURIComponent(url.pathname).replace(/\/$/, '')) throw fail('WebDAV directory redirected outside its path. Check the endpoint and Cloudflare Access headers.')
      url = next; continue
    }
    if (response.status !== 207) { await response.body?.cancel(); throw responseError(response) }
    const files = parseDirectory(await readXml(response), url, base, normalizePath(path))
    return { files: files.slice((page - 1) * 100, page * 100), path: normalizePath(path), nextPage: page * 100 < files.length ? page + 1 : null }
  }
  throw fail('WebDAV directory redirected too many times')
}
export async function resolveMediaUrl(env: Env, provider: Provider, path: string) {
  const base = new URL(endpoint(provider))
  let url = fileUrl(provider, path)
  const auth = await credentialsHeaders(env, provider)
  const signal = AbortSignal.timeout(25_000)
  let authenticated = true
  const seen = new Set<string>()
  for (let hop = 0; hop < 8; hop++) {
    const key = `${authenticated}:${url}`
    if (seen.has(key)) throw fail('WebDAV download redirect loop detected')
    seen.add(key)
    const response = await request(url, { method: 'GET', headers: { ...(authenticated ? auth : {}), Range: 'bytes=0-0' }, signal })
    // Read headers only; do not download or buffer the movie, even when Range is ignored.
    await response.body?.cancel()
    if (REDIRECTS.has(response.status)) {
      url = redirectTarget(response, url)
      authenticated = authenticated && withinBase(url, base)
      continue
    }
    if (response.status !== 200 && response.status !== 206) {
      if (!authenticated && (response.status === 401 || response.status === 403)) throw fail('The download URL still requires authentication. Use WebDAV direct-redirect mode (302).')
      throw responseError(response)
    }
    if (authenticated) {
      // A plain WebDAV server may stream using Basic Auth. Only return a URL
      // after proving the browser can read it without our account or headers.
      authenticated = false; continue
    }
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!type.startsWith('video/') && !['application/octet-stream', 'binary/octet-stream', 'application/mp4'].includes(type)) throw fail('WebDAV download returned a login page or unsupported media response')
    return url.toString()
  }
  throw fail('WebDAV download redirected too many times')
}
