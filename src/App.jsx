import { useCallback, useEffect, useState } from 'react'
import './App.css'

async function getJson(path) {
  const response = await fetch(path)
  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error ?? `Request failed with status ${response.status}.`)
  }
  return response.json()
}

function formatAmount(amount, currency) {
  if (amount === null || !currency) return 'Amount unavailable'

  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    })
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits
    return formatter.format(amount / (10 ** fractionDigits))
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    return `${amount} ${currency.toUpperCase()} (minor units)`
  }
}

function formatProviderTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString()
}

function filterCases(cases, filter) {
  if (filter === 'all') return cases
  const status = filter === 'reconciliation' ? 'reconciliation_required' : filter
  return cases.filter((recoveryCase) => recoveryCase.status === status)
}

function App() {
  const [cases, setCases] = useState([])
  const [selectedPaymentId, setSelectedPaymentId] = useState('')
  const [caseFilter, setCaseFilter] = useState('all')
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const visibleCases = filterCases(cases, caseFilter)
  const activePaymentId = visibleCases.some(
    (recoveryCase) => recoveryCase.paymentId === selectedPaymentId,
  )
    ? selectedPaymentId
    : visibleCases[0]?.paymentId ?? ''
  const visibleDetails = details?.recoveryCase.paymentId === activePaymentId ? details : null

  const loadCases = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const nextCases = await getJson('/api/cases')
      setCases(nextCases)
      const nextVisibleCases = filterCases(nextCases, caseFilter)
      setSelectedPaymentId((current) => (
        nextVisibleCases.some((recoveryCase) => recoveryCase.paymentId === current)
          ? current
          : nextVisibleCases[0]?.paymentId ?? ''
      ))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [caseFilter])

  useEffect(() => {
    let active = true
    async function loadInitialCases() {
      try {
        const nextCases = await getJson('/api/cases')
        if (!active) return
        setCases(nextCases)
        setSelectedPaymentId(nextCases[0]?.paymentId ?? '')
      } catch (requestError) {
        if (active) setError(requestError.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    loadInitialCases()
    return () => {
      active = false
    }
  }, [])

  function selectFilter(filter) {
    setCaseFilter(filter)
    const nextVisibleCases = filterCases(cases, filter)
    if (!nextVisibleCases.some((recoveryCase) => recoveryCase.paymentId === selectedPaymentId)) {
      setSelectedPaymentId(nextVisibleCases[0]?.paymentId ?? '')
    }
  }

  useEffect(() => {
    if (!activePaymentId) return undefined

    let active = true
    getJson(`/api/cases/${encodeURIComponent(activePaymentId)}`)
      .then((nextDetails) => {
        if (active) setDetails(nextDetails)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })

    return () => {
      active = false
    }
  }, [activePaymentId, cases])

  return (
    <main className="workbench">
      <header className="workbench-header">
        <div>
          <p className="eyebrow">FINFLOW · PAYMENT OPERATIONS</p>
          <h1>Recovery workbench</h1>
          <p className="subtitle">Stripe test-mode PaymentIntent events and explainable next steps.</p>
        </div>
        <button className="refresh-button" type="button" onClick={loadCases} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh cases'}
        </button>
      </header>

      {error && <p className="error-banner" role="alert">{error}</p>}

      <div className="workbench-layout">
        <aside className="case-panel" aria-label="Recovery cases">
          <div className="panel-heading">
            <h2>Recovery cases</h2>
            <span>{visibleCases.length}</span>
          </div>
          <div className="case-filters" aria-label="Filter recovery cases">
            {[
              ['all', 'All'],
              ['open', 'Open'],
              ['reconciliation', 'Reconciliation'],
              ['resolved', 'Resolved'],
            ].map(([filter, label]) => (
              <button
                key={filter}
                className={`filter-button${caseFilter === filter ? ' selected' : ''}`}
                type="button"
                aria-pressed={caseFilter === filter}
                onClick={() => selectFilter(filter)}
              >
                {label}
              </button>
            ))}
          </div>
          {loading && cases.length === 0 && <p className="empty-state">Loading cases…</p>}
          {!loading && visibleCases.length === 0 && (
            <p className="empty-state">
              {cases.length === 0
                ? 'No cases yet. Run the demo or send Stripe test events.'
                : 'No cases match this filter.'}
            </p>
          )}
          <ul className="case-list">
            {visibleCases.map((recoveryCase) => (
              <li key={recoveryCase.paymentId}>
                <button
                  className={`case-button${activePaymentId === recoveryCase.paymentId ? ' selected' : ''}`}
                  type="button"
                  aria-current={activePaymentId === recoveryCase.paymentId ? 'true' : undefined}
                  onClick={() => setSelectedPaymentId(recoveryCase.paymentId)}
                >
                  <span className="case-button-top">
                    <span className="case-id">{recoveryCase.paymentId}</span>
                    <span className="case-badges">
                      <span className={`priority priority-${recoveryCase.priority.level}`}>
                        {recoveryCase.priority.level}
                      </span>
                      <span className={`status status-${recoveryCase.status}`}>
                        {recoveryCase.status.replaceAll('_', ' ')}
                      </span>
                    </span>
                  </span>
                  <span className="case-amount">
                    {formatAmount(recoveryCase.amount, recoveryCase.currency)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="detail-panel" aria-live="polite">
          {!visibleDetails && (
            <div className="empty-detail">
              <h2>Select a recovery case</h2>
              <p>Payment state, recommendation, and event history will appear here.</p>
            </div>
          )}
          {visibleDetails && (
            <>
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">PAYMENTINTENT</p>
                  <h2>{visibleDetails.recoveryCase.paymentId}</h2>
                  <p className="detail-amount">
                    {formatAmount(visibleDetails.recoveryCase.amount, visibleDetails.recoveryCase.currency)}
                  </p>
                </div>
                <span className={`status status-${visibleDetails.recoveryCase.status}`}>
                  {visibleDetails.recoveryCase.status.replaceAll('_', ' ')}
                </span>
              </div>

              <div className="case-facts">
                <div>
                  <span className="fact-label">Triage priority</span>
                  <span className={`priority priority-${visibleDetails.recoveryCase.priority.level}`}>
                    {visibleDetails.recoveryCase.priority.level}
                  </span>
                  <small className="priority-reason">{visibleDetails.recoveryCase.priority.reason}</small>
                </div>
                <div>
                  <span className="fact-label">Failure code</span>
                  <code>{visibleDetails.recoveryCase.failureCode ?? '—'}</code>
                </div>
                <div>
                  <span className="fact-label">Mapped category</span>
                  <span>{visibleDetails.recoveryCase.failureCategory?.replaceAll('_', ' ') ?? '—'}</span>
                </div>
              </div>

              <article className="recommendation">
                <p className="eyebrow">RECOMMENDED ACTION</p>
                <h3>{visibleDetails.recoveryCase.recommendedAction.replaceAll('_', ' ')}</h3>
                <p>{visibleDetails.recoveryCase.recommendationReason}</p>
                {visibleDetails.recoveryCase.reconciliationReason && (
                  <p className="reconciliation-note">
                    Reconciliation required: {visibleDetails.recoveryCase.reconciliationReason}
                  </p>
                )}
              </article>

              <section className="history-section">
                <div className="panel-heading">
                  <h3>Event history</h3>
                  <span>{visibleDetails.events.length}</span>
                </div>
                {visibleDetails.events.length === 0 && <p className="empty-state">No events recorded.</p>}
                <ol className="event-list">
                  {visibleDetails.events.map((event) => (
                    <li key={event.eventId} className="event-item">
                      <div className="event-topline">
                        <strong>{event.eventType}</strong>
                        <time dateTime={new Date(event.providerCreated * 1000).toISOString()}>
                          {formatProviderTime(event.providerCreated)}
                        </time>
                      </div>
                      <p>
                        {event.details.failureCode
                          ? `Failure code: ${event.details.failureCode}`
                          : 'No failure code'}
                        {event.details.amount !== null && event.details.currency
                          ? ` · ${formatAmount(event.details.amount, event.details.currency)}`
                          : ''}
                      </p>
                      <small>Event {event.eventId} · received {new Date(event.receivedAt).toLocaleString()}</small>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  )
}

export default App