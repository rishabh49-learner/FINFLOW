import { projectPaymentEvent } from './decision-engine.js'

export function createRecoveryService(repository) {
  return {
    ingest(normalized) {
      if (!normalized.supported) {
        return { ignored: true, eventId: normalized.eventId }
      }

      const result = repository.applyEvent(normalized.event, projectPaymentEvent)
      return {
        ignored: false,
        duplicate: result.duplicate,
        case: result.case,
      }
    },

    listCases() {
      return repository.listCases()
    },

    getCase(paymentId) {
      const recoveryCase = repository.getCase(paymentId)
      if (!recoveryCase) return null
      return {
        recoveryCase,
        events: repository.listEvents(paymentId),
      }
    },
  }
}
