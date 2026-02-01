import { clearSession } from '../../plugins/session'

export default defineEventHandler(async (event) => {
  await clearSession(event)
  return { success: true, redirect: '/login' }
})
