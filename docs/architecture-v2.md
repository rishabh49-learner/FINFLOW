# FinFlow architecture

FinFlow is a read-only workbench for **Stripe test-mode** PaymentIntent
failures and successes. It stores payment events, derives a recovery case from
them, and recommends a next step. It never retries a charge, moves money, or
contacts a customer.

## Event path

```text
Stripe webhook (raw bytes + signature)        Simulator (demo mode only)
  -> Stripe SDK signature verification          -> events built from scenario data
                     \                         /
                      -> Stripe provider adapter
                      -> normalized PaymentIntent event
                      -> SQLite event log (unique per event)
                      -> case rebuilt from all of the payment's events
                      -> rules: decline code to next step and priority
                      -> /api/cases -> React workbench
```

The simulator skips only the signature check. Everything after it is the same
code path as a real webhook.

## Adapter

`server/providers/stripe-adapter.js` accepts only
`payment_intent.payment_failed` and `payment_intent.succeeded`. From each event
it extracts the PaymentIntent id, the provider timestamp, amount and currency,
the opaque customer id, the charge id and, for a failure, the decline code
(`decline_code` is preferred, then the error `code`). It does not retain the
full Stripe object and keeps no names, emails or card details. A validly signed
live-mode event is rejected. Other signed event types receive HTTP 200 with
`ignored: true` and are not stored.

## Storage

`server/storage/sqlite-repository.js` keeps two tables:

- `payment_events`: append-only, unique on `(provider, event_id)`, holding the
  PaymentIntent id, provider event type and time, received time, and the
  normalized payment details. This is the source of truth.
- `recovery_cases`: one row per PaymentIntent. It is a cache of the result of
  replaying the events, not a primary record.

Inserting an event and rebuilding its case happen in one `BEGIN IMMEDIATE`
transaction. A repeated delivery is acknowledged as a duplicate and changes
nothing.

## Case rebuild

For every new event, the repository loads all stored events for that
PaymentIntent, sorts them by `(provider_created, event_id)` using plain
comparison, and folds them through `projectPaymentEvent` starting from nothing.
The pure function `rebuildCase(events)` in `server/domain/rebuild-case.js` does
this, and it copies the array before sorting. `rebuildAllCases()` repeats it for
every stored payment at server start, so a rule change applies to history on
restart.

Why: Stripe does not guarantee delivery order and its timestamps have
one-second precision. Rebuilding from the full event list makes the result
independent of arrival order.

Reconciliation: two events with the same timestamp but different states, or a
failure that follows a recorded success, give a case with status
`reconciliation_required`. FinFlow does not call the Stripe API to resolve it.

## Attempts

An attempt is an executed charge. It is identified by the charge id carried on
the failure event, or by the event id if no charge id is present. The number
shown is the count of distinct attempt ids among the case's events, derived when
the case is read. Stripe can schedule retries that do not execute (for hard
declines) and those create no charge, so FinFlow's count can be lower than the
invoice `attempt_count` Stripe reports. A missed webhook also undercounts.

## Rules

Rules live in `data/config.js` (`failureReasonMapping`) and are applied by
`server/domain/failure-mapping.js` and `server/domain/decision-engine.js`. Each
rule has a category, a reason, a next step, a source URL from Stripe's
documentation, and whether Stripe retries that decline.

- Soft decline: Stripe may retry. Priority **Standard**.
- Hard decline: Stripe will not retry it without a new payment method. Priority
  **High**. This includes `authentication_required`, as listed in Stripe's retry
  documentation.
- Success: the case is **Resolved**.
- A code with no rule, or a conflict between events, gives **Needs review**
  (`urgent`) and no invented action.

The rules encode documented guidance, not measured recovery rates. A few codes
inherited from the original generator are not Stripe codes and are marked
legacy. Customer messages are built in `src/customer-message.js` from fixed
text per decline group. Fraud-flagged and blocklist codes produce no message,
and an unmapped case produces none either.

## Demo mode and the simulator

With `DEMO_MODE=true` the server uses an in-memory database, seeds four cases
(ids `pi_demo_...`, created through the same ingest path), serves the built UI,
and disables the webhook route (404).

Scenarios are data in `server/demo-scenarios.json`: `insufficient-funds-then-paid`,
`generic-decline`, `authentication-required`, `lost-card` and
`success-then-failure`. Each uses real Stripe decline codes. Playing one
generates fresh ids (`pi_sim_...`, `evt_sim_...`, `ch_sim_...`, `cus_sim_...`
with 8 hex characters), timestamps relative to now, and delivers the steps in
the background. `success-then-failure` is delivered in reverse order by default.

Guards: 10 plays per client IP per minute (HTTP 429 with the seconds to wait),
at most 50 simulator cases (the oldest are removed), and a reset that cancels
pending deliveries and removes only simulator rows. `TRUST_PROXY_HOPS` sets how
many reverse proxies to trust when reading the client IP from
`X-Forwarded-For`. It defaults to `0`.

## API

- `GET /api/health`
- `GET /api/cases`
- `GET /api/cases/:paymentIntentId`: the case and its normalized event history.
- `GET /api/cases/:paymentIntentId/events`: the history only.
- `POST /webhook`: raw body and Stripe signature, verified with
  `STRIPE_WEBHOOK_SECRET`. Not available in demo mode.
- Demo mode only: `GET /api/demo/scenarios`, `POST /api/demo/play` with
  `{"scenario":"<id>","outOfOrder":false}` (HTTP 202), and
  `POST /api/demo/reset`. These return 404 outside demo mode.

Cases expose the opaque customer id and no other customer data. The API never
returns secrets or full Stripe objects.

## Configuration

| Variable | Meaning |
| --- | --- |
| `DEMO_MODE` | `true`: in-memory database, seeds, simulator routes, webhook off |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/webhook` |
| `PORT` | Server port, default `8787` |
| `DATABASE_PATH` | SQLite file, default `data/finflow.sqlite` |
| `TRUST_PROXY_HOPS` | Trusted proxies for the client IP, default `0` |

Requires Node.js 22.13 or newer. `node:sqlite` is experimental, so a warning is
expected.

## Limitations

There is no login, no multi-merchant support, no backfill from the Stripe API,
no ingestion of invoice or subscription events, and no follow-up tracking. Use
Stripe test mode only. Demo mode serves synthetic data with unauthenticated,
rate-limited simulator endpoints, so never run it with real customer data or a
real webhook secret. Demo data is shared by all visitors.
