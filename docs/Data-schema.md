# transactions
- id- string - its a unique number or code to identify transaction

- amount- number(rupees) - the amount payed by customer 

- name -string - name of the person made the transaction

- email - string - email of the person made the payment 

- refunded-boolean- was it a refund or not

- refunded_at-time-when was a refund made

- created_at- time - timestamp of first attempt (derived)


# Attempt
- attempt_num -number -which attempt

- failure_reason- string-reason for the failed tr 
- is_manual_action-boolean- is it a manual attempt by human

- timestamp- time*-  the time of the attempt

- method-string- medium of payment

- id-string- the id of the attempt 

- tr_id- reference to which trasactions attempt are recorded


# Manual Action
- tr_id - string - id of the transaction

- attempt_id - string - id of the attempt

- timestamp-yime  time of manual action

- action(forsed retry / escalate /refund)- string- action taken by exec 

- executive_id-string- id of the exective resible



# derived fields
->status(pending/failed/successful)-> pending when system/ customer retries even in manual action and fianlly succesfull and failed with resolved_by=sys/exe/customer confirming if its failed or succesfull by system/customer or ops exec

->auto_retry_exhausted(true/false)- [totalnumber of system attempts<=max auto retries available] 

->aging bucket-days-now- created_at

->failure percentage-number -[total number of failed transaction/ total transactions *100]%

->decline_type-string-look it up from failure reaon

->display_method-string-latest attempts method