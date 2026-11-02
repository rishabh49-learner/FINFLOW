import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const DEMO_SCENARIOS = JSON.parse(readFileSync(
  new URL('./demo-scenarios.json', import.meta.url),
  'utf8',
))

export function getDemoScenario(scenarioId) {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === scenarioId) ?? null
}

export function buildScenarioEvents(scenario, { now = Date.now() } = {}) {
  const paymentId = `pi_sim_${randomUUID()}`
  const customerId = `cus_sim_${randomUUID()}`
  const firstCreated = Math.floor(now / 1000) - scenario.steps.length
  const events = scenario.steps.map((step, index) => {
    const chargeId = `ch_sim_${randomUUID()}`
    const paymentIntent = {
      id: paymentId,
      object: 'payment_intent',
      amount: step.amount,
      currency: step.currency,
      customer: step.customer ? customerId : null,
      latest_charge: chargeId,
    }

    if (step.type === 'payment_intent.payment_failed') {
      paymentIntent.last_payment_error = {
        code: 'card_declined',
        decline_code: step.decline_code,
        advice_code: step.advice_code,
        charge: chargeId,
      }
    } else if (step.type === 'payment_intent.succeeded') {
      paymentIntent.amount_received = step.amount
    } else {
      throw new TypeError(`Unsupported demo event type: ${step.type}`)
    }

    return {
      id: `evt_sim_${randomUUID()}`,
      type: step.type,
      created: firstCreated + index,
      livemode: false,
      data: { object: paymentIntent },
    }
  })

  return { paymentId, events }
}

function waitForStep(delayMs, delayScale, playState, scheduleTimer) {
  if (playState.cancelled) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      playState.timer = null
      playState.finishTimer = null
      resolve()
    }
    playState.finishTimer = finish
    playState.timer = scheduleTimer(finish, delayMs * delayScale)
  })
}

export function startScenarioDelivery({
  scenario,
  outOfOrder = false,
  delayScale = 1,
  ingest,
  onComplete,
  onError,
  scheduleTimer = setTimeout,
  cancelTimer = clearTimeout,
}) {
  const { paymentId, events } = buildScenarioEvents(scenario)
  const playState = {
    cancelled: false,
    timer: null,
    finishTimer: null,
  }

  const cancel = () => {
    playState.cancelled = true
    if (playState.timer !== null) cancelTimer(playState.timer)
    if (playState.finishTimer) playState.finishTimer()
  }

  const deliveryOrder = events.map((event, index) => index)
  if (outOfOrder) deliveryOrder.reverse()

  const run = async () => {
    for (const index of deliveryOrder) {
      if (playState.cancelled) return
      await waitForStep(
        scenario.steps[index].delayMs,
        delayScale,
        playState,
        scheduleTimer,
      )
      if (playState.cancelled) return
      await ingest(events[index])
    }
    if (!playState.cancelled) onComplete(paymentId)
  }

  return {
    paymentId,
    cancel,
    run: () => run().catch(onError),
  }
}
