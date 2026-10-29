import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Stripe from 'stripe'
import { createHttpServer } from '../server/http-server.js'
import { createSqliteRepository } from '../server/storage/sqlite-repository.js'

const fixturePath = fileURLToPath(new URL('../fixtures/payment-lifecycle.json', import.meta.url))
const fixtureEvents = JSON.parse(await readFile(fixturePath, 'utf8'))
const webhookSecret = `whsec_${randomBytes(32).toString('hex')}`
const stripe = new Stripe(randomBytes(32).toString('hex'))
const repository = createSqliteRepository({ dbPath: ':memory:' })
const server = createHttpServer({ webhookSecret, repository, stripeClient: stripe })

server.listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

try {
  for (const event of fixtureEvents) {
    const body = JSON.stringify(event)
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: webhookSecret,
      timestamp: Math.floor(Date.now() / 1000),
    })
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body,
    })
    const result = await response.json()
    if (!response.ok) throw new Error(`Demo event rejected: ${JSON.stringify(result)}`)
    console.log(`${event.type}: ${JSON.stringify(result)}`)
  }

  const details = await fetch(`${baseUrl}/api/cases/pi_demo_lifecycle`).then((response) => response.json())
  console.log(JSON.stringify(details, null, 2))
} finally {
  await new Promise((resolve) => server.close(resolve))
  repository.close()
}
