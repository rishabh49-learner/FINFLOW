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

function App() {
  const [cases, setCases] = useState([])
  const [selectedPaymentId, setSelectedPaymentId] = useState('')
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const displayDetails = details?.recoveryCase.paymentId === selectedPaymentId
    ? details
    : null

  const loadCases = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const nextCases = await getJson('/api/cases')
      setCases(nextCases)
      setSelectedPaymentId((current) => (
        nextCases.some((recoveryCase) => recoveryCase.paymentId === current)
          ? current
          : nextCases[0]?.paymentId ?? ''
      ))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }, [])

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

  useEffect(() => {
    if (!selectedPaymentId) return undefined

    let active = true
    getJson(`/api/cases/${encodeURIComponent(selectedPaymentId)}`)
      .then((nextDetails) => {
        if (active) setDetails(nextDetails)
      })
      .catch((requestError) => {
        if (active) setError(requestError.message)
      })

    return () => {
      active = false
    }
  }, [selectedPaymentId, cases])

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
            <span>{cases.length}</span>
          </div>
          {loading && cases.length === 0 && <p className="empty-state">Loading cases…</p>}
          {!loading && cases.length === 0 && (
            <p className="empty-state">No cases yet. Run the demo or send Stripe test events.</p>
          )}
          <ul className="case-list">
            {cases.map((recoveryCase) => (
              <li key={recoveryCase.paymentId}>
                <button
                  className={`case-button${selectedPaymentId === recoveryCase.paymentId ? ' selected' : ''}`}
                  type="button"
                  aria-current={selectedPaymentId === recoveryCase.paymentId ? 'true' : undefined}
                  onClick={() => setSelectedPaymentId(recoveryCase.paymentId)}
                >
                  <span className="case-button-top">
                    <span className="case-id">{recoveryCase.paymentId}</span>
                    <span className={`status status-${recoveryCase.status}`}>{recoveryCase.status.replaceAll('_', ' ')}</span>
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
          {!displayDetails && (
            <div className="empty-detail">
              <h2>Select a recovery case</h2>
              <p>Payment state, recommendation, and event history will appear here.</p>
            </div>
          )}
          {displayDetails && (
            <>
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">PAYMENTINTENT</p>
                  <h2>{displayDetails.recoveryCase.paymentId}</h2>
                  <p className="detail-amount">
                    {formatAmount(displayDetails.recoveryCase.amount, displayDetails.recoveryCase.currency)}
                  </p>
                </div>
                <span className={`status status-${displayDetails.recoveryCase.status}`}>
                  {displayDetails.recoveryCase.status.replaceAll('_', ' ')}
                </span>
              </div>

              <div className="case-facts">
                <div>
                  <span className="fact-label">Failure code</span>
                  <code>{displayDetails.recoveryCase.failureCode ?? '—'}</code>
                </div>
                <div>
                  <span className="fact-label">Mapped category</span>
                  <span>{displayDetails.recoveryCase.failureCategory?.replaceAll('_', ' ') ?? '—'}</span>
                </div>
              </div>

              <article className="recommendation">
                <p className="eyebrow">RECOMMENDED ACTION</p>
                <h3>{displayDetails.recoveryCase.recommendedAction.replaceAll('_', ' ')}</h3>
                <p>{displayDetails.recoveryCase.recommendationReason}</p>
                {displayDetails.recoveryCase.reconciliationReason && (
                  <p className="reconciliation-note">
                    Reconciliation required: {displayDetails.recoveryCase.reconciliationReason}
                  </p>
                )}
              </article>

              <section className="history-section">
                <div className="panel-heading">
                  <h3>Event history</h3>
                  <span>{displayDetails.events.length}</span>
                </div>
                {displayDetails.events.length === 0 && <p className="empty-state">No events recorded.</p>}
                <ol className="event-list">
                  {displayDetails.events.map((event) => (
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