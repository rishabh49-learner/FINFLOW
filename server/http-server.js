import { createServer } from 'node:http'
import Stripe from 'stripe'
import { normalizeStripeEvent } from './providers/stripe-adapter.js'
import { createRecoveryService } from './domain/recovery-service.js'

const MAX_WEBHOOK_BYTES = 1_048_576

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let rejected = false

    request.on('data', (chunk) => {
      if (rejected) return
      size += chunk.length
      if (size > MAX_WEBHOOK_BYTES) {
        rejected = true
        reject(Object.assign(new Error('Webhook payload is too large.'), { statusCode: 413 }))
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks))
    })
    request.on('error', reject)
  })
}

function publicCase(recoveryCase) {
  if (!recoveryCase) return null
  return {
    paymentId: recoveryCase.paymentId,
    status: recoveryCase.status,
    amount: recoveryCase.amount,
    currency: recoveryCase.currency,
    failureCode: recoveryCase.failureCode,
    failureCategory: recoveryCase.failureCategory,
    recommendedAction: recoveryCase.recommendedAction,
    recommendationReason: recoveryCase.recommendationReason,
    reconciliationReason: recoveryCase.reconciliationReason,
    updatedAt: recoveryCase.updatedAt,
  }
}

export function createHttpServer({
  webhookSecret,
  repository,
  stripeClient = new Stripe(`webhook-verification-${process.pid}`),
}) {
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is required.')
  const recoveryService = createRecoveryService(repository)

  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')

    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok' })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/cases') {
      sendJson(response, 200, recoveryService.listCases().map(publicCase))
      return
    }

    const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)(\/events)?$/)
    if (request.method === 'GET' && caseMatch) {
      let paymentId
      try {
        paymentId = decodeURIComponent(caseMatch[1])
      } catch {
        sendJson(response, 400, { error: 'Invalid PaymentIntent ID.' })
        return
      }

      const details = recoveryService.getCase(paymentId)
      if (!details) {
        sendJson(response, 404, { error: 'Recovery case not found.' })
        return
      }
      if (caseMatch[2]) {
        sendJson(response, 200, details.events)
        return
      }
      sendJson(response, 200, {
        recoveryCase: publicCase(details.recoveryCase),
        events: details.events,
      })
      return
    }

    if (request.method !== 'POST' || url.pathname !== '/webhook') {
      sendJson(response, 404, { error: 'Not found.' })
      return
    }

    let rawBody
    try {
      rawBody = await readRawBody(request)
    } catch (error) {
      sendJson(response, error.statusCode ?? 400, { error: error.message })
      return
    }

    let stripeEvent
        try {
      const signature = request.headers['stripe-signature']
      stripeEvent = stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      )
    } catch (error) {
      console.error('Stripe webhook verification failed:', error.message)
      sendJson(response, 400, {
        error: 'Invalid Stripe signature or malformed JSON payload.',
      })
      return
    }

       let normalized
    try {
      normalized = normalizeStripeEvent(stripeEvent)
    } catch (error) {
      console.error('Stripe event normalization failed:', error.message)
      sendJson(response, 400, { error: error.message })
      return
    }

    try {
      const result = recoveryService.ingest(normalized)
      if (result.ignored) {
        sendJson(response, 200, { received: true, ignored: true })
        return
      }
      sendJson(response, 200, {
        received: true,
        duplicate: result.duplicate,
        paymentId: result.case.paymentId,
        status: result.case.status,
      })
    } catch (error) {
      console.error('Failed to persist Stripe webhook event:', error)
      sendJson(response, 500, { error: 'Event could not be persisted; Stripe may retry delivery.' })
    }
  })
}
