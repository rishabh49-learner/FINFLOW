const SUPPORTED_EVENTS = new Map([
  ['payment_intent.payment_failed', 'payment_failed'],
  ['payment_intent.succeeded', 'payment_succeeded'],
])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalAmount(object, eventType) {
  const amount = eventType === 'payment_succeeded'
    ? object.amount_received ?? object.amount
    : object.amount
  if (amount === undefined || amount === null) return null
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new TypeError('PaymentIntent amount must be a non-negative integer.')
  }
  return amount
}

function optionalCurrency(object) {
  const currency = object.currency
  if (currency === undefined || currency === null) return null
  if (typeof currency !== 'string' || !/^[a-z]{3}$/i.test(currency)) {
    throw new TypeError('PaymentIntent currency must be a three-letter code.')
  }
  return currency.toLowerCase()
}

export function normalizeStripeEvent(event) {
  if (!isRecord(event)
    || typeof event.id !== 'string'
    || !event.id.startsWith('evt_')
    || typeof event.type !== 'string'
    || !Number.isSafeInteger(event.created)
    || event.created < 0
    || typeof event.livemode !== 'boolean'
    || !isRecord(event.data)
    || !isRecord(event.data.object)) {
    throw new TypeError('Malformed Stripe event envelope.')
  }

  if (event.livemode) {
    throw new TypeError('Live-mode Stripe events are not accepted.')
  }

  const eventType = SUPPORTED_EVENTS.get(event.type)
  if (!eventType) {
    return { supported: false, eventId: event.id, providerEventType: event.type }
  }

  const paymentIntent = event.data.object
  if (paymentIntent.object !== 'payment_intent'
    || typeof paymentIntent.id !== 'string'
    || !paymentIntent.id.startsWith('pi_')) {
    throw new TypeError('Malformed Stripe PaymentIntent event.')
  }

  let failureCode = null
  if (eventType === 'payment_failed') {
    const error = paymentIntent.last_payment_error
    if (!isRecord(error)) {
      throw new TypeError('Failed PaymentIntent is missing last_payment_error.')
    }

    failureCode = typeof error.decline_code === 'string'
      ? error.decline_code
      : typeof error.code === 'string'
        ? error.code
        : null
    if (!failureCode) {
      throw new TypeError('Failed PaymentIntent is missing a failure code.')
    }
  }

  return {
    supported: true,
    event: {
      provider: 'stripe',
      eventId: event.id,
      providerEventType: event.type,
      eventType,
      paymentId: paymentIntent.id,
      providerCreated: event.created,
      amount: optionalAmount(paymentIntent, eventType),
      currency: optionalCurrency(paymentIntent),
      failureCode,
    },
  }
}
