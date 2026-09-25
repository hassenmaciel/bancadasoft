import type { ProviderAdapter, ProviderBalance, ProviderCatalogItem, ProviderHealth, ProviderOrderInput, ProviderOrderResult } from "./types";
import { ProviderNotConnectedError, ProviderOrderUncertainError } from "./types";
import { parseHeartUnlocksCatalogResponse } from "./heartunlocks-catalog";

export const HEARTUNLOCKS_CODE = "heartunlocks";
export const HEARTUNLOCKS_API_BASE_URL = "https://api.heartunlocks.com";

export { ProviderOrderUncertainError } from "./types";

// Espera total do app pelo gateway. Precisa ser MAIOR que o prazo total do
// gateway com a HeartUnlocks (gateway/heartunlocks/timeouts.mjs: 15s) mais uma
// folga de rede/processamento — senão o app aborta, marca
// PROVIDER_RESULT_UNCERTAIN e o gateway ainda pode concluir o pedido depois.
// Vercel: nenhuma rota define maxDuration, então vale o limite padrão da
// plataforma, bem acima disto.
export const HEARTUNLOCKS_GATEWAY_TIMEOUT_MS = 25000;

type GatewayFetcher=(input:string,init?:RequestInit)=>Promise<Response>;
export class HeartUnlocksProviderAdapter implements ProviderAdapter {
  readonly code=HEARTUNLOCKS_CODE;
  // Confirmação de HeartUnlocks acontece via callback (heartunlocks-callback.ts),
  // não por consulta de status — getOrderStatus não tem contrato real aqui.
  readonly supportsReconciliation=false;
  constructor(private readonly options:{gatewayUrl:string;gatewaySecret:string;fetcher?:GatewayFetcher;timeoutMs?:number}){}
  private async request<T>(path:string,init:RequestInit={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.options.timeoutMs??HEARTUNLOCKS_GATEWAY_TIMEOUT_MS);try{const response=await(this.options.fetcher??fetch)(`${this.options.gatewayUrl.replace(/\/$/,"")}${path}`,{...init,signal:controller.signal,headers:{"content-type":"application/json",authorization:`Bearer ${this.options.gatewaySecret}`,...init.headers}});const data=await response.json() as T;if(!response.ok)throw new Error(`HEARTUNLOCKS_GATEWAY_${response.status}`);return data}catch(error){if(error instanceof Error&&error.name==="AbortError")throw new ProviderOrderUncertainError();throw error}finally{clearTimeout(timer)}}
  async checkConnection():Promise<ProviderHealth>{try{const result=await this.request<{ok:boolean}>("/health");return{connected:result.ok,message:result.ok?"Gateway disponível":"Gateway indisponível"}}catch{return{connected:false,message:"Gateway indisponível"}}}
  async listProducts():Promise<ProviderCatalogItem[]>{return parseHeartUnlocksCatalogResponse(await this.request<unknown>("/products"))}
  async getBalance():Promise<ProviderBalance>{throw new Error("HEARTUNLOCKS_BALANCE_NOT_ENABLED")}
  async createOrder(input:ProviderOrderInput):Promise<ProviderOrderResult>{const quantity=input.payload.Quantity;const fields=input.payload.fields??{};if(quantity!==1)throw new Error("HEARTUNLOCKS_INVALID_QUANTITY");if(!fields||typeof fields!=="object"||Array.isArray(fields))throw new Error("HEARTUNLOCKS_INVALID_ORDER_FIELDS");try{const result=await this.request<{externalOrderId?:string;referenceId:string;status:"PROCESSING"|"FAILED";error?:string}>("/orders",{method:"POST",body:JSON.stringify({productUuid:input.providerProductId,referenceId:input.reference,quantity,fields})});return{externalOrderId:result.externalOrderId,status:result.status,reference:result.referenceId,error:result.error}}catch(error){if(error instanceof Error&&/^HEARTUNLOCKS_GATEWAY_4\d\d$/.test(error.message))throw error;console.warn("[heartunlocks] createOrder incerto",{reference:input.reference,cause:error instanceof ProviderOrderUncertainError?"APP_TIMEOUT":error instanceof Error?`${error.name}:${error.message}`.slice(0,120):"UNKNOWN"});if(error instanceof ProviderOrderUncertainError)throw error;throw new ProviderOrderUncertainError()}}
  async getOrderStatus():Promise<ProviderOrderResult>{throw new Error("HEARTUNLOCKS_STATUS_CONTRACT_NOT_ENABLED")}
}

export class HeartUnlocksDisconnectedAdapter implements ProviderAdapter {
  readonly code=HEARTUNLOCKS_CODE;
  readonly supportsReconciliation=false;
  async checkConnection():Promise<ProviderHealth>{return{connected:false,message:"Não conectado"}}
  async listProducts():Promise<ProviderCatalogItem[]>{throw new ProviderNotConnectedError(this.code)}
  async getBalance():Promise<ProviderBalance>{throw new ProviderNotConnectedError(this.code)}
  async createOrder(_input:ProviderOrderInput):Promise<ProviderOrderResult>{throw new ProviderNotConnectedError(this.code)}
  async getOrderStatus(_externalOrderId:string):Promise<ProviderOrderResult>{throw new ProviderNotConnectedError(this.code)}
}

export function configuredHeartUnlocksAdapter(){const gatewayUrl=process.env.HEARTUNLOCKS_GATEWAY_URL;const gatewaySecret=process.env.HEARTUNLOCKS_GATEWAY_SECRET;return gatewayUrl&&gatewaySecret?new HeartUnlocksProviderAdapter({gatewayUrl,gatewaySecret}):new HeartUnlocksDisconnectedAdapter()}
