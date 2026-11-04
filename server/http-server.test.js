import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import Stripe from 'stripe'
import { createHttpServer } from './http-server.js'
import { createRecoveryService } from './domain/recovery-service.js'
import { normalizeStripeEvent } from './providers/stripe-adapter.js'
import { seedDemo } from './seed.js'
import { createSqliteRepository } from './storage/sqlite-repository.js'

const WEBHOOK_SECRET = `whsec_${'a'.repeat(32)}`

function payload({
  id = 'evt_1',
  type = 'payment_intent.payment_failed',
  created = 1_700_000_000,
  paymentId = 'pi_1',
  failureCode = 'insufficient_funds',
  customerId = 'cus_private',
} = {}) {
  const intent = {
    id: paymentId,
    object: 'payment_intent',
    amount: 2400,
    currency: 'usd',
    customer: customerId,
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
  const repository = options.repository ?? createSqliteRepository({ dbPath: ':memory:' })
  const ownsRepository = !options.repository
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
    if (ownsRepository) repository.close()
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
  assert.equal(cases[0].customerId, 'cus_private')
  assert.deepEqual(Object.keys(cases[0]).sort(), [
    'amount',
    'currency',
    'customerId',
    'failureCategory',
    'failureCode',
    'paymentId',
    'priority',
    'recommendationReason',
    'recommendedAction',
    'reconciliationReason',
    'status',
    'updatedAt',
  ])
  assert.equal(cases[0].priority.level, 'standard')

  const details = await fetch(`${baseUrl}/api/cases/pi_1`).then((response) => response.json())
  assert.equal(details.events.length, 1)
  assert.equal(details.events[0].details.failureCode, 'insufficient_funds')
  assert.equal(details.events[0].details.customerId, 'cus_private')
  assert.deepEqual(Object.keys(details.events[0].details).sort(), [
    'amount',
    'chargeId',
    'currency',
    'customerId',
    'failureCode',
  ])
})

