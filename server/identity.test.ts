import assert from 'node:assert/strict'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createApp } from './app.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'

test('Access verifies signed identity, application, issuer and expiration before creating profiles', async t => {
  const d1 = new IsolatedD1()
  await migrate(d1)
  t.after(() => d1.sqlite.close())
  const issuer = 'https://identity-test.cloudflareaccess.com'
  const audience = 'ztube-test-application'
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const other = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' }
  let keyRequests = 0
  t.mock.method(globalThis, 'fetch', async (url: URL | string) => {
    assert.equal(String(url), `${issuer}/cdn-cgi/access/certs`)
    keyRequests++
    return Response.json({ keys: [jwk] })
  })
  const env = { DB: d1, AUTH_MODE: 'access', ACCESS_ISSUER: issuer, ACCESS_AUD: audience, ADMIN_EMAILS: 'admin@example.com' } as unknown as Env
  const app = createApp()
  const request = (token?: string, overrides = {}) => app.request('https://ztube.example.com/api/auth/session', {
    headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.com', ...(token ? { 'Cf-Access-Jwt-Assertion': token } : {}) },
  }, { ...env, ...overrides })
  const now = Math.floor(Date.now() / 1000)
  const sign = (claims = {}, key = privateKey) => new SignJWT({
    email: 'child@example.com', iss: issuer, aud: [audience], iat: now - 10, exp: now + 600, ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key)

  assert.equal((await request()).status, 401, 'an email header alone cannot authenticate')
  assert.equal((await request('malformed')).status, 401)
  assert.equal((await request(await sign(), { ACCESS_AUD: '' })).status, 503)
  assert.equal((await request(await sign(), { ACCESS_ISSUER: 'https://untrusted.example.com' })).status, 503)
  for (const claims of [{ iss: 'https://other.cloudflareaccess.com' }, { aud: ['another-app'] }, { exp: now - 1 }, { exp: undefined }, { iat: undefined }, { iat: now + 600 }, { email: undefined }, { nbf: now + 600 }]) {
    assert.equal((await request(await sign(claims))).status, 401)
  }
  assert.equal((await request(await sign({}, other.privateKey))).status, 401)
  const symmetric = await new SignJWT({ email: 'admin@example.com', iss: issuer, aud: audience, iat: now, exp: now + 600 })
    .setProtectedHeader({ alg: 'HS256', kid: 'test-key' }).sign(new TextEncoder().encode('not-a-valid-access-signing-key'))
  assert.equal((await request(symmetric)).status, 401)
  assert.equal(d1.sqlite.prepare('SELECT count(*) AS count FROM children').get()?.count, 0)

  const response = await request(await sign())
  assert.equal(response.status, 200)
  const { user } = await response.json() as { user: { email: string; role: string } }
  assert.equal(user.email, 'child@example.com', 'signed email overrides a forged Admin header')
  assert.equal(user.role, 'non-admin')
  const admin = await request(await sign({ email: 'ADMIN@example.com' }))
  assert.equal((await admin.json() as { user: { role: string } }).user.role, 'admin')
  assert.equal(keyRequests, 1, 'public keys are cached across API requests')
})

test('local authentication rejects public hostnames', async t => {
  const d1 = new IsolatedD1()
  await migrate(d1)
  t.after(() => d1.sqlite.close())
  const env = { DB: d1, AUTH_MODE: 'local', LOCAL_DEV_USER_EMAIL: 'local@example.com' } as unknown as Env
  const app = createApp()
  assert.equal((await app.request('https://ztube.example.com/api/auth/session', {}, env)).status, 403)
  assert.equal((await app.request('http://localhost:5173/api/auth/session', {}, env)).status, 200)
  assert.equal((await app.request('http://127.0.0.1/api/auth/session', {}, env)).status, 200)
})
