import fs from 'fs'

import { faker } from '@faker-js/faker';

// import {CONFIG} from './config.js'

// CJS
// const failure_reason=["","authentication_failed","bank_acount_invalid","bank_not_enabled","card_expired","debit_instrument_blocked","insufficient_funds","payment_cancelled","transaction_daily_limit_exceeded"]
const failure_reason=[{weight: 6,value:""},{weight: 6,value:"authentication_failed"},{weight: 4,value:"insufficient_funds"},{weight: 5,value:"payment_cancelled"},{weight: 1,value:"transaction_daily_limit_exceeded"},{weight: 5,value:"card_not_supported"},{weight: 3,value:"fraudulent"},{weight: 2,value:"lost_card"},{weight: 3,value:"merchant_blacklist"}]
const soft_decline=["authentication_failed","insufficient_funds","payment_cancelled","transaction_daily_limit_exceeded",]
const hard_decline=["card_not_supported","fraudulent","merchant_blacklist","lost_card"]
const maxAutoRetry=3
// genereate transactions 
function generateTransactions(){
    return {
        tr_id:faker.string.uuid(),
        name:faker.internet.username(),
        email:faker.internet.username(),
        amount:faker.finance.amount(),
        refunded:faker.datatype.boolean(),
        refunded_at:faker.date.anytime(),
        created_at:faker.date.anytime(),

    }
}
 const transactions = faker.helpers.multiple(generateTransactions, {
  count: 100,});
  

//  Auto-retry phase: generate up to maxAutoRetry attempts, is_Manual_Action = false for all of them, stopping early if one succeeds (soft declines only — you haven't rebuilt the soft/hard branching into this version yet either, worth noting)
// Manual phase: only if phase 1 fully exhausted without success, a separate probability check decides whether a manual attempt happens at all — and if it does, that attempt gets is_Manual_Action = true
//   generate Attempts per transaction

function generateAttempts(tr_id,index){ 
    
   
    return {
        id:faker.string.uuid(),
        tr_id:tr_id,
        attempt_no:index+1,
        method:faker.finance.transactionType(),
        is_Manual_Action:false,
        timestamp:faker.date.anytime(),
        failure_reason:faker.helpers.weightedArrayElement(failure_reason)

    }
}
let attempt_arr=[]
let action_required_per_tr=[]


function Attempts(){
    
    transactions.forEach((tr)=>
    {  
          let index=0
          let at_per_tr=[]
          let lookup
        let action_required=false
        while(index<maxAutoRetry){

            const attempt=generateAttempts(tr.tr_id,index)
                at_per_tr.push(attempt)
                // const lookup_soft=soft_decline.includes(attempt.failure_reason)
                  if(hard_decline.includes(attempt.failure_reason)){
                    lookup= "hard"
                  }
                  else{
                    lookup= "soft"
                  }

                if( attempt.failure_reason==="" || lookup =="hard" ){
                    
                    break
                }
                index++
                }
                if((index===maxAutoRetry&&at_per_tr[index-1].failure_reason!="")||lookup==="hard"){ action_required=true}
                at_per_tr.forEach((at)=>attempt_arr.push(at))
                action_required_per_tr.push({ tr:tr.tr_id,action_required,lookup})
            })
            return action_required_per_tr
}

const attempts=Attempts()




function manual_Attempts(action){
        let manAC_per_tr=[]
        
        transactions.forEach((tr)=>{
            const total_at_per_tr=attempt_arr.filter((at)=>at.tr_id===tr.tr_id)
            let index=total_at_per_tr.length-1
             let maction
            let mattempt_id
            let lookup
            action.forEach((a)=>{
               
                if(tr.tr_id===a.tr &&a.action_required===true ){
                    if(a.lookup==="soft" )
                    {
                       let manAt
                        manAt=generateAttempts(tr.tr_id,index)
                         
                            manAt.is_Manual_Action=true
                            attempt_arr.push(manAt)
                            if(manAt.failure_reason==""){
                            let manATAC=action.find((ac)=>ac.tr==tr.tr_id)
                            manATAC.lookup =null
                             manATAC.action_required=false
                             
                            }
                            index++
                            
                        // for (let i=0;i<faker.number.int({min:1,max:2});i++)
                        // {   
                             


                        //     index++   
                             
                        // }  
                         mattempt_id=manAt .id
                       
                        maction="forced_retry"
                         
                    }
                    else{
                        maction="escalate"
                        mattempt_id=attempt_arr[index].id
                    }
                    manAC_per_tr.push(generate_Manual_Action(tr.tr_id,maction,mattempt_id))

                }
                // else{
                     
                //       maction=null
                //       mattempt_id=nu
                //       manAC_per_tr.push(generate_Manual_Action(tr.tr_id,maction,mattempt_id))
                // }
           
            })
                
            }
            )
      return manAC_per_tr
        }


// generate Manual Ations

function generate_Manual_Action(tr_id,action,attempt_id){
    return {
        id:faker.string.uuid(),
        tr_id:tr_id,
        Attempt_id:attempt_id,
        executive_id:faker.string.uuid(),
        timestamp:faker.date.anytime(),
        Action:action
    }
   
}



function Status(){
    
  let status_arr=[]
   transactions.forEach((tr)=>{
    let lookup
    let at_per_tr=attempt_arr.filter((at)=>tr.tr_id==at.tr_id)
    if(hard_decline.includes(at_per_tr[at_per_tr.length-1].failure_reason)){
        lookup="hard"
    }
    else{
        lookup="soft"
    }
    
    const isSuccess=at_per_tr.some((at)=>{
      
        if(at.failure_reason=="" ){
           return true

        }
        else 
            return false
        })
        
        if(isSuccess){
        status_arr.push({tr:tr.tr_id,status:"successfull"})
       }
       else if(at_per_tr.length<maxAutoRetry && isSuccess==false){
        if(lookup=="soft")
        {
            status_arr.push({tr:tr.tr_id,status:"pending"})
       }
       else{
        status_arr.push({tr:tr.tr_id,status:"failed"})
       }
        }
       else{
        status_arr.push({tr:tr.tr_id,status:"failed"})
       }
      
    
   })
   return status_arr
     
     
    
}


    const st=Status()
    console.log(st)
    

    function Resolved_by(status_A){ 
         let resolved_by_arr=[]
        transactions.forEach((tr)=>
        {
            let at_per_tr=attempt_arr.filter((at)=>tr.tr_id==at.tr_id)
            let stat=status_A.find((st)=>st.tr==tr.tr_id)
            let is_Man=at_per_tr[at_per_tr.length-1]
            
            if (stat.status=="successfull" && is_Man.is_Manual_Action==true){
                resolved_by_arr.push({tr:tr.tr_id,resolved_by:"ops Executive"})
            }
            else{
                 resolved_by_arr.push({tr:tr.tr_id,resolved_by:"sys"})

            }

        }
        )  
       
        
       return resolved_by_arr 
    
    }
    


  
const combinedData={
    Transactions:transactions,
    Attempts: attempt_arr,
    Status:st,
    Resolved_by:[...Resolved_by(st)],
    Manual_Action:manual_Attempts(attempts)

}

  const jsonString = JSON.stringify(combinedData, null, 2);

// 3. Write the string to a file asynchronously
fs.writeFile('data.json', jsonString, 'utf8', (err) => {
    if (err) {
        console.error("An error occurred while writing the file:", err);
        return;
    }
    console.log("JSON file successfully created!");
});