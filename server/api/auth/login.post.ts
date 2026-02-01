import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { parents, children } from '../../database/schema'
import { verifyPassword } from '../../utils/password'
import { setSession } from '../../plugins/session'
import type { SessionUser } from '../../utils/auth'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { username, password } = loginSchema.parse(body)

  const config = useRuntimeConfig()

  // Check superadmin
  if (username === 'superadmin') {
    if (password === config.superadminPassword) {
      const user: SessionUser = { id: null, username: 'superadmin', role: 'superadmin' }
      await setSession(event, { user })
      return { success: true, redirect: '/admin' }
    }
    throw createError({ statusCode: 401, message: 'Invalid credentials' })
  }

  // Check parents
  const parent = await db.query.parents.findFirst({
    where: eq(parents.username, username),
  })

  if (parent && await verifyPassword(password, parent.passwordHash)) {
    const user: SessionUser = { id: parent.id, username: parent.username, role: 'parent' }
    await setSession(event, { user })
    return { success: true, redirect: '/parent/dashboard' }
  }

  // Check children
  const child = await db.query.children.findFirst({
    where: eq(children.username, username),
  })

  if (child && await verifyPassword(password, child.passwordHash)) {
    const user: SessionUser = { id: child.id, username: child.username, role: 'child' }
    await setSession(event, { user })
    return { success: true, redirect: '/browse' }
  }

  throw createError({ statusCode: 401, message: 'Invalid credentials' })
})
