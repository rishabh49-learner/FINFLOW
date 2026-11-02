import { CONFIG } from '../data/config.js'

const CUSTOMER_COPY_GROUP_BY_CODE = {
  generic_decline: 'retry_wait',
  insufficient_funds: 'retry_wait',
  authentication_failed: 'authentication',
  authentication_required: 'authentication',
  payment_intent_authentication_failure: 'authentication',
  transaction_daily_limit_exceeded: 'retry_wait',
  payment_cancelled: null,
  card_not_supported: 'hard_decline',
  fraudulent: null,
  merchant_blacklist: null,
  lost_card: 'hard_decline',
  stolen_card: null,
}

const CUSTOMER_COPY_BY_GROUP = {
  retry_wait: 'Please wait for the scheduled retry. If your payment still does not go through, contact your card issuer or use another payment method.',
  authentication: 'Your bank needs you to confirm this payment to continue. Follow your bank\'s instructions, then try again.',
  hard_decline: 'Please contact your card issuer or use another payment method.',
}

function formatAmount(amount, currency) {
  if (!Number.isSafeInteger(amount)
    || amount < 0
    || typeof currency !== 'string'
    || !/^[a-z]{3}$/i.test(currency)) {
    return null
  }

  try {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    })
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits
    return formatter.format(amount / (10 ** fractionDigits))
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return null
  }
}

export function customerMessage(recoveryCase) {
  if (!recoveryCase || recoveryCase.status === 'reconciliation_required') return null

  const { failureCode } = recoveryCase
  if (!Object.hasOwn(CONFIG.failureReasonMapping, failureCode)
    || !Object.hasOwn(CUSTOMER_COPY_GROUP_BY_CODE, failureCode)) {
    return null
  }

  const copyGroup = CUSTOMER_COPY_GROUP_BY_CODE[failureCode]
  if (!copyGroup) return null

  const amount = formatAmount(recoveryCase.amount, recoveryCase.currency)
  const paymentText = amount
    ? `Your payment of ${amount} did not go through.`
    : 'Your payment did not go through.'

  return `Hi,\n\n${paymentText} ${CUSTOMER_COPY_BY_GROUP[copyGroup]}\n\nThanks,\nYour payments team`
}
