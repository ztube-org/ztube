import * as Iron from 'iron-webcrypto'
import type { H3Event } from 'h3'

const COOKIE_NAME = 'ztube_session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', async (event) => {
    const config = useRuntimeConfig()
    const password = config.sessionPassword

    if (!password || password.length < 32) {
      console.warn('Session password not set or too short')
      event.context.session = {}
      return
    }

    const cookie = getCookie(event, COOKIE_NAME)

    if (cookie) {
      try {
        const data = await Iron.unseal(globalThis.crypto, cookie, password, Iron.defaults)
        event.context.session = data as Record<string, unknown>
      } catch {
        event.context.session = {}
      }
    } else {
      event.context.session = {}
    }
  })
})

export async function setSession(event: H3Event, data: Record<string, unknown>) {
  const config = useRuntimeConfig()
  const password = config.sessionPassword

  const sealed = await Iron.seal(globalThis.crypto, data, password, Iron.defaults)

  setCookie(event, COOKIE_NAME, sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })

  event.context.session = data
}

export async function clearSession(event: H3Event) {
  deleteCookie(event, COOKIE_NAME)
  event.context.session = {}
}
