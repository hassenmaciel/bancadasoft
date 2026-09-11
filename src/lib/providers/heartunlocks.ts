import type { ProviderAdapter, ProviderBalance, ProviderCatalogItem, ProviderHealth, ProviderOrderInput, ProviderOrderResult } from "./types";
import { ProviderNotConnectedError } from "./types";

export const HEARTUNLOCKS_CODE = "heartunlocks";
export const HEARTUNLOCKS_API_BASE_URL = "https://api.heartunlocks.com";

export class ProviderOrderUncertainError extends Error {
  constructor(){super("PROVIDER_RESULT_UNCERTAIN");this.name="ProviderOrderUncertainError"}
}

type GatewayFetcher=(input:string,init?:RequestInit)=>Promise<Response>;
export class HeartUnlocksProviderAdapter implements ProviderAdapter {
  readonly code=HEARTUNLOCKS_CODE;
  constructor(private readonly options:{gatewayUrl:string;gatewaySecret:string;fetcher?:GatewayFetcher;timeoutMs?:number}){}
  private async request<T>(path:string,init:RequestInit={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.options.timeoutMs??12000);try{const response=await(this.options.fetcher??fetch)(`${this.options.gatewayUrl.replace(/\/$/,"")}${path}`,{...init,signal:controller.signal,headers:{"content-type":"application/json",authorization:`Bearer ${this.options.gatewaySecret}`,...init.headers}});const data=await response.json() as T;if(!response.ok)throw new Error(`HEARTUNLOCKS_GATEWAY_${response.status}`);return data}catch(error){if(error instanceof Error&&error.name==="AbortError")throw new ProviderOrderUncertainError();throw error}finally{clearTimeout(timer)}}
  async checkConnection():Promise<ProviderHealth>{try{const result=await this.request<{ok:boolean}>("/health");return{connected:result.ok,message:result.ok?"Gateway disponível":"Gateway indisponível"}}catch{return{connected:false,message:"Gateway indisponível"}}}
  async listProducts():Promise<ProviderCatalogItem[]>{throw new Error("HEARTUNLOCKS_CATALOG_SYNC_NOT_ENABLED")}
  async getBalance():Promise<ProviderBalance>{throw new Error("HEARTUNLOCKS_BALANCE_NOT_ENABLED")}
  async createOrder(input:ProviderOrderInput):Promise<ProviderOrderResult>{const quantity=input.payload.Quantity;if(quantity!==1)throw new Error("HEARTUNLOCKS_INVALID_QUANTITY");const result=await this.request<{externalOrderId:string;referenceId:string;status:"PROCESSING"|"FAILED";error?:string}>("/orders",{method:"POST",body:JSON.stringify({productUuid:input.providerProductId,referenceId:input.reference,quantity})});return{externalOrderId:result.externalOrderId,status:result.status,reference:result.referenceId,error:result.error}}
  async getOrderStatus():Promise<ProviderOrderResult>{throw new Error("HEARTUNLOCKS_STATUS_CONTRACT_NOT_ENABLED")}
}

export class HeartUnlocksDisconnectedAdapter implements ProviderAdapter {
  readonly code=HEARTUNLOCKS_CODE;
  async checkConnection():Promise<ProviderHealth>{return{connected:false,message:"Não conectado"}}
  async listProducts():Promise<ProviderCatalogItem[]>{throw new ProviderNotConnectedError(this.code)}
  async getBalance():Promise<ProviderBalance>{throw new ProviderNotConnectedError(this.code)}
  async createOrder(_input:ProviderOrderInput):Promise<ProviderOrderResult>{throw new ProviderNotConnectedError(this.code)}
  async getOrderStatus(_externalOrderId:string):Promise<ProviderOrderResult>{throw new ProviderNotConnectedError(this.code)}
}

export function configuredHeartUnlocksAdapter(){const gatewayUrl=process.env.HEARTUNLOCKS_GATEWAY_URL;const gatewaySecret=process.env.HEARTUNLOCKS_GATEWAY_SECRET;return gatewayUrl&&gatewaySecret?new HeartUnlocksProviderAdapter({gatewayUrl,gatewaySecret}):new HeartUnlocksDisconnectedAdapter()}
