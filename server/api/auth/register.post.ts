import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../database'
import { parents } from '../../database/schema'
import { hashPassword } from '../../utils/password'
import { setSession } from '../../plugins/session'
import type { SessionUser } from '../../utils/auth'

const registerSchema = z.object({
  invitationCode: z.string().min(1),
  username: z.string().min(3).max(50),
  password: z.string().min(8),
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { invitationCode, username, password } = registerSchema.parse(body)

  const config = useRuntimeConfig()

  // Verify invitation code
  if (invitationCode !== config.invitationCode) {
    throw createError({ statusCode: 400, message: 'Invalid invitation code' })
  }

  // Check username availability
  const existing = await db.query.parents.findFirst({
    where: eq(parents.username, username),
  })

  if (existing) {
    throw createError({ statusCode: 400, message: 'Username already exists' })
  }

  // Create parent account
  const passwordHash = await hashPassword(password)
  const [newParent] = await db.insert(parents).values({
    username,
    passwordHash,
  }).returning()

  // Auto-login
  const user: SessionUser = { id: newParent.id, username: newParent.username, role: 'parent' }
  await setSession(event, { user })

  return { success: true, redirect: '/parent/dashboard' }
})
