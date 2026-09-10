export const ASAAS_SANDBOX_BASE_URL="https://api-sandbox.asaas.com/v3";
export class AsaasClientError extends Error{constructor(public readonly status:number|null,code:string){super(code);this.name="AsaasClientError";}}
type Fetcher=typeof fetch;
export class AsaasClient{
  readonly baseUrl:string;
  constructor(private readonly apiKey:string,options:{baseUrl?:string;timeoutMs?:number;fetcher?:Fetcher}={}){if(!apiKey)throw new AsaasClientError(null,"ASAAS_NOT_CONFIGURED");this.baseUrl=options.baseUrl??ASAAS_SANDBOX_BASE_URL;if(this.baseUrl!==ASAAS_SANDBOX_BASE_URL)throw new AsaasClientError(null,"ASAAS_SANDBOX_ONLY");this.timeoutMs=options.timeoutMs??10000;this.fetcher=options.fetcher??fetch;}
  private readonly timeoutMs:number;private readonly fetcher:Fetcher;
  async request<T>(path:string,init:RequestInit={}):Promise<T>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{const response=await this.fetcher(`${this.baseUrl}${path}`,{...init,signal:controller.signal,headers:{accept:"application/json","content-type":"application/json",access_token:this.apiKey,"user-agent":"BancadaSoft-Sandbox/1.0",...init.headers}});let data:unknown;try{data=await response.json();}catch{throw new AsaasClientError(response.status,"ASAAS_INVALID_JSON");}if(!response.ok)throw new AsaasClientError(response.status,`ASAAS_HTTP_${response.status}`);return data as T;}catch(error){if(error instanceof AsaasClientError)throw error;if(error instanceof Error&&error.name==="AbortError")throw new AsaasClientError(null,"ASAAS_TIMEOUT");throw new AsaasClientError(null,"ASAAS_NETWORK_ERROR");}finally{clearTimeout(timer);}}
}
