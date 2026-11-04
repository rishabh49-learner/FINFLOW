const ACTIVITY_LABELS = {
  payment_failed: 'Payment failed',
  payment_succeeded: 'Payment succeeded',
}

export function formatActivityLabel(eventType) {
  return ACTIVITY_LABELS[eventType] ?? 'Payment event'
}
