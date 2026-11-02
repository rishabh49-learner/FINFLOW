import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeStripeEvent } from '../providers/stripe-adapter.js'
import { createRecoveryService } from './recovery-service.js'
import { createSqliteRepository } from '../storage/sqlite-repository.js'

function stripeEvent({
  id = 'evt_1',
  type = 'payment_intent.payment_failed',
  created = 1_700_000_000,
  paymentId = 'pi_1',
  amount = 2400,
  currency = 'usd',
  failureCode = 'insufficient_funds',
} = {}) {
  const intent = {
    id: paymentId,
    object: 'payment_intent',
    amount,
    currency,
  }
  if (type === 'payment_intent.payment_failed') {
    intent.last_payment_error = { code: failureCode }
  }
  return { id, type, created, livemode: false, data: { object: intent } }
}

function createTestService() {
  let receivedSequence = 0
  const repository = createSqliteRepository({
    dbPath: ':memory:',
    clock: () => `2026-10-25T12:00:${String(receivedSequence++).padStart(2, '0')}.000Z`,
  })
  return {
    repository,
    service: createRecoveryService(repository),
    ingest(event) {
      return createRecoveryService(repository).ingest(normalizeStripeEvent(event))
    },
  }
}

test('duplicate delivery is acknowledged without adding history or another case', () => {
  const { repository, ingest, service } = createTestService()
  try {
    assert.equal(ingest(stripeEvent()).duplicate, false)
    assert.equal(ingest(stripeEvent()).duplicate, true)
    assert.equal(service.listCases().length, 1)
    assert.equal(service.getCase('pi_1').events.length, 1)
  } finally {
    repository.close()
  }
})

test('two distinct failures update one case without treating deliveries as attempts', () => {
  const { repository, ingest, service } = createTestService()
  try {
    ingest(stripeEvent())
    const updated = ingest(stripeEvent({
      id: 'evt_2',
      created: 1_700_000_010,
      failureCode: 'authentication_required',
    }))

    assert.equal(updated.case.paymentId, 'pi_1')
    assert.equal(service.listCases().length, 1)
    assert.equal(service.getCase('pi_1').events.length, 2)
    assert.equal(service.getCase('pi_1').recoveryCase.failureCode, 'authentication_required')
  } finally {
    repository.close()
  }
})

test('success resolves the existing case while keeping the event log', () => {
  const { repository, ingest, service } = createTestService()
  try {
    ingest(stripeEvent())
    ingest(stripeEvent({
      id: 'evt_success',
      type: 'payment_intent.succeeded',
      created: 1_700_000_010,
    }))

    const details = service.getCase('pi_1')
    assert.equal(details.recoveryCase.status, 'resolved')
    assert.equal(details.events.length, 2)
    assert.equal(details.recoveryCase.amount, 2400)
  } finally {
    repository.close()
  }
})

test('separate PaymentIntents create separate cases', () => {
  const { repository, ingest, service } = createTestService()
  try {
    ingest(stripeEvent())
    ingest(stripeEvent({ id: 'evt_2', paymentId: 'pi_2' }))

    assert.deepEqual(
      service.listCases().map((recoveryCase) => recoveryCase.paymentId).sort(),
      ['pi_1', 'pi_2'],
    )
  } finally {
    repository.close()
  }
})

test('late older events remain in history but cannot overwrite a newer projection', () => {
  const { repository, ingest, service } = createTestService()
  try {
    ingest(stripeEvent({
      id: 'evt_success',
      type: 'payment_intent.succeeded',
      created: 1_700_000_010,
    }))
    ingest(stripeEvent({ id: 'evt_old_failure', created: 1_700_000_000 }))

    const details = service.getCase('pi_1')
    assert.equal(details.recoveryCase.status, 'resolved')
    assert.equal(details.events.length, 2)
    assert.equal(details.events[1].eventId, 'evt_old_failure')
  } finally {
    repository.close()
  }
})

test('unmapped failure codes create reconciliation cases without invented decisions', () => {
  const { repository, ingest, service } = createTestService()
  try {
    const result = ingest(stripeEvent({ failureCode: 'do_not_honor' }))

    assert.equal(result.case.status, 'reconciliation_required')
    assert.equal(result.case.recommendedAction, 'reconcile_failure_code')
    assert.equal(service.getCase('pi_1').recoveryCase.failureCategory, null)
  } finally {
    repository.close()
  }
})

test('unsupported events are ignored without being stored as payment attempts', () => {
  const { repository, ingest, service } = createTestService()
  try {
    const result = ingest(stripeEvent({ type: 'customer.updated' }))

    assert.equal(result.ignored, true)
    assert.equal(service.listCases().length, 0)
    assert.equal(repository.listEvents('pi_1').length, 0)
  } finally {
    repository.close()
  }
})

function permutations(items) {
  if (items.length <= 1) return [items]
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)])
      .map((rest) => [item, ...rest]),
  )
}

function finalCase(events, order) {
  const { repository, ingest, service } = createTestService()
  try {
    for (const index of order) ingest(events[index])
    const { status, failureCode, recommendedAction, amount } =
      service.getCase('pi_1').recoveryCase
    return { status, failureCode, recommendedAction, amount }
  } finally {
    repository.close()
  }
}

function assertSameInAnyOrder(events, expectedStatus) {
  const orders = permutations(events.map((_, i) => i))
  const reference = finalCase(events, orders[0]) // chronological order
  assert.equal(reference.status, expectedStatus)
  for (const order of orders) {
    assert.deepEqual(finalCase(events, order), reference, `arrival order [${order}] differs`)
  }
}

test('arrival order: failure, failure, success ends the same in any order', () => {
  assertSameInAnyOrder([
    stripeEvent({ id: 'evt_a1', created: 1_700_000_010, failureCode: 'insufficient_funds' }),
    stripeEvent({ id: 'evt_a2', created: 1_700_000_020, failureCode: 'authentication_required' }),
    stripeEvent({ id: 'evt_a3', type: 'payment_intent.succeeded', created: 1_700_000_030 }),
  ], 'resolved')
})

test('arrival order: success then later failure ends the same in any order', () => {
  assertSameInAnyOrder([
    stripeEvent({ id: 'evt_b1', type: 'payment_intent.succeeded', created: 1_700_000_020 }),
    stripeEvent({ id: 'evt_b2', created: 1_700_000_030, failureCode: 'insufficient_funds' }),
  ], 'reconciliation_required')
})
