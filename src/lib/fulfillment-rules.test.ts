import { describe,expect,it } from "vitest";
import { assertAdminRole } from "./authorization";
import { buildProviderExecutionPayload,MAX_PROVIDER_ATTEMPTS,providerOutcome,shouldRecordPaidFulfillmentFailure,validateProviderExecution,type ExecutionSnapshot } from "./fulfillment-rules";
import { MockProviderAdapter } from "./providers/mock";

const valid:ExecutionSnapshot={orderExists:true,paymentStatus:"PAID",orderStatus:"PAID",hasProviderProduct:true,providerActive:true,providerConnected:true,providerOrderStatus:undefined,attempts:0,hasDelivery:false};
describe("pré-condições do fulfillment engine",()=>{
  it("rejeita pagamento não confirmado",()=>expect(validateProviderExecution({...valid,paymentStatus:"PENDING"})).toBe("PAYMENT_NOT_PAID"));
  it("rejeita produto sem ProviderProduct",()=>expect(validateProviderExecution({...valid,hasProviderProduct:false})).toBe("PROVIDER_PRODUCT_NOT_FOUND"));
  it("rejeita provider inativo",()=>expect(validateProviderExecution({...valid,providerActive:false})).toBe("PROVIDER_INACTIVE"));
  it("bloqueia execução duplicada com entrega",()=>expect(validateProviderExecution({...valid,hasDelivery:true})).toBe("ALREADY_DELIVERED"));
});
describe("resultado do provider",()=>{
  it("cria entrega somente em sucesso",()=>{expect(providerOutcome("COMPLETED",{credential:"ok"})).toEqual({fulfillment:"FULFILLED",deliver:true});expect(providerOutcome("FAILED")).toEqual({fulfillment:"FAILED",deliver:false});expect(providerOutcome("PROCESSING")).toEqual({fulfillment:"PROCESSING",deliver:false});});
  it("não entrega sucesso sem resultado",()=>expect(providerOutcome("COMPLETED")).toEqual({fulfillment:"FAILED",deliver:false}));
  it("adapter mock simula SUCCESS, PROCESSING e FAILURE",async()=>{await expect(new MockProviderAdapter("SUCCESS").createOrder({providerProductId:"p",reference:"r",payload:{}})).resolves.toMatchObject({status:"COMPLETED",delivery:{}});await expect(new MockProviderAdapter("PROCESSING").createOrder({providerProductId:"p",reference:"r",payload:{}})).resolves.toMatchObject({status:"PROCESSING"});await expect(new MockProviderAdapter("FAILURE").createOrder({providerProductId:"p",reference:"r",payload:{}})).resolves.toMatchObject({status:"FAILED"});});
});
describe("retry controlado",()=>{
  it("permite FAILED abaixo do limite",()=>expect(validateProviderExecution({...valid,providerOrderStatus:"FAILED",attempts:1},true)).toBeNull());
  it("rejeita COMPLETED",()=>expect(validateProviderExecution({...valid,providerOrderStatus:"COMPLETED",attempts:1},true)).toBe("RETRY_NOT_ALLOWED"));
  it("rejeita a partir de três tentativas",()=>expect(validateProviderExecution({...valid,providerOrderStatus:"FAILED",attempts:MAX_PROVIDER_ATTEMPTS},true)).toBe("RETRY_LIMIT_REACHED"));
  it("bloqueia retry quando houve tentativa externa incerta",()=>{expect(validateProviderExecution({...valid,providerOrderStatus:"FAILED",attempts:1,requestReference:"ref"},true)).toBe("RECONCILIATION_REQUIRED");expect(validateProviderExecution({...valid,providerOrderStatus:"FAILED",attempts:1,resultUncertain:true},true)).toBe("RECONCILIATION_REQUIRED");expect(validateProviderExecution({...valid,providerOrderStatus:"FAILED",attempts:1,hasCallback:true},true)).toBe("RECONCILIATION_REQUIRED");});
  it("mantém retry restrito a ADMIN",()=>{expect(()=>assertAdminRole("USER")).toThrow("FORBIDDEN");expect(()=>assertAdminRole("ADMIN")).not.toThrow();});
});
describe("registro de falha pós-pagamento (provider indisponível antes da execução)",()=>{
  it("registra quando pagamento está PAID e produto/provider está indisponível (ex.: SamsungTool/Phoenix desativados entre o pagamento e a execução)",()=>{
    expect(shouldRecordPaidFulfillmentFailure("PROVIDER_INACTIVE","PAID")).toBe(true);
    expect(shouldRecordPaidFulfillmentFailure("PROVIDER_PRODUCT_NOT_FOUND","PAID")).toBe(true);
    expect(shouldRecordPaidFulfillmentFailure("PROVIDER_NOT_CONNECTED","PAID")).toBe(true);
    expect(shouldRecordPaidFulfillmentFailure("PROVIDER_CONFIGURATION_AMBIGUOUS","PAID")).toBe(true);
  });
  it("não registra quando o pagamento ainda não está PAID",()=>expect(shouldRecordPaidFulfillmentFailure("PROVIDER_INACTIVE","PENDING")).toBe(false));
  it("não registra quando a entrega já existe (ALREADY_DELIVERED)",()=>expect(shouldRecordPaidFulfillmentFailure("ALREADY_DELIVERED","PAID")).toBe(false));
  it("não registra quando não há erro",()=>expect(shouldRecordPaidFulfillmentFailure(null,"PAID")).toBe(false));
});
describe("payload financeiro do provider",()=>{
  it.each([2000,1000])("preserva o valor server-side em centavos %i",(paidAmountCents)=>{
    expect(buildProviderExecutionPayload("order-1",paidAmountCents,{browserPriceCents:1})).toEqual({orderId:"order-1",paidAmountCents,Quantity:1,fields:{browserPriceCents:1}});
  });
  it("rejeita valor não persistido",()=>expect(()=>buildProviderExecutionPayload("order-1",0,{})).toThrow("PAID_AMOUNT_REQUIRED"));
});
