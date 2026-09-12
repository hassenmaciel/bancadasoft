export const MAX_PROVIDER_ATTEMPTS = 3;
export type ExecutionSnapshot = { orderExists:boolean; paymentStatus?:string; orderStatus?:string; hasProviderProduct:boolean; providerActive:boolean; providerConnected:boolean; providerOrderStatus?:string; attempts:number; hasDelivery:boolean;externalOrderId?:string|null;requestReference?:string|null;hasCallback?:boolean;resultUncertain?:boolean };
export function validateProviderExecution(state:ExecutionSnapshot,retry=false){
  if(!state.orderExists)return "ORDER_NOT_FOUND";if(state.paymentStatus!=="PAID")return "PAYMENT_NOT_PAID";if(state.orderStatus==="DELIVERED"||state.hasDelivery)return "ALREADY_DELIVERED";if(!state.hasProviderProduct)return "PROVIDER_PRODUCT_NOT_FOUND";if(!state.providerActive)return "PROVIDER_INACTIVE";if(!state.providerConnected)return "PROVIDER_NOT_CONNECTED";
  if(retry){if(state.externalOrderId||state.hasCallback||state.requestReference||state.resultUncertain)return "RECONCILIATION_REQUIRED";if(state.providerOrderStatus!=="FAILED")return "RETRY_NOT_ALLOWED";if(state.attempts>=MAX_PROVIDER_ATTEMPTS)return "RETRY_LIMIT_REACHED";}else if(state.providerOrderStatus&&state.providerOrderStatus!=="QUEUED")return "EXECUTION_ALREADY_STARTED";
  return null;
}
export function providerOutcome(status:"COMPLETED"|"PROCESSING"|"FAILED",delivery?:Record<string,unknown>){if(status==="COMPLETED"&&!delivery)return{fulfillment:"FAILED",deliver:false};return{fulfillment:status==="COMPLETED"?"FULFILLED":status,deliver:status==="COMPLETED"};}
