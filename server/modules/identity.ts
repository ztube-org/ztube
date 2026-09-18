import { database } from '../database/client.ts'
import { eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import * as schema from '../database/schema.ts'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export type UserRole = 'admin' | 'non-admin'
export type CurrentUser = { id: number; email: string; displayName: string | null; avatarUrl?: string | null; role: UserRole }
export type AppEnv = { Bindings: Env; Variables: { user: CurrentUser } }

export async function resolveUser(request: Request, env: Env): Promise<CurrentUser> {
  const email = await identityEmail(request, env)
  const db = database(env.DB)
  let child = await db.query.children.findFirst({ where: eq(schema.children.email, email) })
  if (!child) {
    await db.insert(schema.children).values({ email }).onConflictDoNothing()
    child = await db.query.children.findFirst({ where: eq(schema.children.email, email) })
    if (child) await db.insert(schema.childTimeSettings).values({ childId: child.id }).onConflictDoNothing()
  }
  if (!child) throw new HTTPException(500, { message: 'Unable to create Child profile' })
  return { id: child.id, email, displayName: child.displayName, avatarUrl: child.avatarUrl, role: adminEmails(env).has(email) ? 'admin' : 'non-admin' }
}

export function adminEmails(env: Env) {
  return new Set((env.ADMIN_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
}

// Only public signing keys are cached; identities and tokens are request-local.
let signingKeys: { issuer: string; keys: ReturnType<typeof createRemoteJWKSet> } | undefined

async function identityEmail(request: Request, env: Env) {
  let value: unknown
  if (String(env.AUTH_MODE) === 'local') {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) {
      throw new HTTPException(403, { message: 'Local authentication is only available on loopback hosts' })
    }
    value = env.LOCAL_DEV_USER_EMAIL
  } else {
    const issuer = env.ACCESS_ISSUER?.replace(/\/$/, '')
    if (!issuer || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer) || !env.ACCESS_AUD) {
      throw new HTTPException(503, { message: 'Cloudflare Access verification is not configured' })
    }
    const token = request.headers.get('Cf-Access-Jwt-Assertion')
    if (!token) throw new HTTPException(401, { message: 'A valid Cloudflare Access session is required' })
    if (signingKeys?.issuer !== issuer) {
      signingKeys = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), { timeoutDuration: 5000 }) }
    }
    try {
      const { payload } = await jwtVerify(token, signingKeys.keys, {
        issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email'],
      })
      if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > Date.now() / 1000 + 5) {
        throw new Error('Invalid token issuance time')
      }
      value = payload.email
    } catch {
      // JWT errors may contain token contents; never return or log them.
      throw new HTTPException(401, { message: 'A valid Cloudflare Access session is required' })
    }
  }
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!email.includes('@')) throw new HTTPException(401, { message: 'A valid Cloudflare Access session is required' })
  return email
}

export function requireRole(user: CurrentUser, role: UserRole) {
  if (user.role !== role) throw new HTTPException(403, { message: 'Forbidden' })
  return user
}
