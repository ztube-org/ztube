import { cleanupExpiredRemux } from './modules/jellyfin-remux.ts'
import { createApp } from './app.ts'
import { syncApprovedContent } from './utils/content-sync.ts'
import { expirePlaybackSessions } from './utils/playback-retention.ts'

const app = createApp()

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === '*/30 * * * *') {
      ctx.waitUntil(syncApprovedContent(env).then(result => {
        console.log(JSON.stringify({ event: 'approved_content_sync_completed', ...result }))
        if (result.failed) throw new Error(`Approved Content sync failed for ${result.failed} sources`)
      }))
    } else {
      // Separate invocation for playback cleanup; Jellyfin library imports are manual only.
      ctx.waitUntil(Promise.all([cleanupExpiredRemux(env), expirePlaybackSessions(env)]))
    }
  },
}
