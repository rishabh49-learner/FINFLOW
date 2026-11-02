import { createServer } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import Stripe from 'stripe'
import { normalizeStripeEvent } from './providers/stripe-adapter.js'
import { createRecoveryService } from './domain/recovery-service.js'
import { triagePriority } from './domain/decision-engine.js'
import {
  getDemoScenario,
  startScenarioDelivery,
} from './demo-simulator.js'

const MAX_WEBHOOK_BYTES = 1_048_576
const DEMO_PLAY_LIMIT = 10
const DEMO_PLAY_WINDOW_MS = 60_000
const DEMO_CASE_LIMIT = 50
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
}

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

function getClientIp(request, trustProxyHops) {
  const socketAddress = request.socket.remoteAddress ?? 'unknown'
  if (trustProxyHops === 0) return socketAddress

  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor !== 'string') return socketAddress
  const addresses = forwardedFor.split(',').map((address) => address.trim())
  if (addresses.length < trustProxyHops || addresses.some((address) => !isIP(address))) {
    return socketAddress
  }

  return addresses[addresses.length - trustProxyHops]
}

function parseJsonBody(rawBody) {
  try {
    const body = JSON.parse(rawBody.toString('utf8'))
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new TypeError('Request body must be a JSON object.')
    }
    return body
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw Object.assign(new Error('Request body must be a JSON object.'), { statusCode: 400 })
    }
    throw error
  }
}

function publicCase(recoveryCase) {
  if (!recoveryCase) return null
  return {
    paymentId: recoveryCase.paymentId,
    customerId: recoveryCase.customerId,
    status: recoveryCase.status,
    amount: recoveryCase.amount,
    currency: recoveryCase.currency,
    failureCode: recoveryCase.failureCode,
    failureCategory: recoveryCase.failureCategory,
    recommendedAction: recoveryCase.recommendedAction,
    recommendationReason: recoveryCase.recommendationReason,
    reconciliationReason: recoveryCase.reconciliationReason,
    priority: triagePriority(recoveryCase),
    updatedAt: recoveryCase.updatedAt,
  }
}

function isWithinDirectory(directory, filePath) {
  const pathFromDirectory = relative(directory, filePath)
  return pathFromDirectory === ''
    || (!isAbsolute(pathFromDirectory)
      && !pathFromDirectory.startsWith(`..${sep}`)
      && pathFromDirectory !== '..')
}

async function sendStaticFile(response, staticDir, pathname) {
  const root = await realpath(staticDir)
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const candidate = resolve(root, `.${requestedPath}`)

  if (!isWithinDirectory(root, candidate)) {
    return false
  }

  try {
    const filePath = await realpath(candidate)
    if (!isWithinDirectory(root, filePath) || !(await stat(filePath)).isFile()) {
      return false
    }

    const body = await readFile(filePath)
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    })
    response.end(body)
    return true
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return false
    }
    throw error
  }
}

