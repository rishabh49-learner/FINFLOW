import assert from 'node:assert/strict'
import test from 'node:test'
import { CONFIG } from '../../data/config.js'
import { projectPaymentEvent } from './decision-engine.js'
import { mapFailureCode } from './failure-mapping.js'
import { normalizeStripeEvent } from '../providers/stripe-adapter.js'

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

  return {
    id,
    type,
    created,
    livemode: false,
    data: { object: intent },
  }
}

test('maps existing weighted codes and preserves the original weights', () => {
  const mapping = mapFailureCode('insufficient_funds')

  assert.equal(mapping.category, 'soft_decline')
  assert.equal(mapping.weight, 0.4)
  assert.equal(mapFailureCode('authentication_failed').weight, 0.1)
  assert.equal(mapFailureCode('transaction_daily_limit_exceeded').weight, 0.2)
  assert.equal(mapFailureCode('payment_cancelled').weight, 0.25)
  assert.equal(CONFIG.failureReasonWeights.insufficient_funds, 0.4)
  assert.equal(mapFailureCode('not_a_known_code'), null)
})

test('normalizes PaymentIntent events without exposing the full provider object', () => {
  const normalized = normalizeStripeEvent(stripeEvent()).event

  assert.deepEqual(normalized, {
    provider: 'stripe',
    eventId: 'evt_1',
    providerEventType: 'payment_intent.payment_failed',
    eventType: 'payment_failed',
    paymentId: 'pi_1',
    providerCreated: 1_700_000_000,
    amount: 2400,
    currency: 'usd',
    failureCode: 'insufficient_funds',
  })
})

test('rejects malformed supported events and safely ignores unsupported types', () => {
  assert.throws(
    () => normalizeStripeEvent({ ...stripeEvent(), data: {} }),
    /Malformed Stripe event envelope/,
  )
  assert.throws(
    () => normalizeStripeEvent(stripeEvent({ failureCode: null })),
    /missing a failure code/,
  )
  assert.deepEqual(
    normalizeStripeEvent(stripeEvent({ type: 'customer.updated' })),
    { supported: false, eventId: 'evt_1', providerEventType: 'customer.updated' },
  )
})

test('projects a failure then a distinct failure on the same payment as one evolving case', () => {
  const first = normalizeStripeEvent(stripeEvent()).event
  first.receivedAt = '2026-10-25T12:00:00.000Z'
  const firstCase = projectPaymentEvent(null, first)
  const second = normalizeStripeEvent(stripeEvent({
    id: 'evt_2',
    created: first.providerCreated + 10,
    failureCode: 'authentication_required',
  })).event
  second.receivedAt = '2026-10-25T12:01:00.000Z'
  const secondCase = projectPaymentEvent(firstCase, second)

  assert.equal(secondCase.paymentId, firstCase.paymentId)
  assert.equal(secondCase.status, 'open')
  assert.equal(secondCase.failureCode, 'authentication_required')
  assert.equal(secondCase.failureCategory, 'soft_decline')
  assert.equal(secondCase.recommendedAction, 'request_customer_authentication')
})

test('success resolves an existing case and preserves its payment details', () => {
  const failed = normalizeStripeEvent(stripeEvent()).event
  failed.receivedAt = '2026-10-25T12:00:00.000Z'
  const openCase = projectPaymentEvent(null, failed)
  const succeeded = normalizeStripeEvent(stripeEvent({
    id: 'evt_2',
    type: 'payment_intent.succeeded',
    created: failed.providerCreated + 10,
  })).event
  succeeded.receivedAt = '2026-10-25T12:01:00.000Z'
  const resolved = projectPaymentEvent(openCase, succeeded)

  assert.equal(resolved.status, 'resolved')
  assert.equal(resolved.amount, 2400)
  assert.equal(resolved.currency, 'usd')
  assert.equal(resolved.failureCode, null)
  assert.equal(resolved.recommendedAction, 'none')
})

test('keeps a newer success projection when an older failure arrives later', () => {
  const success = normalizeStripeEvent(stripeEvent({
    id: 'evt_success',
    type: 'payment_intent.succeeded',
    created: 1_700_000_010,
  })).event
  success.receivedAt = '2026-10-25T12:00:00.000Z'
  const resolved = projectPaymentEvent(null, success)
  const lateFailure = normalizeStripeEvent(stripeEvent({
    id: 'evt_old_failure',
    created: 1_700_000_000,
  })).event
  lateFailure.receivedAt = '2026-10-25T12:01:00.000Z'

  assert.equal(projectPaymentEvent(resolved, lateFailure), resolved)
  assert.equal(resolved.status, 'resolved')
})

test('flags conflicting events with the same provider timestamp for reconciliation', () => {
  const first = normalizeStripeEvent(stripeEvent()).event
  first.receivedAt = '2026-10-25T12:00:00.000Z'
  const existing = projectPaymentEvent(null, first)
  const conflicting = normalizeStripeEvent(stripeEvent({
    id: 'evt_conflict',
    type: 'payment_intent.succeeded',
  })).event
  conflicting.receivedAt = '2026-10-25T12:00:01.000Z'

  const result = projectPaymentEvent(existing, conflicting)
  assert.equal(result.status, 'reconciliation_required')
  assert.equal(result.recommendedAction, 'reconcile_event_order')
})

test('preserves the newer failure detail but requires reconciliation after success', () => {
  const success = normalizeStripeEvent(stripeEvent({
    id: 'evt_success',
    type: 'payment_intent.succeeded',
    created: 1_700_000_010,
  })).event
  success.receivedAt = '2026-10-25T12:00:00.000Z'
  const resolved = projectPaymentEvent(null, success)
  const laterFailure = normalizeStripeEvent(stripeEvent({
    id: 'evt_later_failure',
    created: 1_700_000_020,
    failureCode: 'authentication_required',
  })).event
  laterFailure.receivedAt = '2026-10-25T12:01:00.000Z'

  const result = projectPaymentEvent(resolved, laterFailure)
  assert.equal(result.status, 'reconciliation_required')
  assert.equal(result.failureCode, 'authentication_required')
  assert.equal(result.failureCategory, 'soft_decline')
})
