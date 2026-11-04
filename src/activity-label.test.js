import assert from 'node:assert/strict'
import test from 'node:test'
import { formatActivityLabel } from './activity-label.js'

test('labels payment activity events in plain language', () => {
  assert.equal(formatActivityLabel('payment_failed'), 'Payment failed')
  assert.equal(formatActivityLabel('payment_succeeded'), 'Payment succeeded')
})
