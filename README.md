# FINFLOW — Payment Operations Dashboard

A dashboard for payment ops executives to see why transactions fail,
track recovery/retry status, and know what still needs attention —
built to understand how real fintech platforms (Stripe, Razorpay) handle
failed payments and revenue recovery.

## Problem

Payment ops executives lose visibility into why transactions fail and
whether recovery attempts are working, leading to unrecovered revenue.
This dashboard gives them a single place to search transactions,
understand failure patterns, and track retry/recovery status.

Failed payments are a real, measurable revenue leak — industry estimates
put it at roughly 9–10% of ARR for subscription businesses, with
involuntary churn accounting for a large share of cancellations.

## Status

The original V1 data generator and planning documents are retained. The
current branch adds a small Stripe test-mode event-driven recovery workbench;
see [`docs/architecture-v2.md`](docs/architecture-v2.md) for the current
backend, event model, setup, and limitations.

## What's here right now

- [`docs/Project-Purpose.md`](docs/Project-Purpose.md) — problem statement,
  locked V1 feature scope, and what's explicitly out of scope
- [`docs/Data-schema.md`](docs/Data-schema.md) — the full data model
  (Transaction / Attempt / ManualAction), including which fields are
  stored vs. derived, and why
- [`docs/Build-log.md`](docs/Build-log.md) — the actual design decisions
  made while building this, with reasoning (not just a changelog)
- [`docs/Future-Ideas.md`](docs/Future-Ideas.md) — V2/V3 ideas intentionally
  parked out of V1's scope

## V1 planned features

1. **Transaction table** — search and filter all transactions
2. **Failure reason analysis** — breakdown of why payments fail, soft vs.
   hard declines
3. **Retry / recovery queue** — transactions where automatic retries are
   exhausted and no one has acted yet
4. **Aging buckets** — how long unresolved transactions have been stuck

## What's next (V2+)

V1 is intentionally scoped tight — see [`docs/Future-Ideas.md`](docs/Future-Ideas.md)
for planned analytics, revenue-recovery metrics, and other ideas parked
outside V1's scope on purpose.

## Current stack

React 19 and Vite for the workbench, Node.js with the official Stripe SDK for
raw-body webhook verification, and local SQLite for the event log and case
projection. The Node backend processes Stripe test-mode events only and never
initiates payments or retries. The original generator and `data.json` remain
available as legacy project artifacts but are not used by the event-driven
workbench.

Use `npm test` for automated tests and `npm run demo` for a repeatable,
same-PaymentIntent failure-to-success lifecycle without Stripe CLI. Stripe CLI
setup and the warning about unrelated fixture PaymentIntents are documented in
[`docs/architecture-v2.md`](docs/architecture-v2.md).