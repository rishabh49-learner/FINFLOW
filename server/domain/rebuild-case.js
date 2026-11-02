import { projectPaymentEvent } from './decision-engine.js'

export function rebuildCase(events) {
  const orderedEvents = [...events].sort((a, b) => {
    if (a.providerCreated < b.providerCreated) return -1
    if (a.providerCreated > b.providerCreated) return 1
    if (a.eventId < b.eventId) return -1
    if (a.eventId > b.eventId) return 1
    return 0
  })

  return orderedEvents.reduce(
    (recoveryCase, event) => projectPaymentEvent(recoveryCase, event),
    null,
  )
}
