export const CONFIG = {
  failureReasonWeights: {
    insufficient_funds: 0.4,
    authentication_failed: 0.1,
    transaction_daily_limit_exceeded: 0.2,
    payment_cancelled: 0.25,
  },
  failureReasonMapping: {
    insufficient_funds: {
      category: 'soft_decline',
      action: 'retry_after_customer_update',
      reason: 'The existing rules classify insufficient funds as a soft decline; retry after the customer adds funds.',
    },
    authentication_failed: {
      category: 'soft_decline',
      action: 'request_customer_authentication',
      reason: 'The existing rules classify authentication failures as soft declines; ask the customer to authenticate.',
    },
    authentication_required: {
      category: 'soft_decline',
      action: 'request_customer_authentication',
      reason: 'Stripe requires customer authentication before this payment can proceed.',
    },
    payment_intent_authentication_failure: {
      category: 'soft_decline',
      action: 'request_customer_authentication',
      reason: 'Stripe reported an authentication failure; ask the customer to authenticate.',
    },
    transaction_daily_limit_exceeded: {
      category: 'soft_decline',
      action: 'retry_next_day',
      reason: 'The existing rules classify daily-limit failures as soft declines; retry after the limit resets.',
    },
    payment_cancelled: {
      category: 'soft_decline',
      action: 'confirm_customer_intent',
      reason: 'The legacy rules classify cancellation as soft; confirm the customer still intends to pay.',
    },
    card_not_supported: {
      category: 'hard_decline',
      action: 'request_supported_payment_method',
      reason: 'The existing rules classify unsupported cards as hard declines; request another payment method.',
    },
    fraudulent: {
      category: 'hard_decline',
      action: 'manual_review',
      reason: 'The existing rules classify suspected fraud as a hard decline; do not retry automatically.',
    },
    merchant_blacklist: {
      category: 'hard_decline',
      action: 'manual_review',
      reason: 'The existing rules classify merchant blacklist declines as hard; review before taking action.',
    },
    lost_card: {
      category: 'hard_decline',
      action: 'request_replacement_payment_method',
      reason: 'The existing rules classify lost cards as hard declines; request a replacement payment method.',
    },
    stolen_card: {
      category: 'hard_decline',
      action: 'manual_review',
      reason: 'Stripe reported a stolen card; do not retry automatically and review the case.',
    },
  },
}