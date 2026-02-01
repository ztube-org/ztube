import { count, eq } from 'drizzle-orm'
import { db } from '../../database'
import { parents, children } from '../../database/schema'
import { requireRole } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  requireRole(event, ['superadmin'])

  const parentList = await db.query.parents.findMany()

  const parentsWithStats = await Promise.all(
    parentList.map(async (parent) => {
      const [childCount] = await db.select({ count: count() }).from(children).where(eq(children.parentId, parent.id))

      return {
        id: parent.id,
        username: parent.username,
        createdAt: parent.createdAt,
        childrenCount: childCount.count,
      }
    })
  )

  return { parents: parentsWithStats }
})
