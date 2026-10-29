import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeStripeEvent } from './providers/stripe-adapter.js'

const fixturePath = fileURLToPath(new URL('../fixtures/payment-lifecycle.json', import.meta.url))

export function seedDemo(service) {
  const events = JSON.parse(readFileSync(fixturePath, 'utf8'))
  return events.map((event) => service.ingest(normalizeStripeEvent(event)))
}
