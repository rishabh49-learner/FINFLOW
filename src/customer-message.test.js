import assert from 'node:assert/strict'
import test from 'node:test'
import { CONFIG } from '../data/config.js'
import { customerMessage } from './customer-message.js'

test('returns null for unmapped and needs-review cases', () => {
  assert.equal(customerMessage({
    status: 'open',
    failureCode: 'not_mapped',
    amount: 1299,
    currency: 'usd',
  }), null)

  assert.equal(customerMessage({
    status: 'reconciliation_required',
    failureCode: 'generic_decline',
    amount: 1299,
    currency: 'usd',
  }), null)
})

test('assigns every configured failure code to an explicit customer-copy group', () => {
  const expectedGroupByCode = {
    generic_decline: 'retry_wait',
    insufficient_funds: 'retry_wait',
    authentication_failed: 'authentication',
    authentication_required: 'authentication',
    payment_intent_authentication_failure: 'authentication',
    transaction_daily_limit_exceeded: 'retry_wait',
    payment_cancelled: null,
    card_not_supported: 'hard_decline',
    fraudulent: null,
    merchant_blacklist: null,
    lost_card: 'hard_decline',
    stolen_card: null,
  }
  const customerCopyByGroup = {
    retry_wait: 'Please wait for the scheduled retry.',
    authentication: 'Your bank needs you to confirm this payment',
    hard_decline: 'Please contact your card issuer or use another payment method.',
  }

  assert.deepEqual(
    Object.keys(expectedGroupByCode).sort(),
    Object.keys(CONFIG.failureReasonMapping).sort(),
  )

  for (const [failureCode, expectedGroup] of Object.entries(expectedGroupByCode)) {
    const message = customerMessage({
      status: 'open',
      failureCode,
      recommendedAction: CONFIG.failureReasonMapping[failureCode].action,
      amount: 1299,
      currency: 'usd',
    })

    if (expectedGroup === null) {
      assert.equal(message, null, `${failureCode} should have no customer copy`)
    } else {
      assert.ok(message.includes(customerCopyByGroup[expectedGroup]), failureCode)
      assert.doesNotMatch(message, new RegExp(failureCode, 'i'), failureCode)
    }
  }
})

test('creates a customer-safe message for a mapped soft decline', () => {
  const recoveryCase = {
    status: 'open',
    failureCode: 'generic_decline',
    failureCategory: 'soft_decline',
    amount: 1299,
    currency: 'usd',
    recommendationReason: 'FINFLOW internal mapping note',
  }
  const message = customerMessage(recoveryCase)
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(12.99)

  assert.equal(typeof message, 'string')
  assert.match(message, /Hi,\n\nYour payment of/)
  assert.ok(message.includes(formattedAmount))
  assert.doesNotMatch(message, /mapping|FINFLOW|generic_decline/i)
  assert.equal(message.includes(CONFIG.failureReasonMapping.generic_decline.nextStep), false)
  assert.equal(message.includes(CONFIG.failureReasonMapping.generic_decline.source), false)
})

test('uses customer-safe authentication wording for authentication failures', () => {
  const message = customerMessage({
    status: 'open',
    failureCode: 'authentication_required',
    recommendedAction: 'request_customer_authentication',
    amount: 1299,
    currency: 'usd',
  })

  assert.ok(message.includes('Your bank needs you to confirm this payment'))
  assert.doesNotMatch(message, /authentication_required/i)
})
