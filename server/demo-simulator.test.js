import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEMO_SCENARIOS,
  buildScenarioEvents,
  startScenarioDelivery,
} from './demo-simulator.js'

test('scenario data contains five plain-language descriptions and valid event steps', () => {
  assert.equal(DEMO_SCENARIOS.length, 5)
  assert.deepEqual(DEMO_SCENARIOS.map((scenario) => scenario.name), [
    'Pays on its own',
    'Bank gives no reason',
    'Customer must confirm',
    'Card reported lost',
    'Events arrive out of order',
  ])
  for (const scenario of DEMO_SCENARIOS) {
    assert.ok(scenario.name)
    assert.ok(scenario.description)
    assert.equal(scenario.description.includes('\n'), false)
    assert.ok(scenario.steps.length > 0)
    for (const step of scenario.steps) {
      assert.equal(Number.isSafeInteger(step.delayMs), true)
      assert.ok(step.delayMs >= 0)
      assert.ok(step.type)
      assert.ok(step.amount > 0)
      assert.match(step.currency, /^[a-z]{3}$/)
      assert.equal(step.customer, true)
      if (step.type === 'payment_intent.payment_failed') {
        assert.ok([
          'insufficient_funds',
          'generic_decline',
          'authentication_required',
          'lost_card',
        ].includes(step.decline_code))
      }
    }
  }
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('cus_'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('pi_'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('evt_'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('ch_'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('processor_specific_decline'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('transaction_daily_limit_exceeded'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('authentication_failed'), false)
  assert.equal(JSON.stringify(DEMO_SCENARIOS).includes('payment_cancelled'), false)

  const authenticationScenario = DEMO_SCENARIOS.find((item) => item.id === 'authentication-required')
  assert.equal(authenticationScenario.steps.length, 1)
  assert.equal(authenticationScenario.steps[0].decline_code, 'authentication_required')

  const genericScenario = DEMO_SCENARIOS.find((item) => item.id === 'generic-decline')
  assert.equal(genericScenario.steps[0].decline_code, 'generic_decline')
  assert.equal(genericScenario.steps[0].advice_code, 'try_again_later')

  const outOfOrderScenario = DEMO_SCENARIOS.find((item) => item.id === 'success-then-failure')
  assert.equal(outOfOrderScenario.outOfOrder, true)
})

test('builds Stripe-shaped events with fresh payment, event, customer, and charge IDs', () => {
  const scenario = DEMO_SCENARIOS.find((item) => item.id === 'insufficient-funds-then-paid')
  const firstPlay = buildScenarioEvents(scenario, { now: 1_800_000_000_000 })
  const secondPlay = buildScenarioEvents(scenario, { now: 1_800_000_000_000 })
  const generatedIds = [
    firstPlay.paymentId,
    firstPlay.events[0].data.object.customer,
    ...firstPlay.events.flatMap((event) => [
      event.id,
      event.data.object.latest_charge,
    ]),
  ]

  assert.match(firstPlay.paymentId, /^pi_sim_[0-9a-f]{8}$/)
  assert.equal(firstPlay.events.length, 3)
  assert.ok(firstPlay.events.every((event) => /^evt_sim_[0-9a-f]{8}$/.test(event.id)))
  assert.ok(firstPlay.events.every((event) =>
    /^ch_sim_[0-9a-f]{8}$/.test(event.data.object.latest_charge)))
  assert.ok(firstPlay.events.every((event) =>
    /^cus_sim_[0-9a-f]{8}$/.test(event.data.object.customer)))
  assert.equal(new Set(generatedIds).size, generatedIds.length)
  assert.equal(new Set(firstPlay.events.map((event) => event.id)).size, 3)
  assert.equal(new Set(firstPlay.events.map((event) =>
    event.data.object.latest_charge)).size, 3)
  assert.ok(firstPlay.events.every((event) => event.data.object.customer.startsWith('cus_sim_')))
  assert.notEqual(firstPlay.paymentId, secondPlay.paymentId)
  assert.notEqual(firstPlay.events[0].id, secondPlay.events[0].id)
  assert.notEqual(
    firstPlay.events[0].data.object.latest_charge,
    secondPlay.events[0].data.object.latest_charge,
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

test('delivers the out-of-order scenario in reverse by default', async () => {
  const scenario = DEMO_SCENARIOS.find((item) => item.id === 'success-then-failure')
  const deliveredCreated = []
  let completed = false
  const delivery = startScenarioDelivery({
    scenario,
    delayScale: 0,
    ingest: (event) => deliveredCreated.push(event.created),
    onComplete: () => { completed = true },
    onError: (error) => { throw error },
    scheduleTimer: (callback) => {
      callback()
      return null
    },
  })

  await delivery.run()

  assert.equal(completed, true)
  assert.equal(deliveredCreated.length, scenario.steps.length)
  assert.ok(deliveredCreated[0] > deliveredCreated[1])
})