export function createHttpServer({
  webhookSecret,
  repository,
  service,
  demoMode = false,
  staticDir,
  trustProxyHops = 0,
  demoDelayScale = 1,
  demoScheduleTimer = setTimeout,
  demoCancelTimer = clearTimeout,
  now = Date.now,
  stripeClient = new Stripe(`webhook-verification-${process.pid}`),
}) {
  if (!webhookSecret && !demoMode) throw new Error('STRIPE_WEBHOOK_SECRET is required.')
  if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new RangeError('TRUST_PROXY_HOPS must be a non-negative integer.')
  }
  if (typeof demoDelayScale !== 'number' || !Number.isFinite(demoDelayScale) || demoDelayScale < 0) {
    throw new RangeError('Demo delay scale must be a non-negative number.')
  }
  const recoveryService = service ?? createRecoveryService(repository)
  const demoPlayRequests = new Map()
  const activeDemoPlays = new Map()

  function checkDemoRateLimit(clientIp) {
    const currentTime = now()
    for (const [ip, timestamps] of demoPlayRequests) {
      const recentTimestamps = timestamps.filter((timestamp) =>
        timestamp > currentTime - DEMO_PLAY_WINDOW_MS)
      if (recentTimestamps.length) demoPlayRequests.set(ip, recentTimestamps)
      else demoPlayRequests.delete(ip)
    }

    const timestamps = demoPlayRequests.get(clientIp) ?? []
    if (timestamps.length >= DEMO_PLAY_LIMIT) {
      return Math.max(1, Math.ceil(
        (timestamps[0] + DEMO_PLAY_WINDOW_MS - currentTime) / 1000,
      ))
    }
    timestamps.push(currentTime)
    demoPlayRequests.set(clientIp, timestamps)
    return null
  }

  function normalizeAndIngest(stripeEvent) {
    return recoveryService.ingest(normalizeStripeEvent(stripeEvent))
  }

  const server = createServer(async (request, response) => {
    try {
      let url
      let decodedPathname
      try {
        url = new URL(request.url, 'http://localhost')
        decodedPathname = decodeURIComponent(url.pathname)
      } catch {
        sendJson(response, 400, { error: 'Invalid URL.' })
        return
      }

      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, { status: 'ok', demoMode })
        return
      }

      if (request.method === 'POST'
        && (url.pathname === '/api/demo/play' || url.pathname === '/api/demo/reset')) {
        if (!demoMode) {
          sendJson(response, 404, { error: 'Not found.' })
          return
        }

        if (url.pathname === '/api/demo/reset') {
          for (const play of activeDemoPlays.values()) play.cancel()
          activeDemoPlays.clear()
          const removedCases = repository.resetSimulatorData()
          sendJson(response, 200, { reset: true, removedCases })
          return
        }

        let body
        try {
          body = parseJsonBody(await readRawBody(request))
        } catch (error) {
          sendJson(response, error.statusCode ?? 400, { error: error.message })
          return
        }

        if (typeof body.scenario !== 'string'
          || (body.outOfOrder !== undefined && typeof body.outOfOrder !== 'boolean')) {
          sendJson(response, 400, { error: 'Scenario and outOfOrder are invalid.' })
          return
        }
        const scenario = getDemoScenario(body.scenario)
        if (!scenario) {
          sendJson(response, 400, { error: 'Unknown demo scenario.' })
          return
        }

        const retryAfterSeconds = checkDemoRateLimit(getClientIp(request, trustProxyHops))
        if (retryAfterSeconds !== null) {
          response.writeHead(429, {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': String(retryAfterSeconds),
          })
          response.end(JSON.stringify({
            error: `Too many demo plays. Wait ${retryAfterSeconds} seconds before trying again.`,
            retryAfterSeconds,
          }))
          return
        }

        const play = startScenarioDelivery({
          scenario,
          outOfOrder: body.outOfOrder ?? false,
          delayScale: demoDelayScale,
          ingest: (stripeEvent) => {
            const result = normalizeAndIngest(stripeEvent)
            repository.pruneSimulatorCases(DEMO_CASE_LIMIT)
            return result
          },
          onComplete: () => {
            activeDemoPlays.delete(play.paymentId)
            repository.pruneSimulatorCases(DEMO_CASE_LIMIT)
          },
          onError: (error) => {
            activeDemoPlays.delete(play.paymentId)
            console.error('Demo scenario delivery failed:', error)
          },
          scheduleTimer: demoScheduleTimer,
          cancelTimer: demoCancelTimer,
        })
        activeDemoPlays.set(play.paymentId, play)
        sendJson(response, 202, {
          accepted: true,
          scenario: scenario.id,
          paymentId: play.paymentId,
        })
        setImmediate(() => {
          if (activeDemoPlays.has(play.paymentId)) play.run()
        })
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

      if (request.method === 'POST' && url.pathname === '/webhook' && !webhookSecret) {
        sendJson(response, 404, { error: 'Webhook disabled' })
        return
      }

      if (request.method !== 'POST' || url.pathname !== '/webhook') {
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          sendJson(response, 404, { error: 'Not found.' })
          return
        }

        if (request.method === 'GET' && staticDir) {
          const rawPathname = request.url.split('?')[0]
          let decodedRawPathname
          try {
            decodedRawPathname = decodeURIComponent(rawPathname)
          } catch {
            sendJson(response, 400, { error: 'Invalid URL.' })
            return
          }
          const traversal = [decodedRawPathname, decodedPathname]
            .some((pathname) => pathname.split(/[\\/]/).includes('..'))
          if (traversal) {
            sendJson(response, 404, { error: 'Not found.' })
            return
          }

          if (await sendStaticFile(response, staticDir, decodedPathname)) {
            return
          }
          if (await sendStaticFile(response, staticDir, '/index.html')) {
            return
          }
        }

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

      let result
      try {
        result = normalizeAndIngest(stripeEvent)
      } catch (error) {
        console.error('Stripe event normalization failed:', error.message)
        sendJson(response, 400, { error: error.message })
        return
      }

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
      console.error('HTTP request failed:', error)
      if (response.headersSent) {
        response.destroy(error)
        return
      }
      sendJson(response, 500, { error: 'Internal error' })
    }
  })

  server.on('close', () => {
    for (const play of activeDemoPlays.values()) play.cancel()
    activeDemoPlays.clear()
  })

  return server
}
