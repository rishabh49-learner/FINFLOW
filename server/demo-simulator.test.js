import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEMO_SCENARIOS,
  buildScenarioEvents,
  startScenarioDelivery,
} from './demo-simulator.js'

test('scenario data contains four named descriptions and ordered event steps', () => {
  assert.equal(DEMO_SCENARIOS.length, 4)
  for (const scenario of DEMO_SCENARIOS) {
    assert.ok(scenario.name)
    assert.ok(scenario.description)
    assert.ok(scenario.steps.length > 0)
    for (const step of scenario.steps) {
      assert.equal(Number.isSafeInteger(step.delayMs), true)
      assert.ok(step.delayMs >= 0)
      assert.ok(step.type)
      assert.ok(step.amount > 0)
      assert.match(step.currency, /^[a-z]{3}$/)
      assert.equal(step.customer, true)
    }
  }
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('cus_'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('pi_'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('evt_'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('ch_'), false)
})

test('builds Stripe-shaped events with fresh payment, event, customer, and charge IDs', () => {
  const scenario = DEMO_SCENARIOS.find((item) => item.id === 'generic-decline')
  const firstPlay = buildScenarioEvents(scenario, { now: 1_800_000_000_000 })
  const secondPlay = buildScenarioEvents(scenario, { now: 1_800_000_000_000 })

  assert.equal(firstPlay.paymentId.startsWith('pi_sim_'), true)
  assert.equal(firstPlay.events.length, 3)
  assert.equal(new Set(firstPlay.events.map((event) => event.id)).size, 3)
  assert.equal(new Set(firstPlay.events.map((event) =>
    event.data.object.last_payment_error.charge)).size, 3)
  assert.ok(firstPlay.events.every((event) => event.data.object.customer.startsWith('cus_sim_')))
  assert.notEqual(firstPlay.paymentId, secondPlay.paymentId)
  assert.notEqual(firstPlay.events[0].id, secondPlay.events[0].id)
  assert.notEqual(
    firstPlay.events[0].data.object.last_payment_error.charge,
    secondPlay.events[0].data.object.last_payment_error.charge,
  )
})

test('cancels a pending delivery timer without sleeping', async () => {
  const scenario = {
    ...DEMO_SCENARIOS.find((item) => item.id === 'lost-card'),
    steps: [{
      ...DEMO_SCENARIOS.find((item) => item.id === 'lost-card').steps[0],
      delayMs: 1,
    }],
  }
  let cancelCalled = false
  let ingested = false
  const delivery = startScenarioDelivery({
    scenario,
    delayScale: 0,
    ingest: () => { ingested = true },
    onComplete: () => assert.fail('cancelled delivery must not complete'),
    onError: (error) => { throw error },
    scheduleTimer: () => 'pending-timer',
    cancelTimer: (timer) => {
      assert.equal(timer, 'pending-timer')
      cancelCalled = true
    },
  })

  const run = delivery.run()
  delivery.cancel()
  await run

  assert.equal(cancelCalled, true)
  assert.equal(ingested, false)
})
