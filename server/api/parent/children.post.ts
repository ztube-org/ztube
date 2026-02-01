import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { children } from '~/server/database/schema'
import { hashPassword } from '~/server/utils/password'
import { requireRole } from '~/server/utils/auth'

const createChildSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(8),
  displayName: z.string().optional(),
})

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const body = await readBody(event)
  const { username, password, displayName } = createChildSchema.parse(body)

  // Check username availability
  const existing = await db.query.children.findFirst({
    where: eq(children.username, username),
  })

  if (existing) {
    throw createError({ statusCode: 400, message: 'Username already exists' })
  }

  const passwordHash = await hashPassword(password)
  const [newChild] = await db.insert(children).values({
    parentId: user.id!,
    username,
    passwordHash,
    displayName: displayName || null,
  }).returning()

  return {
    id: newChild.id,
    username: newChild.username,
    displayName: newChild.displayName,
  }
})
