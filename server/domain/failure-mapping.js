import { CONFIG } from '../../data/config.js'

export function mapFailureCode(code) {
  if (typeof code !== 'string') return null
  if (!Object.hasOwn(CONFIG.failureReasonMapping, code)) return null

  const mapping = CONFIG.failureReasonMapping[code]
  if (!mapping) return null

  return {
    code,
    category: mapping.category,
    action: mapping.action,
    reason: mapping.reason,
    weight: CONFIG.failureReasonWeights[code] ?? null,
  }
}
