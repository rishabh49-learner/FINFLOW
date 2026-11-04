import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCaseTimes } from './format-time.js'

test('formats absolute, relative, and received payment times', () => {
  const timestamp = Date.parse('2026-11-03T23:33:00.000Z') / 1000
  const receivedAt = '2026-11-04T00:00:00.000Z'
  const now = Date.parse('2026-11-04T07:33:00.000Z') / 1000

  assert.deepEqual(formatCaseTimes(timestamp, receivedAt, now), {
    absolute: '4 Nov, 5:03 AM IST',
    relative: 'First failed 8 hours ago',
    received: '4 Nov, 5:30 AM IST',
  })
})
