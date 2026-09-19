export const MAX_PROVIDER_ATTEMPTS = 3;
export type ExecutionSnapshot = { orderExists:boolean; paymentStatus?:string; orderStatus?:string; hasProviderProduct:boolean; providerActive:boolean; providerConnected:boolean; providerOrderStatus?:string; attempts:number; hasDelivery:boolean;externalOrderId?:string|null;requestReference?:string|null;hasCallback?:boolean;resultUncertain?:boolean };
export function validateProviderExecution(state:ExecutionSnapshot,retry=false){
  if(!state.orderExists)return "ORDER_NOT_FOUND";if(state.paymentStatus!=="PAID")return "PAYMENT_NOT_PAID";if(state.orderStatus==="DELIVERED"||state.hasDelivery)return "ALREADY_DELIVERED";if(!state.hasProviderProduct)return "PROVIDER_PRODUCT_NOT_FOUND";if(!state.providerActive)return "PROVIDER_INACTIVE";if(!state.providerConnected)return "PROVIDER_NOT_CONNECTED";
  if(retry){if(state.externalOrderId||state.hasCallback||state.requestReference||state.resultUncertain)return "RECONCILIATION_REQUIRED";if(state.providerOrderStatus!=="FAILED")return "RETRY_NOT_ALLOWED";if(state.attempts>=MAX_PROVIDER_ATTEMPTS)return "RETRY_LIMIT_REACHED";}else if(state.providerOrderStatus&&state.providerOrderStatus!=="QUEUED")return "EXECUTION_ALREADY_STARTED";
  return null;
}
export function providerOutcome(status:"COMPLETED"|"PROCESSING"|"FAILED",delivery?:Record<string,unknown>){if(status==="COMPLETED"&&!delivery)return{fulfillment:"FAILED",deliver:false};return{fulfillment:status==="COMPLETED"?"FULFILLED":status,deliver:status==="COMPLETED"};}

// Um pagamento já confirmado nunca pode ficar sem nenhum registro de Fulfillment
// visível no Admin, mesmo quando a pré-validação bloqueia a execução antes de o
// provider ser chamado (ex.: provider/produto ficou indisponível entre o
// pagamento e a tentativa de entrega). PAYMENT_NOT_PAID/ORDER_NOT_FOUND nunca
// chegam aqui com pagamento PAID; ALREADY_DELIVERED significa que a entrega já
// existe, então não há falha nova a registrar.
export function shouldRecordPaidFulfillmentFailure(error:string|null,paymentStatus?:string){
  return paymentStatus==="PAID"&&error!==null&&error!=="ALREADY_DELIVERED";
}

// Mesmo sinal usado por validateProviderExecution para retornar
// RECONCILIATION_REQUIRED. Extraído aqui para que o admin retry E o recovery
// automático do fluxo guest usem exatamente a mesma regra de negócio — nunca
// duas cópias divergentes decidindo "já houve tentativa externa" de formas
// diferentes.
export type ProviderOrderAttemptEvidence = {
  requestReference: string | null;
  externalOrderId: string | null;
  lastError: string | null;
  callbackEventCount: number;
};
export function hasExternalAttemptEvidence(item?: ProviderOrderAttemptEvidence | null) {
  return Boolean(
    item &&
      (item.requestReference ||
        item.externalOrderId ||
        item.callbackEventCount > 0 ||
        item.lastError === "PROVIDER_RESULT_UNCERTAIN"),
  );
}

// Classificador ÚNICO de recovery — Admin (retry/route.ts), recovery
// automático do guest (attemptAutomaticGuestRecovery) e o sweep server-side
// (cron) precisam decidir a partir da MESMA regra. Antes desta correção,
// Admin e o auto-recovery tinham cada um sua própria cópia da lógica
// "já houve tentativa externa?" — risco real de divergirem no futuro.
export type FulfillmentRecoveryProviderOrder = {
  status: string;
  requestReference: string | null;
  externalOrderId: string | null;
  lastError: string | null;
  callbackEventCount: number;
};
export type FulfillmentRecoveryState = {
  paymentStatus?: string | null;
  orderStatus?: string | null;
  hasDelivery: boolean;
  providerOrder?: FulfillmentRecoveryProviderOrder | null;
};
export type FulfillmentRecoveryAction =
  | "NO_ACTION" // payment não PAID, ou nenhuma ação segura possível
  | "ALREADY_DELIVERED"
  | "CLEAN_RECOVERY" // sem ProviderOrder / sem evidência externa: executeFulfillment(retry:false) é seguro
  | "RECONCILE"; // existe evidência externa: só reconcileFulfillment (nunca gerar-ticket de novo)

export function classifyFulfillmentRecovery(
  state: FulfillmentRecoveryState,
): FulfillmentRecoveryAction {
  if (state.paymentStatus !== "PAID") return "NO_ACTION";
  if (state.orderStatus === "DELIVERED" || state.hasDelivery)
    return "ALREADY_DELIVERED";
  const item = state.providerOrder;
  if (!item) return "CLEAN_RECOVERY";
  return hasExternalAttemptEvidence(item) ? "RECONCILE" : "CLEAN_RECOVERY";
}

export function buildProviderExecutionPayload(
  orderId: string,
  paidAmountCents: number | undefined,
  fields: Record<string, string | number>,
) {
  if (!orderId.trim()) throw new Error("ORDER_ID_REQUIRED");
  if (
    typeof paidAmountCents !== "number" ||
    !Number.isInteger(paidAmountCents) ||
    paidAmountCents <= 0
  )
    throw new Error("PAID_AMOUNT_REQUIRED");
  return { orderId, paidAmountCents, Quantity: 1, fields };
}
