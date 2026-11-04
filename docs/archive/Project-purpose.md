# V1 Scope — Payment Operations Dashboard

## Problem Statement
Payment ops executives lose visibility into why transactions fail and whether
recovery attempts are working, leading to unrecovered revenue. This dashboard
gives them a single place to search transactions, understand failure patterns,
and track retry/recovery status.

## Primary User
Payment ops executive / support analyst.

## Decisions the user makes with this tool
- Which failed transactions need manual follow-up?
- Is our automatic retry logic actually recovering revenue?
- What's stuck too long and needs escalation?

---

## V1 — LOCKED FEATURE LIST (build this, nothing else)

### 1. Transaction Table
- Search by transaction ID / customer
- Filter by status, date range, payment method
- Pagination, sorting
- Field-level detail: see DATA_SCHEMA.md

### 2. Failure Reason Analysis
- Dedicated view for failed transactions
- Breakdown by failure reason (count/%)
- Each failure is classified as resolvable automatically vs. needing a
  customer/human to fix it (soft vs. hard decline)
- Field-level detail: see DATA_SCHEMA.md

### 3. Retry / Recovery Status
- Shows every attempt made to collect a payment, in order, including who/what
  triggered each one (system, customer, or an ops exec)
- Surfaces a queue: transactions where automatic retries are exhausted and no
  one has acted yet — this is the exec's actual to-do list
- Shows a log of manual actions taken by execs (retry / escalate / refund)
- Field-level detail: see DATA_SCHEMA.md

### 4. Aging Buckets
- 0–24h / 1–3d / 3d+ pending or unresolved
- Computed from how long ago the transaction was created, not hardcoded
- Field-level detail: see DATA_SCHEMA.md

### Data modeling decision (foundational, not a new feature)
- A transaction is modeled separately from each individual attempt to pay it,
  because one transaction can have multiple attempts (retries, different
  payment methods). This is depth on feature #3, not a 5th feature.

### Refund correctness (also foundational)
- A transaction can succeed and later be refunded — tracked separately from
  pass/fail outcome, so revenue reporting stays accurate.

---

## Explicitly OUT of V1 (do not build, do not get tempted)
- Auth / user roles
- Real backend / database (mocked JSON is fine for V1)
- Live payment gateway integration
- Notifications / dunning emails (simulate at most as a boolean flag, no
  actual email flow)
- Exportable reports
- Multi-currency
- Duplicate-payment detection panel
- Smart retry timing / salary-cycle-aware scheduling
- Analytics/metrics screen (revenue recovered, success rate trends)

## The test before adding anything new
"Does this make one of the 4 existing features work correctly, or is this a
5th feature?"
- Makes an existing feature correct → build it
- New feature → goes to FUTURE_IDEAS.md, not into V1 code

## Note on this file's job
This file describes WHAT each feature does and WHY, in plain language.
It intentionally contains no field names, so it can never go stale when the
schema changes. For exact fields, types, and derivation logic, always check
DATA_SCHEMA.md — that is the single source of truth for data structure.