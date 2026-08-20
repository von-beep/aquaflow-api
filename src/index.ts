import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { ensurePlatformAdmin } from './db/ensurePlatformAdmin.js'
import { runMigrations } from './db/migrate.js'
import { adminRouter } from './routes/admin.js'
import { apiRouter } from './routes/api.js'
import { authRouter } from './routes/auth.js'
import { consumerAddressesRouter } from './routes/consumerAddresses.js'
import { consumerAuthRouter } from './routes/consumerAuth.js'
import { consumerChatRouter } from './routes/consumerChat.js'
import { consumerOrdersRouter } from './routes/consumerOrders.js'
import { healthRouter } from './routes/health.js'
import { publicInviteRouter } from './routes/invites.js'
import { geocodeRouter } from './routes/geocode.js'
import { publicCatalogRouter } from './routes/publicCatalog.js'
import { publicOrdersRouter } from './routes/publicOrders.js'
import { xenditWebhookRouter } from './routes/xenditWebhook.js'
import { UPLOADS_ROOT } from './lib/qrph.js'

const port = Number(process.env.PORT ?? 3001)

function corsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/$/, '')
  const defaults = [
    frontend,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
  ]
  return [...new Set([...fromEnv, ...defaults])]
}

export function createApp() {
  const app = express()

  app.use(
    cors({
      origin: corsOrigins(),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-callback-token'],
    }),
  )

  // Public webhooks before JSON parser is fine — body is JSON from Xendit
  app.use('/webhooks/xendit', express.json(), xenditWebhookRouter)

  // Larger limit for QR Ph / payment-proof data-URL uploads.
  app.use(express.json({ limit: '2mb' }))

  // Station QR Ph images (public)
  app.use('/uploads', express.static(UPLOADS_ROOT, { fallthrough: true, maxAge: '1h' }))

  // Public
  app.use(healthRouter)
  app.use('/auth', authRouter)
  app.use('/auth/invites', publicInviteRouter)
  app.use('/auth/consumer', consumerAuthRouter)
  app.use('/api/consumer', consumerOrdersRouter)
  app.use('/api/consumer', consumerAddressesRouter)
  app.use('/api/consumer', consumerChatRouter)
  app.use('/public', publicCatalogRouter)
  app.use('/public', publicOrdersRouter)
  app.use('/public/geocode', geocodeRouter)

  // Platform ops (Bearer + is_platform_admin)
  app.use('/admin', adminRouter)

  // Authenticated station API surface
  app.use('/api', apiRouter)

  return app
}

async function main(): Promise<void> {
  // Hostinger often starts entry file directly (skips npm start) — migrate on boot.
  await runMigrations()
  await ensurePlatformAdmin()
  const app = createApp()
  app.listen(port, () => {
    console.log(`Aquaflow-api listening on http://localhost:${port}`)
  })
}

void main().catch((err: unknown) => {
  console.error('Failed to start Aquaflow-api:', err)
  process.exit(1)
})
