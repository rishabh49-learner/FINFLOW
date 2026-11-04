# FinFlow

Failed-payment triage for small subscription teams. Stripe retries failed
card payments on its own. FinFlow shows what is left afterwards: which
payments need a person, why they failed, and what to do next. It only
recommends. It never retries a charge, moves money, or contacts customers.

Status: portfolio project on Stripe test-mode events. Whether small teams
need this is not validated yet.

Try it: https://finflow-tpcu.onrender.com/. Pick a scenario on the Overview page, watch the case
appear, and open it to see the next step, the rule and its Stripe source.

## What is simulated and what is real
- Deployed site: simulated events built from the shape of real Stripe
  sandbox events I recorded. They go through the same adapter, event store,
  case rebuild and rules as a real webhook. Only the signature check is
  skipped.
- Locally: real signed Stripe sandbox events via the Stripe CLI, same pipeline.
- Live-mode events are rejected. No login. Demo data is shared by all
  visitors and resets when the service restarts.

## How it works
(Mermaid diagram)
Tradeoff: events are stored and the case is derived from all of them in time
order, so delivery order cannot corrupt a case. Cost: one rebuild per event.
An attempt means an executed charge.

## Rules and evidence
Each rule cites Stripe's documentation. Stripe's retry docs list nine hard
declines it will not retry; that is the boundary of "needs a person". The
rules encode documented guidance, not measured recovery rates. Unknown codes
go to Needs review with no suggested action.

## Run it
(demo, local sandbox and Render steps, env vars: DEMO_MODE, TRUST_PROXY_HOPS,
STRIPE_WEBHOOK_SECRET, PORT, DATABASE_PATH, NODE_VERSION)

## Limitations
No login or multi-tenant support. No API backfill for missed webhooks. The
retry schedule is unknown without invoice events. Demo data is shared.

## Next steps
Login and per-merchant accounts, API backfill, invoice and subscription
events, visitor-run sandbox, founder validation.