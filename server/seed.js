import { randomBytes } from 'node:crypto'
import { DEMO_SCENARIOS } from './demo-simulator.js'
import { normalizeStripeEvent } from './providers/stripe-adapter.js'

const seededScenarioIds = [
  'insufficient-funds-then-paid',
  'generic-decline',
  'authentication-required',
  'lost-card',
]

function shortId() {
  return randomBytes(4).toString('hex')
}

function scenarioEvents({ now = Date.now() } = {}) {
  let sharedCustomerId

  return seededScenarioIds.flatMap((scenarioId, index) => {
    const scenario = DEMO_SCENARIOS.find((item) => item.id === scenarioId)
    if (!scenario) throw new Error(`Missing demo scenario: ${scenarioId}`)
    if (!scenario.steps.some((step) =>
      step.type === 'payment_intent.payment_failed' && step.decline_code)) {
      throw new Error(`Demo scenario ${scenarioId} has no failed payment step.`)
    }

    const customerId = index < 2
      ? sharedCustomerId ?? (sharedCustomerId = `cus_demo_${shortId()}`)
      : `cus_demo_${shortId()}`
    const paymentId = `pi_demo_${shortId()}`
    const lastTodayTimestamp = Math.floor(now / 86_400_000) * 86_400 + 86_399
    const firstCreated = Math.min(
      Math.floor(now / 1000),
      lastTodayTimestamp - scenario.steps.length + 1,
    )

    return scenario.steps.map((step, stepIndex) => {
      const chargeId = `ch_demo_${shortId()}`
      const paymentIntent = {
        id: paymentId,
        object: 'payment_intent',
        amount: step.amount,
        currency: step.currency,
        customer: customerId,
        latest_charge: chargeId,
      }

      if (step.type === 'payment_intent.payment_failed') {
        if (!step.decline_code) {
          throw new Error(`Demo scenario ${scenarioId} has a failed step without a decline code.`)
        }
        paymentIntent.last_payment_error = {
          code: 'card_declined',
          decline_code: step.decline_code,
          advice_code: step.advice_code,
          charge: chargeId,
        }
      } else if (step.type === 'payment_intent.succeeded') {
        paymentIntent.amount_received = step.amount
      } else {
        throw new Error(`Unsupported demo event type: ${step.type}`)
      }

      return {
        id: `evt_demo_${shortId()}`,
        type: step.type,
        created: firstCreated + stepIndex,
        livemode: false,
        data: { object: paymentIntent },
      }
    })
  })
}

export function seedDemo(service, options = {}) {
  const events = scenarioEvents(options)
  return events.map((event) => service.ingest(normalizeStripeEvent(event)))
}
