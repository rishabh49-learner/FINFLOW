import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { CONFIG } from '../../data/config.js'
import { projectPaymentEvent, triagePriority } from './decision-engine.js'
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
  customerId = null,
} = {}) {
  const intent = {
    id: paymentId,
    object: 'payment_intent',
    amount,
    currency,
    customer: customerId,
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
    customerId: null,
  })
})

test('normalizes customerId from an in-memory lifecycle fixture copy', () => {
  const [fixture] = JSON.parse(readFileSync(
    new URL('../../fixtures/payment-lifecycle.json', import.meta.url),
    'utf8',
  ))
  const fixtureWithCustomer = {
    ...fixture,
    data: {
      ...fixture.data,
      object: { ...fixture.data.object, customer: 'cus_fixture' },
    },
  }

  assert.equal(normalizeStripeEvent(fixtureWithCustomer).event.customerId, 'cus_fixture')
  assert.equal(normalizeStripeEvent(fixture).event.customerId, null)
})

test('maps generic_decline as a soft decline without failure-code reconciliation', () => {
  const event = stripeEvent({ failureCode: 'generic_decline' })
  event.data.object.last_payment_error = {
    decline_code: 'generic_decline',
    advice_code: 'try_again_later',
  }
  const normalized = normalizeStripeEvent(event).event
  normalized.receivedAt = '2026-10-25T12:00:00.000Z'
  const recoveryCase = projectPaymentEvent(null, normalized)
  const mapping = CONFIG.failureReasonMapping.generic_decline

  assert.equal(recoveryCase.failureCategory, 'soft_decline')
  assert.notEqual(recoveryCase.recommendedAction, 'reconcile_failure_code')
  assert.equal(mapping.nextStep, 'Wait for the scheduled retry, then ask the customer to contact their card issuer or use another payment method')
  assert.equal(mapping.source, 'Stripe dashboard decline explanation plus advice_code try_again_later')
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

test('assigns deterministic triage priorities from status and mapped category', () => {
  assert.equal(triagePriority({
    status: 'reconciliation_required',
    failureCategory: null,
  }).level, 'urgent')
  assert.equal(triagePriority({
    status: 'open',
    failureCategory: 'hard_decline',
  }).level, 'high')
  assert.equal(triagePriority({
    status: 'open',
    failureCategory: 'soft_decline',
  }).level, 'standard')
  assert.equal(triagePriority({
    status: 'resolved',
    failureCategory: null,
  }).level, 'resolved')
})
