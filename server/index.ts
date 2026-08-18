import { createApp } from './app'
import { syncApprovedContent } from './utils/content-sync'
import { expirePlaybackSessions } from './utils/playback-retention'

const app = createApp()

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([syncApprovedContent(env), expirePlaybackSessions(env)]))
  },
}
