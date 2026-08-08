### Day 1  — Scope
    Decision —Decided to focus on failed payments specifically, not broader payment ops
    (fraud, compliance, etc.)
     — a broad case study I read barely mentioned it,
    which caused doubt, but more specific sources showed failed payments cost
    companies a significant chunk of ARR.
    
    Chose this scope to help the ops exec analyze and resolve the right problems
    faster and more efficiently.

### Day 2  —

    1. Decision — Transaction vs Attempt
    transaction and attempt seperated into two different entities rather one flat 
    —>multiple attempts of a transaction can be possibel by system,executive and default cutomer's included which reqired its own view of attempts seperated from transactions 

    2. Decision — Store vs derive
    few fields will be derived rather than storing—>storing specific fields which can be derived leads to incosistent information 
    
    3. Decision — triggered_by —>is_manual_action
     
     replaced 4 value trigered_by field with a single boolean is_manual_action—>executives queue only needs to know "was human involved",not the exact source

### Day 3  —

    4. Decision — number of status 
      
      status reduced from 4 values(pending/successfull/failed/action_required) to 3 values(pending/successfull/failed) and a resolved_by field added
      —>two types of fialed transaction should be differentiated based on who resolved it using resolved_by because a boolean coudnt distinguish "caused" and "coincidentally preceded"
    5. Decision — refund tracked seperately

      refunded and refunded_at added as new field
      —>a succesfull transaction thats refunded isnt real revenue and so refunded transaction should be flagged seperatly
     
    
      
    6. Decision — ManualAction vs Attempts

      ManualAction seperated from Attempts
      —>ManualAction (escalate/refund) dont create new attempts like force retry so cant match in attempts structure

     

    7. Decision — decline_type/display_method 
      decline_type/display_method not made as field rather as lookup values—>decline_type can be derived from failure reason and display method changes for every attempt ,only one last attempt is sufficient for the info from transaction table

      





