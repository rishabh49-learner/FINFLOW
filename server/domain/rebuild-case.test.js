import assert from 'node:assert/strict'
import test from 'node:test'
import { rebuildCase } from './rebuild-case.js'

function paymentEvent({
  eventId,
  eventType = 'payment_failed',
  providerCreated,
  failureCode = 'insufficient_funds',
}) {
  return {
    provider: 'stripe',
    eventId,
    providerEventType: `payment_intent.${eventType}`,
    eventType,
    paymentId: 'pi_rebuild',
    providerCreated,
    receivedAt: `2026-10-25T12:00:${String(providerCreated % 60).padStart(2, '0')}.000Z`,
    amount: 2400,
    currency: 'usd',
    failureCode: eventType === 'payment_failed' ? failureCode : null,
  }
}

function permutations(items) {
  if (items.length <= 1) return [items]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)])
      .map((rest) => [item, ...rest]),
  )
}

test('every ordering rebuilds failure, failure, success to the same case', () => {
  const events = [
    paymentEvent({ eventId: 'evt_a1', providerCreated: 10 }),
    paymentEvent({
      eventId: 'evt_a2',
      providerCreated: 20,
      failureCode: 'authentication_required',
    }),
    paymentEvent({ eventId: 'evt_a3', eventType: 'payment_succeeded', providerCreated: 30 }),
  ]
  const expected = rebuildCase(events)

  assert.equal(expected.status, 'resolved')
  for (const order of permutations(events)) {
    assert.deepEqual(rebuildCase(order), expected)
  }
})

test('every ordering rebuilds a later failure after success as reconciliation', () => {
  const events = [
    paymentEvent({ eventId: 'evt_b1', eventType: 'payment_succeeded', providerCreated: 20 }),
    paymentEvent({ eventId: 'evt_b2', providerCreated: 30 }),
  ]
  const expected = rebuildCase(events)

  assert.equal(expected.status, 'reconciliation_required')
  for (const order of permutations(events)) {
    assert.deepEqual(rebuildCase(order), expected)
  }
})

test('same-timestamp events with different states require reconciliation', () => {
  const result = rebuildCase([
    paymentEvent({ eventId: 'evt_same_a', providerCreated: 40 }),
    paymentEvent({ eventId: 'evt_same_b', eventType: 'payment_succeeded', providerCreated: 40 }),
  ])

  assert.equal(result.status, 'reconciliation_required')
  assert.equal(result.recommendedAction, 'reconcile_event_order')
})

test('rebuildCase does not mutate its input array while sorting', () => {
  const events = [
    paymentEvent({ eventId: 'evt_later', providerCreated: 20 }),
    paymentEvent({ eventId: 'evt_earlier', providerCreated: 10 }),
  ]
  const originalOrder = [...events]

  rebuildCase(events)

  assert.deepEqual(events, originalOrder)
})