test('retains the latest non-null customerId when a later event has none', async (t) => {
  const baseUrl = await startServer(t)
  const first = await postSigned(baseUrl, payload({
    id: 'evt_customer',
    paymentId: 'pi_customer',
    customerId: 'cus_retained',
  }))
  const later = await postSigned(baseUrl, payload({
    id: 'evt_customer_missing',
    created: 1_700_000_001,
    paymentId: 'pi_customer',
    customerId: null,
  }))
  assert.equal(first.status, 200)
  assert.equal(later.status, 200)

  const cases = await fetch(`${baseUrl}/api/cases`).then((response) => response.json())
  assert.equal(cases.length, 1)
  assert.equal(cases[0].customerId, 'cus_retained')
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

async function postDemo(baseUrl, body, headers = {}) {
  return fetch(`${baseUrl}/api/demo/play`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

async function waitForCase(baseUrl, paymentId, expectedEvents) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/cases/${encodeURIComponent(paymentId)}`)
    if (response.ok) {
      const details = await response.json()
      if (details.events.length === expectedEvents) return details
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail(`Timed out waiting for ${expectedEvents} events for ${paymentId}`)
}

test('each demo scenario emits its expected recovery case', async (t) => {
  const baseUrl = await startDemoServer(t, { demoDelayScale: 0 })
  const scenarios = [
    { scenario: 'insufficient-funds-then-paid', status: 'resolved', events: 3, failures: 2 },
    { scenario: 'generic-decline', status: 'open', events: 1, failures: 1 },
    { scenario: 'authentication-required', status: 'open', events: 1, failures: 1 },
    { scenario: 'lost-card', status: 'open', events: 1, failures: 1 },
  ]

  for (const expected of scenarios) {
    const response = await postDemo(baseUrl, { scenario: expected.scenario })
    assert.equal(response.status, 202)
    const started = await response.json()
    assert.match(started.paymentId, /^pi_sim_/)
    const details = await waitForCase(baseUrl, started.paymentId, expected.events)
    assert.equal(details.recoveryCase.status, expected.status)
    assert.equal(details.events.filter((event) =>
      event.eventType.endsWith('payment_failed')).length, expected.failures)
    const chargeIds = details.events.map((event) => event.details.chargeId)
    assert.equal(chargeIds.every((chargeId) => chargeId.startsWith('ch_sim_')), true)
    assert.equal(new Set(chargeIds).size, expected.events)
    const failedChargeIds = details.events
      .filter((event) => event.eventType.endsWith('payment_failed'))
      .map((event) => event.details.chargeId)
    assert.equal(failedChargeIds.every((chargeId) => chargeId.startsWith('ch_sim_')), true)
    assert.equal(new Set(failedChargeIds).size, expected.failures)
    if (expected.scenario === 'generic-decline') {
      assert.equal(details.recoveryCase.failureCode, 'generic_decline')
      assert.equal(details.recoveryCase.failureCategory, 'soft_decline')
    }
    if (expected.scenario === 'authentication-required') {
      assert.equal(details.recoveryCase.failureCode, 'authentication_required')
      assert.equal(details.recoveryCase.failureCategory, 'hard_decline')
      assert.equal(details.recoveryCase.priority.level, 'high')
    }
    if (expected.scenario === 'lost-card') {
      assert.equal(details.recoveryCase.failureCode, 'lost_card')
      assert.equal(details.recoveryCase.failureCategory, 'hard_decline')
    }
  }
})

test('out-of-order demo scenario supports default and explicit delivery-order settings', async (t) => {
  const baseUrl = await startDemoServer(t, { demoDelayScale: 0 })
  const results = []

  for (const outOfOrder of [undefined, false, true]) {
    const body = { scenario: 'success-then-failure' }
    if (outOfOrder !== undefined) body.outOfOrder = outOfOrder
    const response = await postDemo(baseUrl, body)
    assert.equal(response.status, 202)
    const started = await response.json()
    const details = await waitForCase(baseUrl, started.paymentId, 2)
    results.push({
      status: details.recoveryCase.status,
      failureCode: details.recoveryCase.failureCode,
      recommendedAction: details.recoveryCase.recommendedAction,
    })
  }

  assert.equal(results[0].status, 'reconciliation_required')
  assert.deepEqual(results[1], results[0])
  assert.deepEqual(results[2], results[0])
})

test('demo simulator routes return 404 outside demo mode', async (t) => {
  const baseUrl = await startServer(t)

  const scenarios = await fetch(`${baseUrl}/api/demo/scenarios`)
  const play = await postDemo(baseUrl, { scenario: 'lost-card' })
  const reset = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' })

  assert.equal(scenarios.status, 404)
  assert.equal(play.status, 404)
  assert.equal(reset.status, 404)
})

test('lists demo scenarios using only id, title, and description', async (t) => {
  const baseUrl = await startDemoServer(t)

  const response = await fetch(`${baseUrl}/api/demo/scenarios`)
  assert.equal(response.status, 200)
  const scenarios = await response.json()
  assert.equal(scenarios.length, 5)
  assert.deepEqual(Object.keys(scenarios[0]).sort(), ['description', 'id', 'title'])
  assert.deepEqual(scenarios[0], {
    id: 'insufficient-funds-then-paid',
    title: 'Pays on its own',
    description: 'A payment succeeds after two insufficient-funds failures.',
  })
})

test('limits play requests per forwarded client IP and reports seconds to wait', async (t) => {
  let now = 1_800_000_000_000
  const baseUrl = await startDemoServer(t, {
    demoDelayScale: 0,
    trustProxyHops: 1,
    now: () => now,
  })
  const forwardedIp = '198.51.100.27'

  for (let request = 0; request < 10; request += 1) {
    const response = await postDemo(baseUrl, { scenario: 'lost-card' }, {
      'x-forwarded-for': forwardedIp,
    })
    assert.equal(response.status, 202)
  }

  const limited = await postDemo(baseUrl, { scenario: 'lost-card' }, {
    'x-forwarded-for': forwardedIp,
  })
  assert.equal(limited.status, 429)
  const body = await limited.json()
  assert.equal(Number.isInteger(body.retryAfterSeconds), true)
  assert.ok(body.retryAfterSeconds > 0)
  assert.match(body.error, new RegExp(`${body.retryAfterSeconds} seconds`))
  assert.equal(limited.headers.get('retry-after'), String(body.retryAfterSeconds))

  now += 60_001
  const afterWindow = await postDemo(baseUrl, { scenario: 'lost-card' }, {
    'x-forwarded-for': forwardedIp,
  })
  assert.equal(afterWindow.status, 202)

  const otherIp = await postDemo(baseUrl, { scenario: 'lost-card' }, {
    'x-forwarded-for': '198.51.100.28',
  })
  assert.equal(otherIp.status, 202)
})

test('reset cancels a pending demo delivery timer', async (t) => {
  const scheduledTimers = []
  const cancelledTimers = []
  const baseUrl = await startDemoServer(t, {
    demoDelayScale: 0,
    demoScheduleTimer: (callback) => {
      scheduledTimers.push(callback)
      return scheduledTimers.length
    },
    demoCancelTimer: (timerId) => cancelledTimers.push(timerId),
  })
  const play = await postDemo(baseUrl, { scenario: 'generic-decline' })
  assert.equal(play.status, 202)
  const started = await play.json()

  for (let attempt = 0; attempt < 50 && scheduledTimers.length === 0; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.equal(scheduledTimers.length, 1)

  const reset = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' })
  assert.equal(reset.status, 200)
  assert.deepEqual(cancelledTimers, [1])
  const caseResponse = await fetch(`${baseUrl}/api/cases/${started.paymentId}`)
  assert.equal(caseResponse.status, 404)
})

test('caps simulator cases and reset preserves non-simulator cases and events', async (t) => {
  let timestamp = 1_700_000_000
  const repository = createSqliteRepository({
    dbPath: ':memory:',
    clock: () => new Date(timestamp++ * 1000).toISOString(),
  })
  t.after(() => repository.close())
  const service = createRecoveryService(repository)
  seedDemo(service)
  const seededDemoIds = service.listCases()
    .map((recoveryCase) => recoveryCase.paymentId)
    .filter((paymentId) => paymentId.startsWith('pi_demo_'))
  const baseUrl = await startDemoServer(t, {
    repository,
    demoDelayScale: 0,
  })
  assert.equal(seededDemoIds.length, 4)

  function ingestFailure(eventId, paymentId, created) {
    const stripeEvent = {
      id: eventId,
      type: 'payment_intent.payment_failed',
      created,
      livemode: false,
      data: {
        object: {
          id: paymentId,
          object: 'payment_intent',
          amount: 1000,
          currency: 'usd',
          last_payment_error: { code: 'insufficient_funds' },
        },
      },
    }
    service.ingest(normalizeStripeEvent(stripeEvent))
  }

  ingestFailure('evt_keep', 'pi_keep', 1_700_000_000)
  for (let index = 0; index < 50; index += 1) {
    ingestFailure(`evt_sim_seed_${index}`, `pi_sim_seed_${index}`, 1_700_000_001 + index)
  }

  const play = await postDemo(baseUrl, { scenario: 'lost-card' })
  assert.equal(play.status, 202)
  const started = await play.json()
  await waitForCase(baseUrl, started.paymentId, 1)

  const simulatorCases = repository.listCases()
    .filter((recoveryCase) => recoveryCase.paymentId.startsWith('pi_sim_'))
  assert.equal(simulatorCases.length, 50)
  assert.equal(repository.getCase('pi_sim_seed_0'), null)

  const reset = await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' })
  assert.equal(reset.status, 200)
  const resetResult = await reset.json()
  assert.equal(resetResult.reset, true)
  assert.equal(resetResult.removedCases, 50)
  assert.equal(repository.getCase('pi_sim_seed_1'), null)
  assert.equal(repository.getCase(started.paymentId), null)
  assert.ok(seededDemoIds.every((paymentId) => repository.getCase(paymentId)))
  assert.ok(repository.getCase('pi_keep'))
  assert.equal(repository.listEvents('pi_keep').length, 1)
  assert.equal(repository.listEvents('pi_sim_seed_1').length, 0)
})

test('demo seeding creates four dated, varied scenario cases with Reset-safe IDs', () => {
  const repository = createSqliteRepository({ dbPath: ':memory:' })
  const service = createRecoveryService(repository)
  const now = Date.parse('2026-11-04T04:28:30+05:30')
  try {
    seedDemo(service, { now })
    const cases = service.listCases()
    const paymentIds = cases.map((recoveryCase) => recoveryCase.paymentId)
    assert.equal(cases.length, 4)
    assert.equal(new Set(paymentIds).size, 4)
    assert.ok(paymentIds.every((paymentId) => /^pi_demo_[0-9a-f]{8}$/.test(paymentId)))

    const seeded = cases.map((recoveryCase) => service.getCase(recoveryCase.paymentId))
    const eventGroups = seeded.map((item) => item.events)
    const events = eventGroups.flat()
    const firstEvents = eventGroups.map((group) => group[0])
    const stripeDeclineCodes = new Set([
      'insufficient_funds',
      'generic_decline',
      'authentication_required',
      'lost_card',
    ])
    assert.ok(events.every((event) => /^evt_demo_[0-9a-f]{8}$/.test(event.eventId)))
    assert.ok(events.every((event) => event.details.failureCode === null
      || stripeDeclineCodes.has(event.details.failureCode)))
    assert.ok(events.every((event) =>
      new Date(event.providerCreated * 1000).toISOString().slice(0, 10)
      === new Date(now).toISOString().slice(0, 10)))
    assert.equal(events.length, 6)
    assert.equal(new Set(firstEvents.map((event) => event.details.amount)).size, 4)
    assert.equal(new Set(firstEvents.map((event) => event.details.currency)).size, 4)
    assert.ok(events.every((event) => /^cus_demo_[0-9a-f]{8}$/.test(event.details.customerId)))
    assert.deepEqual(
      Object.values(firstEvents.reduce((counts, event) => {
        counts[event.details.customerId] = (counts[event.details.customerId] ?? 0) + 1
        return counts
      }, {})).sort(),
      [1, 1, 2],
    )
    assert.equal(cases.filter((recoveryCase) =>
      recoveryCase.status === 'reconciliation_required').length, 0)
    assert.ok(cases.some((recoveryCase) => recoveryCase.failureCode === 'generic_decline'))
    assert.ok(cases.some((recoveryCase) => recoveryCase.status === 'resolved'))

    assert.equal(repository.resetSimulatorData(), 0)
    assert.equal(service.listCases().length, 4)
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
