import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { normalizeStripeEvent } from './providers/stripe-adapter.js'

const fixturePath = fileURLToPath(new URL('../fixtures/payment-lifecycle.json', import.meta.url))

function failureEvent({ id, created, paymentId, failureCode }) {
  return {
    id,
    type: 'payment_intent.payment_failed',
    created,
    livemode: false,
    data: {
      object: {
        id: paymentId,
        object: 'payment_intent',
        amount: 1299,
        currency: 'usd',
        last_payment_error: { code: failureCode },
      },
    },
  }
}

const demoEvents = [
  failureEvent({
    id: 'evt_demo_insufficient_funds',
    created: 1_793_000_000,
    paymentId: 'pi_demo_insufficient_funds',
    failureCode: 'insufficient_funds',
  }),
  failureEvent({
    id: 'evt_demo_authentication',
    created: 1_793_000_010,
    paymentId: 'pi_demo_authentication',
    failureCode: 'authentication_required',
  }),
  failureEvent({
    id: 'evt_demo_daily_limit',
    created: 1_793_000_020,
    paymentId: 'pi_demo_daily_limit',
    failureCode: 'transaction_daily_limit_exceeded',
  }),
  failureEvent({
    id: 'evt_demo_hard_decline',
    created: 1_793_000_030,
    paymentId: 'pi_demo_hard_decline',
    failureCode: 'fraudulent',
  }),
  failureEvent({
    id: 'evt_demo_unmapped',
    created: 1_793_000_040,
    paymentId: 'pi_demo_unmapped',
    failureCode: 'processor_specific_decline',
  }),
]

export function seedDemo(service) {
  const lifecycleEvents = JSON.parse(readFileSync(fixturePath, 'utf8'))
  const events = [...lifecycleEvents, ...demoEvents]
  return events.map((event) => service.ingest(normalizeStripeEvent(event)))
}
