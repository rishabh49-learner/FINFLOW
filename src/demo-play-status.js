export function getDemoPlayStatus(paymentId, cases) {
  if (!paymentId) return null
  return cases.some((recoveryCase) => recoveryCase.paymentId === paymentId)
    ? 'ready'
    : 'playing'
}
