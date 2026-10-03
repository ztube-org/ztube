import { bindings, defineConfig, triggers } from 'cf/config'
import { instance } from './scripts/cloudflare-instance.ts'

export default defineConfig({
  accountId: instance.accountId || undefined,
  worker: {
    name: instance.workerName,
    entrypoint: './server/index.ts',
    compatibilityDate: '2026-08-16',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: false,
    previewUrls: false,
    observability: { enabled: true },
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: ['/api/*'] },
    domains: [instance.domain],
    triggers: [
      triggers.scheduled({ schedule: '*/30 * * * *' }),
      triggers.scheduled({ schedule: '5,35 * * * *' }),
    ],
    env: {
      AUTH_MODE: bindings.text('access' as string),
      ACCESS_ISSUER: bindings.text(instance.accessIssuer),
      ACCESS_AUD: bindings.text(instance.accessAud),
      LOCAL_DEV_USER_EMAIL: bindings.text('' as string),
      ADMIN_EMAILS: bindings.secret(),
      YOUTUBE_API_KEY: bindings.secret(),
      PROVIDER_ENCRYPTION_KEY: bindings.secret(),
      DB: bindings.d1({ id: instance.databaseId, name: instance.databaseName }),
      ASSETS: bindings.assets(),
    },
  },
})
