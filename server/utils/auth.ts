import { H3Event } from 'h3'

export type UserRole = 'superadmin' | 'parent' | 'child'

export interface SessionUser {
  id: number | null
  username: string
  role: UserRole
}

export function getSessionUser(event: H3Event): SessionUser | null {
  const session = event.context.session
  if (!session?.user) return null
  return session.user as SessionUser
}

export function requireAuth(event: H3Event): SessionUser {
  const user = getSessionUser(event)
  if (!user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }
  return user
}

export function requireRole(event: H3Event, roles: UserRole[]): SessionUser {
  const user = requireAuth(event)
  if (!roles.includes(user.role)) {
    throw createError({ statusCode: 403, message: 'Forbidden' })
  }
  return user
}
