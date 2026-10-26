import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import Stripe from 'stripe'
import { createHttpServer } from './http-server.js'
import { createSqliteRepository } from './storage/sqlite-repository.js'

const WEBHOOK_SECRET = `whsec_${'a'.repeat(32)}`

function payload({
  id = 'evt_1',
  type = 'payment_intent.payment_failed',
  created = 1_700_000_000,
  paymentId = 'pi_1',
  failureCode = 'insufficient_funds',
} = {}) {
  const intent = {
    id: paymentId,
    object: 'payment_intent',
    amount: 2400,
    currency: 'usd',
    customer: 'cus_private',
  }
  if (type === 'payment_intent.payment_failed') {
    intent.last_payment_error = { code: failureCode }
  }
  return JSON.stringify({
    id,
    type,
    created,
    livemode: false,
    data: { object: intent },
  })
}

async function startServer(t) {
  const repository = createSqliteRepository({ dbPath: ':memory:' })
  const server = createHttpServer({
    webhookSecret: WEBHOOK_SECRET,
    repository,
    stripeClient: new Stripe('test-only'),
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    repository.close()
  })
  return `http://127.0.0.1:${address.port}`
}

async function postSigned(baseUrl, rawPayload, secret = WEBHOOK_SECRET) {
  const stripe = new Stripe('test-only')
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: rawPayload,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
  })
  return fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: rawPayload,
  })
}

test('verifies raw-body signatures, deduplicates, and serves sanitized cases/history', async (t) => {
  const baseUrl = await startServer(t)
  const rawPayload = payload()

  const invalid = await postSigned(baseUrl, rawPayload, 'whsec_wrong')
  assert.equal(invalid.status, 400)

  const first = await postSigned(baseUrl, rawPayload)
  const duplicate = await postSigned(baseUrl, rawPayload)
  assert.equal(first.status, 200)
  assert.deepEqual(await first.json(), {
    received: true,
    duplicate: false,
    paymentId: 'pi_1',
    status: 'open',
  })
  assert.deepEqual(await duplicate.json(), {
    received: true,
    duplicate: true,
    paymentId: 'pi_1',
    status: 'open',
  })

  const cases = await fetch(`${baseUrl}/api/cases`).then((response) => response.json())
  assert.equal(cases.length, 1)
  assert.equal('customer' in cases[0], false)

  const details = await fetch(`${baseUrl}/api/cases/pi_1`).then((response) => response.json())
  assert.equal(details.events.length, 1)
  assert.equal(details.events[0].details.failureCode, 'insufficient_funds')
  assert.equal(JSON.stringify(details).includes('cus_private'), false)
})

test('rejects signed malformed PaymentIntent data and acknowledges unsupported events', async (t) => {
  const baseUrl = await startServer(t)
  const malformed = JSON.stringify({
    id: 'evt_bad',
    type: 'payment_intent.payment_failed',
    created: 1_700_000_000,
    data: { object: { object: 'payment_intent', id: 'pi_bad' } },
  })
  const malformedResponse = await postSigned(baseUrl, malformed)
  assert.equal(malformedResponse.status, 400)

  const unsupported = await postSigned(baseUrl, payload({ type: 'customer.updated' }))
  assert.equal(unsupported.status, 200)
  assert.deepEqual(await unsupported.json(), { received: true, ignored: true })
})

test('rejects validly signed live-mode events', async (t) => {
  const baseUrl = await startServer(t)
  const livePayload = JSON.stringify({
    id: 'evt_live',
    type: 'payment_intent.payment_failed',
    created: 1_700_000_000,
    livemode: true,
    data: {
      object: {
        id: 'pi_live',
        object: 'payment_intent',
        amount: 2400,
        currency: 'usd',
        last_payment_error: { code: 'insufficient_funds' },
      },
    },
  })

  const response = await postSigned(baseUrl, livePayload)
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /Live-mode/)
})
