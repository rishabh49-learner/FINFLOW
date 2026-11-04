import { useCallback, useEffect, useRef, useState } from 'react'
import { CONFIG } from '../data/config.js'
import { customerMessage } from './customer-message.js'
import { formatActivityLabel } from './activity-label.js'
import { getDemoPlayStatus } from './demo-play-status.js'
import { formatCaseTimes } from './format-time.js'
import { LABELS, PRIORITY_RULES } from './labels.js'
import './App.css'

const POLL_INTERVAL = 5_000
const FAST_POLL_INTERVAL = 2_000
const FAST_POLL_DURATION = 15_000
const QUEUE_FILTERS = [
  ['all', LABELS.allCases],
  ['needs-review', LABELS.needsReview],
  ['open', LABELS.open],
  ['resolved', LABELS.resolved],
]

async function getJson(path) {
  const response = await fetch(path)
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.error ?? `Request failed with status ${response.status}.`)
  }
  return response.json()
}

function formatAmount(amount, currency) {
  if (amount === null || amount === undefined || !currency) return LABELS.amountUnavailable

  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    })
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits
    return formatter.format(amount / (10 ** fractionDigits))
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return `${amount} ${currency.toUpperCase()} (${LABELS.minorUnits})`
  }
}

function priorityName(priority) {
  return LABELS.priorityNames[priority] ?? LABELS.standard
}

function priorityClass(priority) {
  return `priority priority-${priority ?? 'standard'}`
}

function failureRule(failureCode) {
  if (!failureCode || !Object.hasOwn(CONFIG.failureReasonMapping, failureCode)) return null
  return CONFIG.failureReasonMapping[failureCode]
}

function caseNextStep(recoveryCase) {
  if (recoveryCase.status === 'resolved') return LABELS.noActionNeeded
  if (recoveryCase.status === 'reconciliation_required') return LABELS.checkPaymentInStripe
  return failureRule(recoveryCase.failureCode)?.nextStep ?? LABELS.reviewPaymentInStripe
}

function customerId(recoveryCase) {
  return recoveryCase.customerId || LABELS.unknownCustomer
}

function needsReview(recoveryCase) {
  return recoveryCase.status === 'reconciliation_required'
}

