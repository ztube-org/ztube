import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('Workers runtime: WebDAV XML browsing and Basic/custom header redirect isolation', async () => {
  const built = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts', contents: `
      import { seal } from './server/modules/provider-config.ts'
      import { listDirectory, resolveMediaUrl } from './server/modules/webdav-client.ts'
      export default { async fetch(request, env) {
        const provider = { id: 'runtime', name: 'DAV', url: 'https://dav.example.com',
          webdavUrl: 'https://dav.example.com/dav/', rootPath: '/', enabled: true, revision: 1, sessionToken: null,
          credentials: await seal(env, 'runtime', { username: 'user', password: 'password', headers: { 'X-ZTube-Access': 'access-secret' } }) }
        const directory = await listDirectory(env, provider, '/', 1)
        const url = await resolveMediaUrl(env, provider, directory.files[0].path)
        return Response.json({ directory, url })
      } }
    ` }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  })
  const seen: string[] = []
  const worker = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'webdav-test', modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-08-16', compatibilityFlags: ['nodejs_compat'],
    bindings: { PROVIDER_ENCRYPTION_KEY: btoa('01234567890123456789012345678901') },
    outboundService: async (request: Request) => {
      const url = new URL(request.url); seen.push(request.method + ' ' + url.origin)
      if (url.origin === 'https://dav.example.com') {
        assert.equal(request.headers.get('authorization'), 'Basic ' + btoa('user:password'))
        assert.equal(request.headers.get('X-ZTube-Access'), 'access-secret')
        if (request.method === 'PROPFIND') {
          assert.equal(request.headers.get('depth'), '1')
          return new Response('<multistatus xmlns="DAV:"><response><href>/dav/%E5%8A%A8%E7%94%BB.mp4</href><propstat><prop><resourcetype/><getcontentlength>100</getcontentlength></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>', { status: 207, headers: { 'content-type': 'application/xml' } })
        }
        return new Response(null, { status: 302, headers: { location: 'https://media.example.com/video.mp4?sign=test' } })
      }
      assert.equal(request.headers.get('authorization'), null)
      assert.equal(request.headers.get('X-ZTube-Access'), null)
      assert.equal(request.headers.get('range'), 'bytes=0-0')
      return new Response('x', { status: 206, headers: { 'content-type': 'video/mp4' } })
    },
  }] }))
  try {
    const response = await worker.dispatchFetch('http://localhost/')
    assert.equal(response.status, 200)
    const data = await response.json() as any
    assert.equal(data.directory.files[0].name, '动画.mp4')
    assert.equal(data.url, 'https://media.example.com/video.mp4?sign=test')
    assert.deepEqual(seen, ['PROPFIND https://dav.example.com', 'GET https://dav.example.com', 'GET https://media.example.com'])
  } finally { await worker.dispose() }
})
