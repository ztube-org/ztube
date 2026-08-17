import { createApp } from './app'
import { syncApprovedContent } from './utils/content-sync'

const app = createApp()

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncApprovedContent(env))
  },
}
