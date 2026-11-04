import assert from 'node:assert/strict'
import test from 'node:test'
import { LABELS } from './labels.js'

test('uses the requested home and Overview copy', () => {
  assert.equal(LABELS.heroDescription.includes('and whether anyone has followed up'), false)
  assert.equal(LABELS.resetDemo, 'Clear simulated cases')
  assert.equal(LABELS.waitingOnRetrySubtitle, 'Stripe may still retry these, or the customer may act.')
})

test('uses the requested case-ready message', () => {
  assert.equal(LABELS.caseReady, 'Case ready: View case')
})
