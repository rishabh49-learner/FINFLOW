import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function caseFromRow(row) {
  if (!row) return null
  return {
    paymentId: row.payment_id,
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

  const insertEvent = database.prepare(`
    INSERT OR IGNORE INTO payment_events (
      provider, event_id, payment_id, event_type, provider_created,
      received_at, normalized_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const selectCase = database.prepare(
    'SELECT * FROM recovery_cases WHERE payment_id = ?',
  )
  const upsertCase = database.prepare(`
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

  function getCase(paymentId) {
    return caseFromRow(selectCase.get(paymentId))
  }

  return {
    applyEvent(inputEvent, project) {
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
          }),
        )

        if (inserted.changes === 0) {
          database.exec('COMMIT')
          return { duplicate: true, case: getCase(event.paymentId) }
        }

        const nextCase = project(getCase(event.paymentId), event)
        upsertCase.run(
          nextCase.paymentId,
          nextCase.status,
          nextCase.amount,
          nextCase.currency,
          nextCase.failureCode,
          nextCase.failureCategory,
          nextCase.recommendedAction,
          nextCase.recommendationReason,
          nextCase.reconciliationReason,
          nextCase.updatedAt,
          nextCase.lastEventCreated,
          nextCase.lastEventType,
          nextCase.lastEventFailureCode,
          nextCase.lastEventAmount,
          nextCase.lastEventCurrency,
        )
        database.exec('COMMIT')
        return { duplicate: false, case: nextCase }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    listCases() {
      return database.prepare(
        'SELECT * FROM recovery_cases ORDER BY updated_at DESC, payment_id ASC',
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
