import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Stripe from 'stripe'
import { createHttpServer } from './http-server.js'
import { createRecoveryService } from './domain/recovery-service.js'
import { seedDemo } from './seed.js'
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

async function startServer(t, options = {}) {
  const repository = createSqliteRepository({ dbPath: ':memory:' })
  const server = createHttpServer({
    webhookSecret: WEBHOOK_SECRET,
    repository,
    stripeClient: new Stripe('test-only'),
    ...options,
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

async function startDemoServer(t, options = {}) {
  return startServer(t, { webhookSecret: undefined, demoMode: true, ...options })
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
  assert.equal(cases[0].priority.level, 'standard')

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

test('demo mode starts without a webhook secret and disables webhook requests', async (t) => {
  const baseUrl = await startDemoServer(t)
  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok', demoMode: true })

  const webhook = await fetch(`${baseUrl}/webhook`, { method: 'POST' })
  assert.equal(webhook.status, 404)
  assert.deepEqual(await webhook.json(), { error: 'Webhook disabled' })
})

test('demo seeding keeps the lifecycle and adds five distinct payment cases', () => {
  const repository = createSqliteRepository({ dbPath: ':memory:' })
  const service = createRecoveryService(repository)
  try {
    seedDemo(service)
    const cases = service.listCases()
    const paymentIds = cases.map((recoveryCase) => recoveryCase.paymentId)
    assert.equal(cases.length, 6)
    assert.equal(new Set(paymentIds).size, 6)
    assert.equal(service.getCase('pi_demo_lifecycle').events.length, 3)
    assert.equal(service.getCase('pi_demo_lifecycle').recoveryCase.status, 'resolved')
    assert.equal(service.getCase('pi_demo_unmapped').recoveryCase.status, 'reconciliation_required')
    assert.equal(service.getCase('pi_demo_hard_decline').recoveryCase.failureCategory, 'hard_decline')
  } finally {
    repository.close()
  }
})

test('serves SPA fallback and rejects path traversal', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'finflow-static-'))
  const staticDir = join(directory, 'dist')
  mkdirSync(staticDir)
  writeFileSync(join(staticDir, 'index.html'), '<main>demo</main>')
  writeFileSync(join(directory, 'secret.txt'), 'not public')
  const contentTypes = {
    'app.js': 'text/javascript',
    'app.css': 'text/css',
    'icon.svg': 'image/svg+xml',
    'image.png': 'image/png',
    'favicon.ico': 'image/x-icon',
    'data.json': 'application/json',
  }
  for (const fileName of Object.keys(contentTypes)) {
    writeFileSync(join(staticDir, fileName), 'static')
  }
  t.after(() => rmSync(directory, { recursive: true, force: true }))

  const baseUrl = await startDemoServer(t, { staticDir })
  const fallback = await fetch(`${baseUrl}/cases/pi_1`)
  assert.equal(fallback.status, 200)
  assert.match(fallback.headers.get('content-type'), /text\/html/)
  assert.equal(await fallback.text(), '<main>demo</main>')

  for (const [fileName, expectedType] of Object.entries(contentTypes)) {
    const response = await fetch(`${baseUrl}/${fileName}`)
    assert.equal(response.status, 200)
    assert.ok(response.headers.get('content-type').startsWith(expectedType))
  }

  const traversal = await fetch(`${baseUrl}/%2e%2e%2fsecret.txt`)
  assert.equal(traversal.status, 404)
  assert.deepEqual(await traversal.json(), { error: 'Not found.' })
})

test('unknown API paths return JSON 404 and malformed paths do not kill the server', async (t) => {
  const baseUrl = await startDemoServer(t)
  const unknown = await fetch(`${baseUrl}/api/unknown`)
  assert.equal(unknown.status, 404)
  assert.deepEqual(await unknown.json(), { error: 'Not found.' })

  const malformed = await fetch(`${baseUrl}/%`)
  assert.equal(malformed.status, 400)

  const doubleSlash = await fetch(`${baseUrl}//`)
  assert.ok(doubleSlash.status >= 400 && doubleSlash.status < 500)

  const health = await fetch(`${baseUrl}/api/health`)
  assert.equal(health.status, 200)
})
