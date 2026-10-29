import { mapFailureCode } from './failure-mapping.js'

function reconciliationCase(existingCase, event, reason) {
  
  const failureMapping = mapFailureCode(event.failureCode)
  return {
    ...(existingCase ?? {}),
    paymentId: event.paymentId,
    status: 'reconciliation_required',
    amount: existingCase?.amount ?? event.amount,
    currency: existingCase?.currency ?? event.currency,
    failureCode: existingCase?.failureCode ?? event.failureCode,
    failureCategory: existingCase?.failureCategory ?? failureMapping?.category ?? null,
    recommendedAction: 'reconcile_event_order',
    recommendationReason: reason,
    reconciliationReason: reason,
    updatedAt: event.receivedAt,
    lastEventCreated: event.providerCreated,
    lastEventType: event.eventType,
    lastEventFailureCode: event.failureCode,
    lastEventAmount: event.amount,
    lastEventCurrency: event.currency,
  }
}

function isSameProviderEventState(existingCase, event) {
  return existingCase.lastEventType === event.eventType
    && existingCase.lastEventFailureCode === event.failureCode
    && existingCase.lastEventAmount === event.amount
    && existingCase.lastEventCurrency === event.currency
}

export function projectPaymentEvent(existingCase, event) {
  if (existingCase && event.providerCreated < existingCase.lastEventCreated) {
    return existingCase
  }

  if (existingCase && event.providerCreated === existingCase.lastEventCreated) {
    if (isSameProviderEventState(existingCase, event)) return existingCase

    return reconciliationCase(
      existingCase,
      event,
      'Distinct PaymentIntent events have the same provider timestamp and cannot be ordered reliably.',
    )
  }

  if (event.eventType === 'payment_succeeded') {
    if (existingCase?.status === 'resolved') return existingCase

    return {
      paymentId: event.paymentId,
      status: 'resolved',
      amount: event.amount ?? existingCase?.amount ?? null,
      currency: event.currency ?? existingCase?.currency ?? null,
      failureCode: null,
      failureCategory: null,
      recommendedAction: 'none',
      recommendationReason: 'Stripe reported that this PaymentIntent succeeded; the recovery case is resolved.',
      reconciliationReason: null,
      updatedAt: event.receivedAt,
      lastEventCreated: event.providerCreated,
      lastEventType: event.eventType,
      lastEventFailureCode: event.failureCode,
      lastEventAmount: event.amount,
      lastEventCurrency: event.currency,
    }
  }

  if (existingCase?.status === 'resolved') {
    return reconciliationCase(
      existingCase,
      event,
      'A newer failure event followed a success event. Preserve both events and reconcile the PaymentIntent state.',
    )
  }

  const mapping = mapFailureCode(event.failureCode)
  if (!mapping) {
    return {
      paymentId: event.paymentId,
      status: 'reconciliation_required',
      amount: event.amount ?? existingCase?.amount ?? null,
      currency: event.currency ?? existingCase?.currency ?? null,
      failureCode: event.failureCode,
      failureCategory: null,
      recommendedAction: 'reconcile_failure_code',
      recommendationReason: `Failure code "${event.failureCode ?? 'missing'}" is not in the existing FINFLOW mapping; do not infer a recovery action.`,
      reconciliationReason: `Unmapped Stripe failure code: ${event.failureCode ?? 'missing'}.`,
      updatedAt: event.receivedAt,
      lastEventCreated: event.providerCreated,
      lastEventType: event.eventType,
      lastEventFailureCode: event.failureCode,
      lastEventAmount: event.amount,
      lastEventCurrency: event.currency,
    }
  }

  return {
    paymentId: event.paymentId,
    status: 'open',
    amount: event.amount ?? existingCase?.amount ?? null,
    currency: event.currency ?? existingCase?.currency ?? null,
    failureCode: event.failureCode,
    failureCategory: mapping.category,
    recommendedAction: mapping.action,
    recommendationReason: mapping.reason,
    reconciliationReason: null,
    updatedAt: event.receivedAt,
    lastEventCreated: event.providerCreated,
    lastEventType: event.eventType,
    lastEventFailureCode: event.failureCode,
    lastEventAmount: event.amount,
    lastEventCurrency: event.currency,
  }
}

export function triagePriority(recoveryCase) {
  if (recoveryCase.status === 'reconciliation_required') {
    return {
      level: 'urgent',
      rank: 1,
      reason: 'Reconcile the payment state or failure code before taking a recovery action.',
    }
  }

  if (recoveryCase.status === 'resolved') {
    return {
      level: 'resolved',
      rank: 4,
      reason: 'Stripe reported success; no recovery action is needed.',
    }
  }

  if (recoveryCase.failureCategory === 'hard_decline') {
    return {
      level: 'high',
      rank: 2,
      reason: 'A hard decline should not be retried automatically; follow its mapped action.',
    }
  }

  return {
    level: 'standard',
    rank: 3,
    reason: 'The mapped soft decline has an explicit recommended next step.',
  }
}
