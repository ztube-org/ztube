import assert from 'node:assert/strict'
import test from 'node:test'
import { endpoint, normalizeEndpoint, parseDirectory, listDirectory, resolveMediaUrl } from './modules/webdav-client.ts'
import { seal, type Provider } from './modules/provider-config.ts'

const env = { PROVIDER_ENCRYPTION_KEY: btoa('01234567890123456789012345678901') } as Env
const auth = { username: 'parent', password: 'secret', headers: { 'X-ZTube-Access': 'private' } }
async function provider(): Promise<Provider> {
  return { id: 'p1', url: 'https://dav.example.com', webdavUrl: 'https://dav.example.com/custom/dav/', rootPath: '/Cartoons', name: 'DAV', enabled: true, revision: 1, sessionToken: null, credentials: await seal(env, 'p1', auth) }
}
const base = new URL('https://dav.example.com/custom/dav/')
const requested = new URL('Cartoons/', base)
const entry = (href: string, kind = '<d:resourcetype/>', status = 'HTTP/1.1 200 OK') => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${kind}<d:getcontentlength>42</d:getcontentlength></d:prop><d:status>${status}</d:status></d:propstat></d:response>`
const listing = (...entries: string[]) => `<?xml version="1.0" encoding="UTF-8"?><d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`

test('PROPFIND parsing handles DAV namespaces, successful propstats, immediate children, UTF-8 and natural order', () => {
  const xml = listing(
    entry('/custom/dav/Cartoons/', '<d:resourcetype><d:collection/></d:resourcetype>'),
    entry('/custom/dav/Cartoons/Episode%2010.mp4'), entry('Episode%202.mp4'), entry('/custom/dav/Cartoons/Episode%201.mp4'),
    entry('/custom/dav/Cartoons/%E7%AC%AC%E4%B8%80%E5%AD%A3/', '<d:resourcetype><d:collection/></d:resourcetype>'),
    entry('/custom/dav/Cartoons/A%20%26%20B%23%3F%25.mp4'), entry('/custom/dav/Cartoons/notes.txt'),
    entry('/custom/dav/Cartoons/rejected.mp4', '<d:resourcetype/>', 'HTTP/1.1 403 Forbidden'),
    entry('/custom/dav/Other/not-approved.mp4'), entry('/custom/dav/Cartoons/nested/skip.mp4'),
    entry('https://foreign.example.com/custom/dav/Cartoons/leak.mp4'), entry('/custom/dav/Cartoons/%2e%2e/private.mp4'),
    entry('/custom/dav/Cartoons/malformed%GG.mp4'), entry('/custom/dav/Cartoons/%5cprivate.mp4'),
  )
  const files = parseDirectory(xml, requested, base, '/Cartoons')
  assert.equal(files[0].name, '第一季'); assert.equal(files[0].isDirectory, true)
  assert.deepEqual(files.filter(f => f.name.startsWith('Episode')).map(f => f.name), ['Episode 1.mp4', 'Episode 2.mp4', 'Episode 10.mp4'])
  assert.equal(files.find(f => f.name === 'A & B#?%.mp4')?.path, '/Cartoons/A & B#?%.mp4')
  assert.equal(files.length, 6); assert.equal(files.find(f => f.name === 'notes.txt')?.playable, false)
  assert.equal(files[1].size, 42)
  const defaultNS = '<multistatus xmlns="DAV:"><response><href>file.mp4</href><propstat><prop><resourcetype/></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>'
  assert.equal(parseDirectory(defaultNS, requested, base, '/Cartoons')[0].name, 'file.mp4')
  assert.throws(() => parseDirectory('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><multistatus xmlns="DAV:"/>', requested, base, '/Cartoons'))
  assert.throws(() => parseDirectory('<html>login</html>', requested, base, '/Cartoons'))
  assert.throws(() => parseDirectory('<d:multistatus xmlns:d="DAV:"><broken>', requested, base, '/Cartoons'))
})

test('WebDAV listing uses Basic Auth, custom headers and Depth 1, with bounded local pagination', async () => {
  const p = await provider(); const original = globalThis.fetch
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), requested.toString()); assert.equal(init?.method, 'PROPFIND'); assert.equal(init?.redirect, 'manual')
      const h = new Headers(init?.headers)
      assert.equal(h.get('depth'), '1'); assert.equal(h.get('X-ZTube-Access'), 'private')
      assert.equal(h.get('authorization'), 'Basic ' + btoa('parent:secret'))
      assert.ok(String(init?.body).includes('resourcetype'))
      return new Response(listing(...Array.from({ length: 105 }, (_, i) => entry(`Episode%20${105 - i}.mp4`))), { status: 207, headers: { 'content-type': 'application/xml' } })
    }
    const first = await listDirectory(env, p, '/Cartoons', 1)
    const second = await listDirectory(env, p, '/Cartoons', 2)
    assert.equal(first.files.length, 100); assert.equal(first.nextPage, 2); assert.equal(first.files[0].name, 'Episode 1.mp4')
    assert.equal(second.files.length, 5); assert.equal(second.nextPage, null); assert.equal(second.files[0].name, 'Episode 101.mp4')
    globalThis.fetch = async () => new Response('x'.repeat(4_000_001), { status: 207 })
    await assert.rejects(listDirectory(env, p, '/Cartoons', 1), /too large/)
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://foreign.example.com/dav/' } })
    await assert.rejects(listDirectory(env, p, '/Cartoons', 1), /redirected outside/)
  } finally { globalThis.fetch = original }
})

test('media resolution follows relative and cross-origin redirects without forwarding secrets, and cancels bodies', async () => {
  const p = await provider(); const original = globalThis.fetch
  const observed: Array<{ url: string; auth: string | null; access: string | null }> = []
  let cancelled = false
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input); const headers = new Headers(init?.headers)
      observed.push({ url, auth: headers.get('authorization'), access: headers.get('X-ZTube-Access') })
      assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'manual'); assert.equal(headers.get('range'), 'bytes=0-0')
      if (observed.length === 1) {
        assert.equal(url, 'https://dav.example.com/custom/dav/Cartoons/%E4%B8%AD%E6%96%87%20%23%3F%25.mp4')
        return new Response(null, { status: 302, headers: { location: '?download=1' } })
      }
      if (observed.length === 2) return new Response(null, { status: 307, headers: { location: 'https://onedrive.example.com/download?signature=a%2Bb' } })
      if (observed.length === 3) return new Response(null, { status: 302, headers: { location: 'https://dav.example.com/custom/dav/public.mp4?sign=1' } })
      return new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-type': 'application/octet-stream' } })
    }
    assert.equal(await resolveMediaUrl(env, p, '/Cartoons/中文 #?%.mp4'), 'https://dav.example.com/custom/dav/public.mp4?sign=1')
    assert.ok(observed[0].auth); assert.equal(observed[1].access, 'private')
    assert.equal(observed[2].auth, null); assert.equal(observed[2].access, null)
    assert.equal(observed[3].auth, null); assert.equal(observed[3].access, null, 'never reattach secrets after crossing the boundary')
    assert.equal(cancelled, true)
  } finally { globalThis.fetch = original }
})

test('ordinary WebDAV must prove anonymous playback; unsafe redirects, loops and Access login fail safely', async () => {
  const p = await provider(); const original = globalThis.fetch
  try {
    globalThis.fetch = async (_url, init) => new Headers(init?.headers).has('Authorization')
      ? new Response('video', { headers: { 'content-type': 'video/mp4' } }) : new Response(null, { status: 401 })
    await assert.rejects(resolveMediaUrl(env, p, '/Cartoons/a.mp4'), /requires authentication/)
    globalThis.fetch = async () => new Response('video', { headers: { 'content-type': 'video/mp4' } })
    assert.equal(await resolveMediaUrl(env, p, '/Cartoons/a.mp4'), 'https://dav.example.com/custom/dav/Cartoons/a.mp4')
    for (const location of ['http://plain.example.com/a', 'https://user:secret@host.example.com/a', 'https://127.0.0.1/a']) {
      globalThis.fetch = async () => new Response(null, { status: 302, headers: { location } })
      await assert.rejects(resolveMediaUrl(env, p, '/Cartoons/a.mp4'), /unsafe/)
    }
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/' } })
    await assert.rejects(resolveMediaUrl(env, p, '/Cartoons/a.mp4'), /Cloudflare Access/)
    globalThis.fetch = async url => new Response(null, { status: 302, headers: { location: String(url) } })
    await assert.rejects(resolveMediaUrl(env, p, '/Cartoons/a.mp4'), /loop/)
    globalThis.fetch = async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } })
    await assert.rejects(resolveMediaUrl(env, p, '/Cartoons/a.mp4'), /login page/)
    assert.equal(endpoint({ ...p, webdavUrl: null }), 'https://dav.example.com/dav/')
    assert.equal(normalizeEndpoint('https://dav.example.com/remote.php/dav/files/user'), 'https://dav.example.com/remote.php/dav/files/user/')
  } finally { globalThis.fetch = original }
})
