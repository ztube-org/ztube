import { getSessionUser } from '~/server/utils/auth'

export default defineEventHandler((event) => {
  const user = getSessionUser(event)
  return { user }
})
