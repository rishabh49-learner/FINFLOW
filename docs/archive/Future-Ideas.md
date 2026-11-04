# Future Ideas (V2 / V3)

## Prioritization & recovery intelligence (post-V1)
- **Priority ranking** — score the action_required queue by amount, aging_bucket, decline_type, retry history. Rule-based (transparent weights), not ML — no real data to train on yet.


- **Recoverability scoring** — flag accounts where further effort has near-zero odds (repeated failed manual attempts, long-exhausted hard declines) so execs stop chasing dead accounts.


- **Pattern/anomaly detection** — aggregate attempts by failure_reason + gateway/method over a time window to catch systemic issues (e.g. one bank spiking) vs. individual customer problems. Different from per-transaction logic — needs cross-transaction aggregation.


- **Action recommendation** — per-transaction suggested next step (not just priority order). Only worth building if it adds real judgment beyond a lookup table.

- **Method-aware retry logic** — card/UPI-Autopay support silent system retry; UPI-collect/netbanking require fresh customer action. Current generator treats all methods as equivalent — known V1 simplification.

- **Dedicated action type for card-update cases** — `expired_card` currently falls into `escalate` as a stand-in; needs its own action type.