function sortCases(cases) {
  return [...cases].sort((a, b) => {
    return (a.priority?.rank ?? 3) - (b.priority?.rank ?? 3)
      || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

function caseFilter(cases, filter) {
  if (filter === 'needs-review') return cases.filter(needsReview)
  if (filter === 'open') return cases.filter((item) => item.status === 'open')
  if (filter === 'resolved') return cases.filter((item) => item.status === 'resolved')
  return cases
}

function StatusBadge({ recoveryCase }) {
  const priority = recoveryCase.priority?.level ?? 'standard'
  return <span className={priorityClass(priority)}>{priorityName(priority)}</span>
}

function SummaryStrip({ cases }) {
  const unresolved = cases.filter((item) => item.status !== 'resolved')
  const atRisk = Object.entries(unresolved.reduce((totals, item) => {
    if (item.amount !== null && item.amount !== undefined && item.currency) {
      const currency = item.currency.toUpperCase()
      totals[currency] = (totals[currency] ?? 0) + item.amount
    }
    return totals
  }, {}))

  return (
    <section className="summary-strip" aria-label={LABELS.portfolioSummary}>
      <article className="summary-card summary-review">
        <span>{LABELS.needsReview}</span>
        <strong>{cases.filter(needsReview).length}</strong>
        <small>{LABELS.needsReviewHint}</small>
      </article>
      <article className="summary-card">
        <span>{LABELS.open}</span>
        <strong>{cases.filter((item) => item.status === 'open').length}</strong>
        <small>{LABELS.openHint}</small>
      </article>
      <article className="summary-card">
        <span>{LABELS.resolved}</span>
        <strong>{cases.filter((item) => item.status === 'resolved').length}</strong>
        <small>{LABELS.resolvedHint}</small>
      </article>
      <article className="summary-card summary-risk">
        <span>{LABELS.moneyAtRisk}</span>
        <strong>{atRisk.length
          ? atRisk.map(([currency, amount]) => formatAmount(amount, currency)).join(' · ')
          : LABELS.amountUnavailable}
        </strong>
        <small>{LABELS.moneyAtRiskHint}</small>
      </article>
    </section>
  )
}

function CaseLink({ recoveryCase, onOpen, showCustomer = false, isNew = false }) {
  const rule = failureRule(recoveryCase.failureCode)
  const firstFailure = formatCaseTimes(recoveryCase.firstFailedAt)
  const reason = recoveryCase.status === 'reconciliation_required'
    ? recoveryCase.recommendationReason
    : rule?.reason ?? recoveryCase.recommendationReason
  return (
    <article className="case-card">
      <div className="case-card-top">
        {isNew && <span className="new-case-badge">{LABELS.newCase}</span>}
        <StatusBadge recoveryCase={recoveryCase} />
      </div>
      {showCustomer && <p className="case-customer">{customerId(recoveryCase)}</p>}
      <strong className="case-card-amount">
        {formatAmount(recoveryCase.amount, recoveryCase.currency)}
      </strong>
      <button className="text-link case-id" type="button" onClick={onOpen}>
        {recoveryCase.paymentId}
      </button>
      <time className="case-first-failed" title={firstFailure.absolute}>
        {firstFailure.relative}
      </time>
      <p className="case-card-reason">
        {reason}
      </p>
      <p className="case-card-action">
        {caseNextStep(recoveryCase)}
      </p>
      <button className="subtle-link" type="button" onClick={onOpen}>
        {LABELS.viewCase}
      </button>
    </article>
  )
}

function HomeView({ cases, onNavigate }) {
  const example = sortCases(cases)[0]
  return (
    <div className="page home-page">
      <section className="home-hero">
        <p className="eyebrow">{LABELS.heroEyebrow}</p>
        <h1>{LABELS.heroTitle}</h1>
        <p className="hero-copy">{LABELS.heroDescription}</p>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={() => onNavigate('overview')}>
            {LABELS.openDemo}
          </button>
          <button className="secondary-button" type="button" onClick={() => onNavigate('rules')}>
            {LABELS.readRules}
          </button>
        </div>
        <p className="project-note">{LABELS.projectNote}</p>
      </section>
      {example && (
        <section className="home-example panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{LABELS.exampleCase}</p>
              <h2>{example.paymentId}</h2>
            </div>
            <StatusBadge recoveryCase={example} />
          </div>
          <p className="example-amount">{formatAmount(example.amount, example.currency)}</p>
          <p>{example.status === 'reconciliation_required'
            ? example.recommendationReason
            : failureRule(example.failureCode)?.reason ?? example.recommendationReason}</p>
          <button
            className="subtle-link"
            type="button"
            onClick={() => onNavigate('case', example.paymentId)}
          >
            {LABELS.viewCase}
          </button>
        </section>
      )}
      <HowItWorksSummary onNavigate={onNavigate} />
    </div>
  )
}

function DemoScenarioPanel({
  scenarios,
  onPlay,
  onReset,
  onOpen,
  playStatus,
  readyPaymentId,
}) {
  return (
    <section className="panel demo-scenarios-panel">
      <div className="section-heading">
        <h2>{LABELS.howToTryIt}</h2>
        <button className="subtle-link" type="button" onClick={onReset}>
          {LABELS.resetDemo}
        </button>
      </div>
      <ol className="demo-instructions">
        {LABELS.demoInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
      </ol>
      {playStatus === 'playing' && (
        <p className="playing-status" role="status">{LABELS.playingScenario}</p>
      )}
      {playStatus === 'ready' && (
        <p className="playing-status" role="status">
          <button className="text-link" type="button" onClick={() => onOpen(readyPaymentId)}>
            {LABELS.caseReady}
          </button>
        </p>
      )}
      <div className="demo-scenario-list">
        {scenarios.map((scenario) => (
          <article className="demo-scenario" key={scenario.id}>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onPlay(scenario.id)}
            >
              {scenario.title}
            </button>
            <p>{scenario.description}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function OverviewView({
  cases,
  eventsByCase,
  onOpen,
  onNavigate,
  demoScenarios,
  onPlayScenario,
  onResetDemo,
  playStatus,
  readyPaymentId,
  newPaymentId,
}) {
  const ordered = sortCases(cases)
  const priorityCases = ordered.filter((item) =>
    (item.status === 'open' || needsReview(item))
    && ['urgent', 'high'].includes(item.priority?.level))
  const waitingCases = ordered.filter((item) =>
    item.status === 'open'
    && !['urgent', 'high'].includes(item.priority?.level))
  const recentEvents = Object.entries(eventsByCase)
    .flatMap(([paymentId, events]) => events.map((event) => ({ ...event, paymentId })))
    .sort((a, b) => b.providerCreated - a.providerCreated)
    .slice(0, 3)

  return (
    <div className="page">
      <PageHeading
        eyebrow={LABELS.overview}
        title={LABELS.overviewHeading}
        description={LABELS.overviewDescription}
      />
      <SummaryStrip cases={cases} />
      {demoScenarios !== null && (
        <DemoScenarioPanel
          scenarios={demoScenarios}
          onPlay={onPlayScenario}
          onReset={onResetDemo}
          onOpen={(id) => onOpen(id)}
          playStatus={playStatus}
          readyPaymentId={readyPaymentId}
        />
      )}
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>{LABELS.needsPersonFirst}</h2>
            <p>{LABELS.needsPersonHint}</p>
          </div>
          <button className="subtle-link" type="button" onClick={() => onNavigate('queue')}>
            {LABELS.openFullQueue}
          </button>
        </div>
        {priorityCases.length === 0
          ? <p className="empty-state">{LABELS.noHighPriorityCases}</p>
          : <div className="case-card-grid">
            {priorityCases.map((item) => (
              <CaseLink
                key={item.paymentId}
                recoveryCase={item}
                showCustomer
                isNew={item.paymentId === newPaymentId}
                onOpen={() => onOpen(item.paymentId)}
              />
            ))}
          </div>}
      </section>
      <section className="section-block">
        <div className="section-heading">
          <div>
            <h2>{LABELS.waitingOnRetry}</h2>
            <p>{LABELS.waitingOnRetrySubtitle}</p>
          </div>
        </div>
        {waitingCases.length === 0
          ? <p className="empty-state">{LABELS.noWaitingCases}</p>
          : <div className="case-card-grid">
            {waitingCases.map((item) => (
              <CaseLink
                key={item.paymentId}
                recoveryCase={item}
                showCustomer
                isNew={item.paymentId === newPaymentId}
                onOpen={() => onOpen(item.paymentId)}
              />
            ))}
          </div>}
      </section>
      <section className="section-block panel activity-panel">
        <div className="section-heading">
          <div>
            <h2>{LABELS.recentActivity}</h2>
            <p>{LABELS.recentActivityHint}</p>
          </div>
        </div>
        {recentEvents.length === 0
          ? <p className="empty-state">{LABELS.noRecentActivity}</p>
          : <ol className="activity-list">
            {recentEvents.map((event) => (
              <li key={`${event.paymentId}-${event.eventId}`}>
                <time dateTime={new Date(event.providerCreated * 1000).toISOString()}>
                  {formatCaseTimes(event.providerCreated, event.receivedAt).absolute}
                </time>
                <button className="text-link" type="button" onClick={() => onOpen(event.paymentId)}>
                  {formatActivityLabel(event.eventType)} · {event.paymentId}
                </button>
                <span>{event.details.failureCode ?? LABELS.noFailureCode}</span>
              </li>
            ))}
          </ol>}
      </section>
    </div>
  )
}

function QueueView({ cases, eventsByCase, onOpen }) {
  const [filter, setFilter] = useState('all')
  const visible = sortCases(caseFilter(cases, filter))

  return (
    <div className="page">
      <PageHeading
        eyebrow={LABELS.queue}
        title={LABELS.queueHeading}
        description={LABELS.queueDescription}
      />
      <section className="panel queue-panel">
        <div className="queue-controls">
          <div className="filter-list" aria-label={LABELS.filterCases}>
            {QUEUE_FILTERS.map(([value, label]) => (
              <button
                key={value}
                className={`filter-button${filter === value ? ' selected' : ''}`}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
                {value === 'all' && <span className="filter-count">{cases.length}</span>}
                {value === 'needs-review' && <span className="filter-count">{cases.filter(needsReview).length}</span>}
                {value === 'open' && <span className="filter-count">{cases.filter((item) => item.status === 'open').length}</span>}
                {value === 'resolved' && <span className="filter-count">{cases.filter((item) => item.status === 'resolved').length}</span>}
              </button>
            ))}
          </div>
        </div>
        {visible.length === 0
          ? <p className="empty-state">{cases.length ? LABELS.noMatchingCases : LABELS.noCases}</p>
          : <div className="table-scroll">
            <table className="queue-table">
              <thead>
                <tr>
                  <th scope="col">{LABELS.payment}</th>
                  <th scope="col">{LABELS.customer}</th>
                  <th scope="col">{LABELS.attempts}</th>
                  <th scope="col">{LABELS.lastReason}</th>
                  <th scope="col">{LABELS.nextStep}</th>
                  <th scope="col">{LABELS.priority}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const rule = failureRule(item.failureCode)
                  const events = eventsByCase[item.paymentId]
                  const failures = events
                    ? events.filter((event) => event.eventType.endsWith('payment_failed')).length
                    : LABELS.attemptCountUnavailable
                  return (
                    <tr key={item.paymentId}>
                      <td>
                        <span className="table-amount">{formatAmount(item.amount, item.currency)}</span>
                        <button className="text-link payment-link" type="button" onClick={() => onOpen(item.paymentId)}>
                          {item.paymentId}
                        </button>
                        <time
                          className="table-first-failed"
                          title={formatCaseTimes(item.firstFailedAt).absolute}
                        >
                          {formatCaseTimes(item.firstFailedAt).relative}
                        </time>
                      </td>
                      <td className="customer-cell">{customerId(item)}</td>
                      <td>{failures}</td>
                      <td>{item.status === 'reconciliation_required'
                        ? item.recommendationReason
                        : rule?.reason ?? item.recommendationReason}</td>
                      <td>{caseNextStep(item)}</td>
                      <td><StatusBadge recoveryCase={item} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>}
      </section>
      <p className="queue-note">{LABELS.queueFootnote}</p>
    </div>
  )
}

function RuleApplied({ recoveryCase }) {
  const rule = failureRule(recoveryCase.failureCode)
  if (recoveryCase.status === 'resolved') {
    return (
      <section className="panel rule-applied">
        <p className="eyebrow">{LABELS.ruleApplied}</p>
        <h2>{LABELS.noRuleNeeded}</h2>
        <p>{recoveryCase.recommendationReason}</p>
      </section>
    )
  }
  if (recoveryCase.status === 'reconciliation_required') {
    return (
      <section className="panel rule-applied">
        <p className="eyebrow">{LABELS.ruleApplied}</p>
        <h2>{LABELS.noRuleApplied}</h2>
        <p>{recoveryCase.recommendationReason}</p>
      </section>
    )
  }
  return (
    <section className="panel rule-applied">
      <p className="eyebrow">{LABELS.ruleApplied}</p>
      {rule
        ? <>
          <h2><code>{recoveryCase.failureCode}</code> · {rule.category.replaceAll('_', ' ')}</h2>
          <p>{rule.reason}</p>
          <dl className="rule-facts">
            <div><dt>{LABELS.nextStep}</dt><dd>{rule.nextStep ?? LABELS.reviewPaymentInStripe}</dd></div>
            {rule.source && <div><dt>{LABELS.source}</dt><dd>{rule.source}</dd></div>}
            {rule.sourceUrl && (
              <div>
                <dt>{LABELS.source}</dt>
                <dd><a href={rule.sourceUrl} target="_blank" rel="noopener noreferrer">{rule.sourceUrl}</a></dd>
              </div>
            )}
            {rule.adviceCodeSourceUrl && (
              <div>
                <dt>{LABELS.adviceCodeSource}</dt>
                <dd><a href={rule.adviceCodeSourceUrl} target="_blank" rel="noopener noreferrer">
                  {rule.adviceCodeSourceUrl}
                </a></dd>
              </div>
            )}
          </dl>
        </>
        : <>
          <h2>{LABELS.noRuleApplied}</h2>
          <p>{recoveryCase.reconciliationReason ?? recoveryCase.recommendationReason}</p>
        </>}
    </section>
  )
}

function AttemptsTimeline({ events }) {
  return (
    <section className="section-block timeline-section">
      <div className="section-heading">
        <div>
          <h2>{LABELS.whatHappened}</h2>
          <p>{LABELS.attemptsTimeline}</p>
        </div>
        <span className="event-count">{events.length}</span>
      </div>
      {events.length === 0
        ? <p className="empty-state">{LABELS.noEvents}</p>
        : <ol className="timeline">
          {events.map((event, index) => {
            const failed = event.eventType.endsWith('payment_failed')
            const attemptNumber = failed
              ? events.slice(0, index + 1)
                .filter((item) => item.eventType.endsWith('payment_failed')).length
              : 0
            return (
              <li className="timeline-item" key={event.eventId}>
                <span className={`timeline-marker${failed ? ' failed' : ' succeeded'}`} aria-hidden="true" />
                <div className="timeline-content">
                  <div className="timeline-title">
                    <strong>{failed
                      ? `${LABELS.attempt} ${attemptNumber} ${LABELS.failed}`
                      : event.eventType.endsWith('payment_succeeded')
                        ? LABELS.paymentSucceeded
                        : event.eventType.replaceAll('_', ' ')}
                    </strong>
                    <time dateTime={new Date(event.providerCreated * 1000).toISOString()}>
                      {formatCaseTimes(event.providerCreated, event.receivedAt).absolute}
                    </time>
                  </div>
                  <p>{event.details.failureCode
                    ? `${LABELS.failureCode}: ${event.details.failureCode}`
                    : event.eventType.endsWith('payment_succeeded')
                      ? LABELS.paymentSucceeded
                      : LABELS.noFailureCode}
                  {event.details.amount !== null && event.details.currency
                    ? ` · ${formatAmount(event.details.amount, event.details.currency)}`
                    : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>}
    </section>
  )
}

function CaseView({
  recoveryCase,
  events,
  loading,
  error,
  cases,
  onBack,
  followUps,
  onToggleFollowUp,
}) {
  const [technicalOpen, setTechnicalOpen] = useState(false)
  const [copyState, setCopyState] = useState('')
  const message = recoveryCase ? customerMessage(recoveryCase) : null
  const relatedCases = recoveryCase?.customerId
    ? cases.filter((item) => item.customerId === recoveryCase.customerId && item.paymentId !== recoveryCase.paymentId)
    : []
  const followUp = recoveryCase ? followUps[recoveryCase.paymentId] ?? {} : {}
  const firstFailedEvent = events
    .filter((event) => event.eventType.endsWith('payment_failed'))
    .sort((a, b) => a.providerCreated - b.providerCreated)[0]
  const firstFailureTimes = formatCaseTimes(
    firstFailedEvent?.providerCreated ?? recoveryCase?.firstFailedAt,
    firstFailedEvent?.receivedAt,
  )

  async function copyMessage() {
    if (!message) return
    try {
      await navigator.clipboard.writeText(message)
      setCopyState(LABELS.copiedNotSent)
    } catch (error) {
      setCopyState(error instanceof Error ? `${LABELS.copyFailed}: ${error.message}` : LABELS.copyFailed)
    }
  }

  if (loading) {
    return <div className="page"><p className="empty-state">{LABELS.loadingCase}</p></div>
  }
  if (error) {
    return <div className="page">
      <button className="subtle-link" type="button" onClick={onBack}>{LABELS.backToQueue}</button>
      <p className="error-banner" role="alert">{error}</p>
    </div>
  }
  if (!recoveryCase) {
    return <div className="page">
      <button className="subtle-link" type="button" onClick={onBack}>{LABELS.backToQueue}</button>
      <p className="empty-state">{LABELS.caseUnavailable}</p>
    </div>
  }

  return (
    <div className="page case-page">
      <button className="back-link" type="button" onClick={onBack}>← {LABELS.backToQueue}</button>
      <div className="case-detail-grid">
        <div className="case-main-column">
          <section className="panel case-overview">
            <div className="case-detail-heading">
              <div>
                <p className="eyebrow">{LABELS.caseDetail}</p>
                <h1>{recoveryCase.paymentId}</h1>
                <p className="example-amount">{formatAmount(recoveryCase.amount, recoveryCase.currency)}</p>
              </div>
              <StatusBadge recoveryCase={recoveryCase} />
            </div>
            <div className="case-metadata">
              <div><span>{LABELS.customer}</span><strong>{customerId(recoveryCase)}</strong></div>
              <div><span>{LABELS.attempts}</span><strong>{events.filter((item) => item.eventType.endsWith('payment_failed')).length}</strong></div>
              <div>
                <span>{LABELS.lastUpdated}</span>
                <strong>{formatCaseTimes(Date.parse(recoveryCase.updatedAt) / 1000).absolute}</strong>
              </div>
            </div>
          </section>
          <section className="panel next-step-panel">
            <p className="eyebrow">{LABELS.nextStep}</p>
            <h2>{caseNextStep(recoveryCase)}</h2>
            <p>{recoveryCase.status === 'reconciliation_required'
              ? recoveryCase.recommendationReason
              : failureRule(recoveryCase.failureCode)?.reason ?? recoveryCase.recommendationReason}</p>
          </section>
          <AttemptsTimeline events={events} />
          <section className="panel message-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{LABELS.customerMessagePreview}</p>
                <h2>{LABELS.notSent}</h2>
              </div>
              <button className="secondary-button" type="button" onClick={copyMessage} disabled={!message}>
                {message ? LABELS.copyCustomerMessage : 'No message until this case is classified.'}
              </button>
            </div>
            <pre className="message-preview">{message}</pre>
            <p className="privacy-note">{LABELS.messagePrivacy}</p>
            {copyState && <p className="copy-feedback" role="status">{copyState}</p>}
          </section>
          <section className="panel follow-up-panel">
            <div className="section-heading">
              <div>
                <h2>{LABELS.followUp}</h2>
                <p>{LABELS.followUpHint}</p>
              </div>
            </div>
            <div className="follow-up-actions">
              <button
                className={`secondary-button${followUp.contacted ? ' selected' : ''}`}
                type="button"
                aria-pressed={Boolean(followUp.contacted)}
                onClick={() => onToggleFollowUp(recoveryCase.paymentId, 'contacted')}
              >
                {followUp.contacted ? LABELS.markedContacted : LABELS.markContacted}
              </button>
              <button
                className={`secondary-button${followUp.assigned ? ' selected' : ''}`}
                type="button"
                aria-pressed={Boolean(followUp.assigned)}
                onClick={() => onToggleFollowUp(recoveryCase.paymentId, 'assigned')}
              >
                {followUp.assigned ? LABELS.assignedToYou : LABELS.assignToYou}
              </button>
            </div>
          </section>
        </div>
        <aside className="case-side-column">
          <RuleApplied recoveryCase={recoveryCase} />
          <section className="panel details-panel">
            <button
              className="details-toggle"
              type="button"
              aria-expanded={technicalOpen}
              onClick={() => setTechnicalOpen((open) => !open)}
            >
              {technicalOpen ? LABELS.hideTechnicalDetails : LABELS.technicalDetails}
            </button>
            {technicalOpen && (
              <dl className="technical-details">
                <div><dt>{LABELS.paymentId}</dt><dd>{recoveryCase.paymentId}</dd></div>
                <div>
                  <dt>{LABELS.firstFailed}</dt>
                  <dd>{firstFailureTimes.relative} · {firstFailureTimes.absolute}</dd>
                </div>
                <div><dt>{LABELS.failureCode}</dt><dd>{recoveryCase.failureCode ?? LABELS.none}</dd></div>
                <div><dt>{LABELS.status}</dt><dd>{recoveryCase.status}</dd></div>
                <div><dt>{LABELS.recommendedAction}</dt><dd>{caseNextStep(recoveryCase)}</dd></div>
                {events.map((event) => (
                  <div key={event.eventId}>
                    <dt>{event.eventType} · {LABELS.eventId}</dt>
                    <dd>{event.eventId}</dd>
                  </div>
                ))}
                {events.map((event) => (
                  <div key={`${event.eventId}-received`}>
                    <dt>{LABELS.received} · {event.eventType}</dt>
                    <dd>{formatCaseTimes(event.providerCreated, event.receivedAt).received}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="panel related-panel">
            <h2>{LABELS.otherCustomerCases}</h2>
            {relatedCases.length
              ? relatedCases.map((item) => (
                <div className="related-case" key={item.paymentId}>
                  <span>{item.paymentId}</span><StatusBadge recoveryCase={item} />
                </div>
              ))
              : <p>{LABELS.noOtherCases}</p>}
          </section>
          {(followUp.contacted || followUp.assigned) && (
            <section className="panel follow-up-summary">
              <h2>{LABELS.followUp}</h2>
              {followUp.contacted && <p>{LABELS.markedContacted} · {LABELS.justNow}</p>}
              {followUp.assigned && <p>{LABELS.assignedToYou} · {LABELS.justNow}</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}

function RulesView() {
  const rules = Object.entries(CONFIG.failureReasonMapping)
  return (
    <div className="page">
      <PageHeading
        eyebrow={LABELS.rules}
        title={LABELS.rulesHeading}
        description={LABELS.rulesDescription}
      />
      <section className="section-block">
        <h2>{LABELS.failureMappings}</h2>
        <div className="rules-list">
          {rules.map(([code, rule]) => (
            <article className="panel rule-card" key={code}>
              <div className="rule-card-heading">
                <code>{code}</code>
                <span className="category-label">{rule.category.replaceAll('_', ' ')}</span>
              </div>
              <p>{rule.reason}</p>
              <dl className="rule-facts">
                <div><dt>{LABELS.nextStep}</dt><dd>{rule.nextStep ?? LABELS.reviewPaymentInStripe}</dd></div>
                {rule.source && <div><dt>{LABELS.source}</dt><dd>{rule.source}</dd></div>}
                {rule.sourceUrl && (
                  <div>
                    <dt>{LABELS.source}</dt>
                    <dd><a href={rule.sourceUrl} target="_blank" rel="noopener noreferrer">{rule.sourceUrl}</a></dd>
                  </div>
                )}
                {rule.adviceCodeSourceUrl && (
                  <div>
                    <dt>{LABELS.adviceCodeSource}</dt>
                    <dd><a href={rule.adviceCodeSourceUrl} target="_blank" rel="noopener noreferrer">
                      {rule.adviceCodeSourceUrl}
                    </a></dd>
                  </div>
                )}
              </dl>
            </article>
          ))}
        </div>
      </section>
      <section className="section-block">
        <h2>{LABELS.priorityRules}</h2>
        <div className="rules-list priority-rules">
          {PRIORITY_RULES.map((rule) => (
            <article className="panel rule-card" key={rule.level}>
              <div className="rule-card-heading">
                <span className={priorityClass(rule.level)}>{rule.label}</span>
                <span className="priority-rank">{LABELS.rank} {rule.rank}</span>
              </div>
              <p>{rule.description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function HowItWorksSummary({ onNavigate }) {
  return (
    <section className="section-block how-summary">
      <div className="section-heading">
        <div>
          <h2>{LABELS.howItWorks}</h2>
          <p>{LABELS.howItWorksHint}</p>
        </div>
        <button className="subtle-link" type="button" onClick={() => onNavigate('how-it-works')}>
          {LABELS.fullPipeline}
        </button>
      </div>
      <HowItWorksSteps />
    </section>
  )
}

function HowItWorksSteps() {
  return (
    <ol className="steps-grid">
      {LABELS.pipelineSteps.map((step, index) => (
        <li className="panel step-card" key={step.title}>
          <span className="step-number">{index + 1}</span>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
        </li>
      ))}
    </ol>
  )
}

function HowItWorksView() {
  return (
    <div className="page">
      <PageHeading
        eyebrow={LABELS.howItWorks}
        title={LABELS.pipelineHeading}
        description={LABELS.pipelineDescription}
      />
      <HowItWorksSteps />
      <section className="panel pipeline-note">
        <h2>{LABELS.whatFinflowDoes}</h2>
        <p>{LABELS.whatFinflowDoesCopy}</p>
      </section>
    </div>
  )
}

function PageHeading({ eyebrow, title, description }) {
  return (
    <div className="page-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}

function App() {
  const [cases, setCases] = useState([])
  const [eventsByCase, setEventsByCase] = useState({})
  const [detailState, setDetailState] = useState({ paymentId: '', error: '' })
  const [selectedPaymentId, setSelectedPaymentId] = useState('')
  const [view, setView] = useState('home')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [demoMode, setDemoMode] = useState(false)
  const [demoScenarios, setDemoScenarios] = useState(null)
  const [playingPaymentId, setPlayingPaymentId] = useState('')
  const [newPaymentId, setNewPaymentId] = useState('')
  const [fastPollUntil, setFastPollUntil] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [clockNow, setClockNow] = useState(0)
  const [followUps, setFollowUps] = useState({})
  const requestInFlight = useRef(false)

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (requestInFlight.current) return
    requestInFlight.current = true
    if (!silent) setLoading(true)
    try {
      const nextCases = await getJson('/api/cases')
      setCases(nextCases)
      setLastUpdated(Date.now())
      setError('')
    } catch {
      setError(LABELS.wakingUp)
    } finally {
      requestInFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    requestInFlight.current = true
    Promise.all([getJson('/api/cases'), getJson('/api/health')])
      .then(([nextCases, health]) => {
        if (!active) return
        setCases(nextCases)
        setLastUpdated(Date.now())
        setDemoMode(Boolean(health.demoMode))
        setError('')
      })
      .catch(() => {
        if (active) setError(LABELS.wakingUp)
      })
      .finally(() => {
        if (active) {
          requestInFlight.current = false
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [refresh])

  useEffect(() => {
    let active = true
    getJson('/api/demo/scenarios')
      .then((scenarios) => {
        if (active && Array.isArray(scenarios)) setDemoScenarios(scenarios)
      })
      .catch(() => {
        if (active) setDemoScenarios(null)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const fastPolling = fastPollUntil > Date.now()
    const intervalId = setInterval(
      () => refresh({ silent: true }),
      fastPolling ? FAST_POLL_INTERVAL : POLL_INTERVAL,
    )
    const fastPollTimeout = fastPolling
      ? setTimeout(() => setFastPollUntil(0), fastPollUntil - Date.now())
      : null
    return () => {
      clearInterval(intervalId)
      if (fastPollTimeout !== null) clearTimeout(fastPollTimeout)
    }
  }, [fastPollUntil, refresh])

  useEffect(() => {
    const intervalId = setInterval(() => setClockNow(Date.now()), 1000)
    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (view !== 'case' || !selectedPaymentId) return undefined

    let active = true
    getJson(`/api/cases/${encodeURIComponent(selectedPaymentId)}`)
      .then((details) => {
        if (!active) return
        setEventsByCase((current) => ({ ...current, [selectedPaymentId]: details.events }))
        setDetailState({ paymentId: selectedPaymentId, error: '' })
      })
      .catch(() => {
        if (active) {
          setDetailState({
            paymentId: selectedPaymentId,
            error: LABELS.wakingUp,
          })
        }
      })

    return () => {
      active = false
    }
  }, [selectedPaymentId, view])

  const selectedCase = cases.find((item) => item.paymentId === selectedPaymentId) ?? null
  const demoPlayStatus = getDemoPlayStatus(playingPaymentId, cases)
  const selectedEvents = eventsByCase[selectedPaymentId] ?? []
  const detailLoading = view === 'case' && detailState.paymentId !== selectedPaymentId
  const detailError = detailState.paymentId === selectedPaymentId ? detailState.error : ''

  async function playScenario(scenarioId) {
    setError('')
    setPlayingPaymentId('')
    setNewPaymentId('')
    try {
      const response = await fetch('/api/demo/play', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: scenarioId }),
      })
      const result = await response.json()
      if (response.status === 429) {
        const seconds = result?.retryAfterSeconds
        setError(Number.isSafeInteger(seconds) && seconds > 0
          ? LABELS.waitBeforeRetry.replace('{seconds}', String(seconds))
          : LABELS.wakingUp)
        return
      }
      if (!response.ok || typeof result.paymentId !== 'string') {
        setError(LABELS.wakingUp)
        return
      }
      setPlayingPaymentId(result.paymentId)
      setNewPaymentId(result.paymentId)
      setFastPollUntil(Date.now() + FAST_POLL_DURATION)
    } catch {
      setError(LABELS.wakingUp)
    }
  }

  async function resetDemo() {
    setError('')
    try {
      const response = await fetch('/api/demo/reset', { method: 'POST' })
      if (!response.ok) {
        setError(LABELS.wakingUp)
        return
      }
      setPlayingPaymentId('')
      setNewPaymentId('')
      await refresh()
    } catch {
      setError(LABELS.wakingUp)
    }
  }

  function navigate(nextView, paymentId = '') {
    if (paymentId) setSelectedPaymentId(paymentId)
    setView(nextView)
    if (nextView === 'queue') {
      const missingCases = cases.filter((item) => !eventsByCase[item.paymentId])
      Promise.allSettled(missingCases.map(async (item) => {
        const details = await getJson(`/api/cases/${encodeURIComponent(item.paymentId)}`)
        return [item.paymentId, details.events]
      })).then((results) => {
        const loadedEvents = {}
        let failedRequest
        results.forEach((result) => {
          if (result.status === 'fulfilled') {
            loadedEvents[result.value[0]] = result.value[1]
          } else {
            failedRequest = result.reason
          }
        })
        if (Object.keys(loadedEvents).length > 0) {
          setEventsByCase((current) => ({ ...current, ...loadedEvents }))
        }
        if (failedRequest) setError(LABELS.wakingUp)
      })
    }
    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function toggleFollowUp(paymentId, key) {
    setFollowUps((current) => ({
      ...current,
      [paymentId]: {
        ...current[paymentId],
        [key]: !current[paymentId]?.[key],
      },
    }))
  }

  const navItems = [
    ['overview', LABELS.overview],
    ['queue', LABELS.queue],
    ['rules', LABELS.rules],
    ['how-it-works', LABELS.howItWorks],
  ]

  return (
    <div className="workbench">
      <header className="site-header">
        <button className="brand" type="button" onClick={() => navigate('home')} aria-label={LABELS.goHome}>
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>{LABELS.brand}</span>
        </button>
        <nav className="desktop-nav" aria-label={LABELS.primaryNavigation}>
          {navItems.map(([target, label]) => (
            <button
              className={`nav-link${view === target || (view === 'case' && target === 'queue') ? ' active' : ''}`}
              key={target}
              type="button"
              aria-current={view === target || (view === 'case' && target === 'queue') ? 'page' : undefined}
              onClick={() => navigate(target)}
            >
              {label}
            </button>
          ))}
        </nav>
        <details className="compact-nav">
          <summary>{LABELS.menu}</summary>
          <nav aria-label={LABELS.primaryNavigation}>
            <button type="button" onClick={() => navigate('home')}>{LABELS.home}</button>
            {navItems.map(([target, label]) => (
              <button type="button" key={target} onClick={() => navigate(target)}>{label}</button>
            ))}
          </nav>
        </details>
        {lastUpdated !== null && (
          <span className="last-updated">
            {LABELS.updatedAgo.replace(
              '{seconds}',
              String(Math.max(0, Math.floor((clockNow - lastUpdated) / 1000))),
            )}
          </span>
        )}
      </header>

      {demoMode && (
        <aside className="demo-banner">
          {demoScenarios !== null ? LABELS.demoBanner : LABELS.legacyDemoBanner}
        </aside>
      )}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {loading && cases.length === 0 && <p className="loading-banner">{LABELS.loadingCases}</p>}
      {!loading && cases.length === 0 && !error && (
        <p className="loading-banner">{LABELS.noCases}</p>
      )}
      {view === 'home' && <HomeView cases={cases} onNavigate={navigate} />}
      {view === 'overview' && (
        <OverviewView
          cases={cases}
          eventsByCase={eventsByCase}
          onOpen={(id) => navigate('case', id)}
          onNavigate={navigate}
          demoScenarios={demoScenarios}
          onPlayScenario={playScenario}
          onResetDemo={resetDemo}
          playStatus={demoPlayStatus}
          readyPaymentId={demoPlayStatus === 'ready' ? playingPaymentId : ''}
          newPaymentId={newPaymentId}
        />
      )}
      {view === 'queue' && (
        <QueueView
          cases={cases}
          eventsByCase={eventsByCase}
          onOpen={(id) => navigate('case', id)}
        />
      )}
      {view === 'case' && (
        <CaseView
          key={selectedPaymentId}
          recoveryCase={selectedCase}
          events={selectedEvents}
          loading={detailLoading}
          error={detailError}
          cases={cases}
          onBack={() => navigate('queue')}
          followUps={followUps}
          onToggleFollowUp={toggleFollowUp}
        />
      )}
      {view === 'rules' && <RulesView />}
      {view === 'how-it-works' && <HowItWorksView />}
      <footer className="site-footer">{LABELS.footer}</footer>
    </div>
  )
}

export default App
