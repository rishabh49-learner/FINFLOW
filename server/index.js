import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHttpServer } from './http-server.js'
import { createRecoveryService } from './domain/recovery-service.js'
import { seedDemo } from './seed.js'
import { createSqliteRepository } from './storage/sqlite-repository.js'

const port = Number(process.env.PORT ?? 8787)
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
const demoMode = process.env.DEMO_MODE === 'true'

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.')
}
if (!webhookSecret && !demoMode) {
  throw new Error('Set STRIPE_WEBHOOK_SECRET before starting the backend.')
}

const repository = createSqliteRepository({
  dbPath: process.env.DATABASE_PATH ?? (demoMode ? ':memory:' : 'data/finflow.sqlite'),
})
const service = createRecoveryService(repository)
if (demoMode) seedDemo(service)

const staticDir = demoMode && existsSync(resolve('./dist'))
  ? resolve('./dist')
  : undefined
const server = createHttpServer({
  webhookSecret,
  repository,
  service,
  demoMode,
  staticDir,
})

server.listen(port, () => {
  console.log(`FINFLOW webhook server listening on http://localhost:${port}`)
})

function shutdown() {
  server.close(() => {
    repository.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
