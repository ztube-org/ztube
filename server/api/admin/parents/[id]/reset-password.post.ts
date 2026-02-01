import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../../../database'
import { parents } from '../../../../database/schema'
import { hashPassword } from '../../../../utils/password'
import { requireRole } from '../../../../utils/auth'

const resetSchema = z.object({
  newPassword: z.string().min(8),
})

export default defineEventHandler(async (event) => {
  requireRole(event, ['superadmin'])
  const parentId = parseInt(getRouterParam(event, 'id') || '0')
  const body = await readBody(event)
  const { newPassword } = resetSchema.parse(body)

  const parent = await db.query.parents.findFirst({
    where: eq(parents.id, parentId),
  })

  if (!parent) {
    throw createError({ statusCode: 404, message: 'Parent not found' })
  }

  const passwordHash = await hashPassword(newPassword)
  await db.update(parents).set({ passwordHash }).where(eq(parents.id, parentId))

  return { success: true, message: `Password reset for ${parent.username}` }
})
