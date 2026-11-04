import assert from 'node:assert/strict'
import test from 'node:test'
import { getDemoPlayStatus } from './demo-play-status.js'

test('changes a played scenario from playing to ready when its case is listed', () => {
  const cases = [{ paymentId: 'pi_sim_ready' }]

  assert.equal(getDemoPlayStatus('', cases), null)
  assert.equal(getDemoPlayStatus('pi_sim_pending', cases), 'playing')
  assert.equal(getDemoPlayStatus('pi_sim_ready', cases), 'ready')
})
