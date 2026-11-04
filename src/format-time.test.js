import assert from 'node:assert/strict'
import test from 'node:test'
import { formatProviderTime } from './format-time.js'

test('formats provider times in IST with a human-readable date and timezone', () => {
  const timestamp = Date.parse('2026-11-03T23:33:00.000Z') / 1000

  assert.equal(formatProviderTime(timestamp), '4 Nov, 5:03 AM IST')
})
