export const ASAAS_SANDBOX_BASE_URL="https://api-sandbox.asaas.com/v3";
export const ASAAS_PRODUCTION_BASE_URL="https://api.asaas.com/v3";
const ASAAS_BASE_URLS = new Set([ASAAS_SANDBOX_BASE_URL, ASAAS_PRODUCTION_BASE_URL]);
export class AsaasClientError extends Error{constructor(public readonly status:number|null,code:string){super(code);this.name="AsaasClientError";}}
type Fetcher=typeof fetch;
export class AsaasClient{
  readonly baseUrl:string;
  constructor(private readonly apiKey:string,options:{baseUrl?:string;timeoutMs?:number;fetcher?:Fetcher}={}){if(!apiKey.trim())throw new AsaasClientError(null,"ASAAS_NOT_CONFIGURED");this.baseUrl=(options.baseUrl??ASAAS_SANDBOX_BASE_URL).trim().replace(/\/+$/,"");if(!ASAAS_BASE_URLS.has(this.baseUrl))throw new AsaasClientError(null,"ASAAS_BASE_URL_NOT_ALLOWED");this.timeoutMs=options.timeoutMs??10000;this.fetcher=options.fetcher??fetch;}
  private readonly timeoutMs:number;private readonly fetcher:Fetcher;
  async request<T>(path:string,init:RequestInit={}):Promise<T>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{const environment=this.baseUrl===ASAAS_PRODUCTION_BASE_URL?"Production":"Sandbox";const response=await this.fetcher(`${this.baseUrl}${path}`,{...init,signal:controller.signal,headers:{accept:"application/json","content-type":"application/json",access_token:this.apiKey.trim(),"user-agent":`BancadaSoft-${environment}/1.0`,...init.headers}});let data:unknown;try{data=await response.json();}catch{throw new AsaasClientError(response.status,"ASAAS_INVALID_JSON");}if(!response.ok)throw new AsaasClientError(response.status,`ASAAS_HTTP_${response.status}`);return data as T;}catch(error){if(error instanceof AsaasClientError)throw error;if(error instanceof Error&&error.name==="AbortError")throw new AsaasClientError(null,"ASAAS_TIMEOUT");throw new AsaasClientError(null,"ASAAS_NETWORK_ERROR");}finally{clearTimeout(timer);}}
}
