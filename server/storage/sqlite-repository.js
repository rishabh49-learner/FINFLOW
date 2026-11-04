import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { rebuildCase } from '../domain/rebuild-case.js'

function caseFromRow(row) {
  if (!row) return null
  return {
    paymentId: row.payment_id,
    customerId: row.customer_id,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    failureCode: row.failure_code,
    failureCategory: row.failure_category,
    recommendedAction: row.recommended_action,
    recommendationReason: row.recommendation_reason,
    reconciliationReason: row.reconciliation_reason,
    updatedAt: row.updated_at,
    lastEventCreated: row.last_event_created,
    lastEventType: row.last_event_type,
    lastEventFailureCode: row.last_event_failure_code,
    lastEventAmount: row.last_event_amount,
    lastEventCurrency: row.last_event_currency,
    firstFailedAt: row.first_failed_at ?? null,
  }
}

export function createSqliteRepository({
  dbPath = 'data/finflow.sqlite',
  clock = () => new Date().toISOString(),
} = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })

  const database = new DatabaseSync(dbPath)
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS payment_events (
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      payment_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      provider_created INTEGER NOT NULL,
      received_at TEXT NOT NULL,
      normalized_payload TEXT NOT NULL,
      UNIQUE (provider, event_id)
    );
    CREATE INDEX IF NOT EXISTS payment_events_payment_id_idx
      ON payment_events (payment_id, provider_created, received_at);
    CREATE TABLE IF NOT EXISTS recovery_cases (
      payment_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      amount INTEGER,
      currency TEXT,
      failure_code TEXT,
      failure_category TEXT,
      recommended_action TEXT NOT NULL,
      recommendation_reason TEXT NOT NULL,
      reconciliation_reason TEXT,
      updated_at TEXT NOT NULL,
      last_event_created INTEGER NOT NULL,
      last_event_type TEXT NOT NULL,
      last_event_failure_code TEXT,
      last_event_amount INTEGER,
      last_event_currency TEXT
    );
  `)

  const customerIdProjection = `(
    SELECT json_extract(normalized_payload, '$.customerId')
    FROM payment_events
    WHERE provider = 'stripe'
      AND payment_events.payment_id = recovery_cases.payment_id
      AND json_extract(normalized_payload, '$.customerId') IS NOT NULL
    ORDER BY received_at DESC, provider_created DESC, event_id DESC
    LIMIT 1
  ) AS customer_id`
  const firstFailureProjection = `(
    SELECT MIN(provider_created)
    FROM payment_events
    WHERE provider = 'stripe'
      AND payment_events.payment_id = recovery_cases.payment_id
      AND event_type = 'payment_intent.payment_failed'
  ) AS first_failed_at`
  const insertEvent = database.prepare(`
    INSERT OR IGNORE INTO payment_events (
      provider, event_id, payment_id, event_type, provider_created,
      received_at, normalized_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const selectCase = database.prepare(
    `SELECT recovery_cases.*, ${customerIdProjection}, ${firstFailureProjection}
    FROM recovery_cases
    WHERE payment_id = ?`,
  )
  const upsertCaseStatement = database.prepare(`
    INSERT INTO recovery_cases (
      payment_id, status, amount, currency, failure_code, failure_category,
      recommended_action, recommendation_reason, reconciliation_reason,
      updated_at, last_event_created, last_event_type,
      last_event_failure_code, last_event_amount, last_event_currency
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(payment_id) DO UPDATE SET
      status = excluded.status,
      amount = excluded.amount,
      currency = excluded.currency,
      failure_code = excluded.failure_code,
      failure_category = excluded.failure_category,
      recommended_action = excluded.recommended_action,
      recommendation_reason = excluded.recommendation_reason,
      reconciliation_reason = excluded.reconciliation_reason,
      updated_at = excluded.updated_at,
      last_event_created = excluded.last_event_created,
      last_event_type = excluded.last_event_type,
      last_event_failure_code = excluded.last_event_failure_code,
      last_event_amount = excluded.last_event_amount,
      last_event_currency = excluded.last_event_currency
  `)

  const selectEvents = database.prepare(`
    SELECT event_id, payment_id, event_type, provider_created,
      received_at, normalized_payload
    FROM payment_events
    WHERE provider = 'stripe' AND payment_id = ?
  `)
  const selectPaymentIds = database.prepare(
    'SELECT DISTINCT payment_id FROM payment_events',
  )
  const simulatorPaymentPrefix = "substr(payment_id, 1, 7) = 'pi_sim_'"

  function loadEvents(paymentId) {
    return selectEvents.all(paymentId).map((row) => {
      const eventType = {
        'payment_intent.payment_failed': 'payment_failed',
        'payment_intent.succeeded': 'payment_succeeded',
      }[row.event_type]
      if (!eventType) {
        throw new TypeError(`Unsupported stored Stripe event type: ${row.event_type}`)
      }

      const details = JSON.parse(row.normalized_payload)
      return {
        provider: 'stripe',
        eventId: row.event_id,
        providerEventType: row.event_type,
        eventType,
        paymentId: row.payment_id,
        providerCreated: row.provider_created,
        receivedAt: row.received_at,
        amount: details.amount,
        currency: details.currency,
        failureCode: details.failureCode,
        customerId: details.customerId ?? null,
        chargeId: details.chargeId ?? null,
      }
    })
  }

  function upsertCase(recoveryCase) {
    upsertCaseStatement.run(
      recoveryCase.paymentId,
      recoveryCase.status,
      recoveryCase.amount,
      recoveryCase.currency,
      recoveryCase.failureCode,
      recoveryCase.failureCategory,
      recoveryCase.recommendedAction,
      recoveryCase.recommendationReason,
      recoveryCase.reconciliationReason,
      recoveryCase.updatedAt,
      recoveryCase.lastEventCreated,
      recoveryCase.lastEventType,
      recoveryCase.lastEventFailureCode,
      recoveryCase.lastEventAmount,
      recoveryCase.lastEventCurrency,
    )
  }

  function rebuildPaymentCase(paymentId) {
    const recoveryCase = rebuildCase(loadEvents(paymentId))
    if (recoveryCase) upsertCase(recoveryCase)
  }

  function getCase(paymentId) {
    return caseFromRow(selectCase.get(paymentId))
  }

  return {
    applyEvent(inputEvent) {
      const event = { ...inputEvent, receivedAt: clock() }
      database.exec('BEGIN IMMEDIATE')
      try {
        const inserted = insertEvent.run(
          event.provider,
          event.eventId,
          event.paymentId,
          event.providerEventType,
          event.providerCreated,
          event.receivedAt,
          JSON.stringify({
            amount: event.amount,
            currency: event.currency,
            failureCode: event.failureCode,
            customerId: event.customerId,
            chargeId: event.chargeId,
          }),
        )

        if (inserted.changes === 0) {
          database.exec('COMMIT')
          return { duplicate: true, case: getCase(event.paymentId) }
        }

        const nextCase = rebuildCase(loadEvents(event.paymentId))
        upsertCase(nextCase)
        database.exec('COMMIT')
        return { duplicate: false, case: getCase(event.paymentId) }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    rebuildAllCases() {
      database.exec('BEGIN IMMEDIATE')
      try {
        for (const { payment_id: paymentId } of selectPaymentIds.all()) {
          rebuildPaymentCase(paymentId)
        }
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    pruneSimulatorCases(maxCases = 50) {
      if (!Number.isSafeInteger(maxCases) || maxCases < 0) {
        throw new RangeError('Simulator case limit must be a non-negative integer.')
      }

      database.exec('BEGIN IMMEDIATE')
      try {
        const oldestCases = database.prepare(`
          SELECT payment_id
          FROM recovery_cases
          WHERE ${simulatorPaymentPrefix}
          ORDER BY updated_at DESC, payment_id DESC
          LIMIT -1 OFFSET ?
        `).all(maxCases).map((row) => row.payment_id)

        if (oldestCases.length) {
          const placeholders = oldestCases.map(() => '?').join(', ')
          database.prepare(`
            DELETE FROM payment_events
            WHERE payment_id IN (${placeholders})
          `).run(...oldestCases)
          database.prepare(`
            DELETE FROM recovery_cases
            WHERE payment_id IN (${placeholders})
          `).run(...oldestCases)
        }

        database.exec('COMMIT')
        return oldestCases.length
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    resetSimulatorData() {
      database.exec('BEGIN IMMEDIATE')
      try {
        const { count } = database.prepare(`
          SELECT COUNT(*) AS count
          FROM recovery_cases
          WHERE ${simulatorPaymentPrefix}
        `).get()
        database.exec(`
          DELETE FROM payment_events
          WHERE substr(payment_id, 1, 7) = 'pi_sim_';
          DELETE FROM recovery_cases
          WHERE ${simulatorPaymentPrefix};
        `)
        database.exec('COMMIT')
        return count
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    listCases() {
      return database.prepare(
        `SELECT recovery_cases.*, ${customerIdProjection}, ${firstFailureProjection}
        FROM recovery_cases
        ORDER BY updated_at DESC, payment_id ASC`,
      ).all().map(caseFromRow)
    },

    getCase,

    listEvents(paymentId) {
      return database.prepare(`
        SELECT event_id, event_type, provider_created, received_at, normalized_payload
        FROM payment_events
        WHERE provider = 'stripe' AND payment_id = ?
        ORDER BY received_at ASC, provider_created ASC, event_id ASC
      `).all(paymentId).map((row) => ({
        eventId: row.event_id,
        eventType: row.event_type,
        providerCreated: row.provider_created,
        receivedAt: row.received_at,
        details: JSON.parse(row.normalized_payload),
      }))
    },

    close() {
      database.close()
    },
  }
}
