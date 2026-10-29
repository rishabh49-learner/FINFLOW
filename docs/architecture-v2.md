# FINFLOW event-driven workbench

This is a small local workbench for **Stripe test-mode** PaymentIntent failures
and successes. It keeps the existing React/Vite app and the legacy generator,
JSON data, and V1 planning documents; the webhook service does not consume or
rewrite the old generated dataset.

## Event path

```text
Stripe webhook (raw bytes + signature)
  -> Stripe SDK signature verification
  -> Stripe provider adapter
  -> normalized PaymentIntent event
  -> SQLite unique event log
  -> recovery-case projection
  -> existing FINFLOW failure mapping
  -> explainable recovery recommendation
  -> /api/cases UI
```

Provider parsing stays in `server/providers/stripe-adapter.js`. The adapter
accepts `payment_intent.payment_failed` and `payment_intent.succeeded` only,
extracting a PaymentIntent ID, provider timestamp, amount/currency, and (for a
failure) the decline code or error code. It intentionally does not retain the
full Stripe object or customer fields. A validly signed live-mode event is
rejected.

`server/storage/sqlite-repository.js` stores:

- `payment_events`: unique on `(provider, event_id)` with the PaymentIntent ID,
  provider event type/time, received time, and only normalized payment details.
- `recovery_cases`: one row per PaymentIntent with status, amount/currency,
  mapped failure, recommendation, reason, and latest provider event details.

Inserting an event and projecting its case happen in one SQLite transaction.
Repeated deliveries return an acknowledged duplicate and cannot add a second
event or case. Distinct failure events update one case; webhook events are not
payment-attempt records. Success resolves an existing case and leaves all
events intact.

## Existing mapping and decision rules

The legacy mapping source is `data/config.js`: it contained generation weights
for `insufficient_funds`, `authentication_failed`,
`transaction_daily_limit_exceeded`, and `payment_cancelled`. The legacy
generator separately classified `authentication_failed`,
`insufficient_funds`, `payment_cancelled`, and
`transaction_daily_limit_exceeded` as soft declines, and
`card_not_supported`, `fraudulent`, `merchant_blacklist`, and `lost_card` as
hard declines. There was no reusable mapping/decision module, and the legacy
weights sum to 0.95 rather than 1.0.

The config now exposes an additive `failureReasonMapping` used by
`server/domain/failure-mapping.js` and `server/domain/decision-engine.js`.
Existing code categories and weights are preserved; Stripe authentication
codes are explicitly mapped to the existing authentication rule, and the
legacy generator's remaining hard-decline codes are represented. Existing
weights describe synthetic data frequency only; they are not used as
decision thresholds. A code without an explicit mapping creates a
`reconciliation_required` case instead of receiving an inferred action.

Known outcomes are deterministic: soft declines lead to the specific
customer/retry action in the mapping; hard declines lead to a specific method
change or manual-review action; success resolves the case. These are
recommendations only—FINFLOW never retries or moves money.

## Ordering and reconciliation

The projection compares Stripe's event `created` timestamp, not delivery order.
An older event is retained in the log but cannot overwrite a projection from a
newer provider timestamp. Distinct events with the same timestamp are
ambiguous, so the case is marked `reconciliation_required`. A newer failure
after a recorded success is also marked for reconciliation rather than
asserting a new payment state. The API exposes the event history and
reconciliation reason for review.

Stripe timestamps have second precision. This prototype does not retrieve the
current PaymentIntent from Stripe to resolve conflicting/tied events; manual
reconciliation is required.

## Run locally

Requires Node.js `>=22.13.0` (Vite 8 and the built-in `node:sqlite` module).
Node currently marks `node:sqlite` experimental; a warning is expected.

```powershell
npm install
npm test
npm run demo
```

`npm run demo` signs three repeatable synthetic webhook payloads using the
Stripe SDK and an ephemeral in-process secret, then sends them through the real
HTTP route and in-memory SQLite: failure, updated failure, success. It requires
no Stripe CLI account and writes no database file.

For the workbench, start the server and Vite dev server in separate terminals:

```powershell
$env:STRIPE_WEBHOOK_SECRET = "whsec_from_stripe_listen"
npm run server
```

```powershell
npm run dev
```

The Vite dev server proxies `/api` to `localhost:8787`. The backend accepts a
`PORT` override; if using a nondefault port, update the proxy target in
`vite.config.js` as well. Set `DATABASE_PATH` to change the SQLite file path
(default `data/finflow.sqlite`).

### Stripe CLI test-mode forwarding

1. Install and authenticate Stripe CLI: `stripe login`.
2. Start a listener: `stripe listen --forward-to localhost:8787/webhook`.
3. Copy the `whsec_...` signing secret printed by `stripe listen` into the
   backend terminal's `STRIPE_WEBHOOK_SECRET` environment variable, then start
   `npm run server`. Start `npm run dev` in another terminal to view the UI.
4. Trigger supported test events, for example:

   ```powershell
   stripe trigger payment_intent.payment_failed
   stripe trigger payment_intent.succeeded
   ```

   The Stripe CLI fixture triggers can create **different, unrelated
   PaymentIntents**. Triggering one failure and one success does not prove one
   correlated payment lifecycle. Use `npm run demo` or the automated tests for
   the repeatable same-PaymentIntent lifecycle.

Only the two listed PaymentIntent event types are processed. Other
validly-signed Stripe event types receive HTTP 200 with `ignored: true` and are
not inserted into the payment event log.

## API and limitations

- `GET /api/health`
- `GET /api/cases`
- `GET /api/cases/:paymentIntentId` returns a case and its normalized event
  history.
- `GET /api/cases/:paymentIntentId/events` returns just the history.
- `POST /webhook` verifies the raw body and Stripe signature using
  `STRIPE_WEBHOOK_SECRET`.

The API excludes secrets and full customer/payment objects. This prototype
does not include authentication, production deployment, customer contact,
automatic retry, API reconciliation with Stripe, or a hosted database. Use
only Stripe test mode; live-mode webhook events are rejected.
