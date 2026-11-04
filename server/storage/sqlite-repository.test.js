import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { normalizeStripeEvent } from '../providers/stripe-adapter.js'
import { rebuildCase } from '../domain/rebuild-case.js'
import { projectPaymentEvent } from '../domain/decision-engine.js'
import { createSqliteRepository } from './sqlite-repository.js'

function stripeEvent({
  id,
  type = 'payment_intent.payment_failed',
  created,
  failureCode = 'insufficient_funds',
}) {
  const paymentIntent = {
    id: 'pi_rebuild_all',
    object: 'payment_intent',
    amount: 2400,
    currency: 'usd',
  }
  if (type === 'payment_intent.payment_failed') {
    paymentIntent.last_payment_error = { code: failureCode }
  }

  return {
    id,
    type,
    created,
    livemode: false,
    data: { object: paymentIntent },
  }
}

test('rebuildAllCases repairs stale rows and is idempotent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'finflow-rebuild-'))
  const dbPath = join(directory, 'recovery.sqlite')
  const receivedAt = [
    '2026-10-25T12:00:00.000Z',
    '2026-10-25T12:00:01.000Z',
  ]
  let receivedIndex = 0
  const repository = createSqliteRepository({
    dbPath,
    clock: () => receivedAt[receivedIndex++],
  })
  t.after(() => {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  })

  const events = [
    normalizeStripeEvent(stripeEvent({
      id: 'evt_rebuild_failure',
      created: 1_700_000_010,
    })).event,
    normalizeStripeEvent(stripeEvent({
      id: 'evt_rebuild_success',
      type: 'payment_intent.succeeded',
      created: 1_700_000_020,
    })).event,
  ].map((event, index) => ({ ...event, receivedAt: receivedAt[index] }))

  for (const event of events) {
    repository.applyEvent(event, projectPaymentEvent)
  }

  const database = new DatabaseSync(dbPath)
  try {
    database.prepare(`
      UPDATE recovery_cases
      SET status = 'open',
          failure_code = 'stale',
          recommended_action = 'stale',
          recommendation_reason = 'stale',
          updated_at = 'stale'
      WHERE payment_id = ?
    `).run('pi_rebuild_all')
  } finally {
    database.close()
  }

  const expected = rebuildCase(events)
  repository.rebuildAllCases()
  const rebuilt = repository.getCase('pi_rebuild_all')
  assert.deepEqual(rebuilt, {
    ...expected,
    customerId: null,
    firstFailedAt: 1_700_000_010,
  })

  repository.rebuildAllCases()
  assert.deepEqual(repository.getCase('pi_rebuild_all'), rebuilt)
})
