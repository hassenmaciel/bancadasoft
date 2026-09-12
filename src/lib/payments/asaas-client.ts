export const ASAAS_SANDBOX_BASE_URL="https://api-sandbox.asaas.com/v3";
export const ASAAS_PRODUCTION_BASE_URL="https://api.asaas.com/v3";
const ASAAS_BASE_URLS = new Set([ASAAS_SANDBOX_BASE_URL, ASAAS_PRODUCTION_BASE_URL]);
export class AsaasClientError extends Error{constructor(public readonly status:number|null,code:string,public readonly providerCodes:string[]=[],public readonly providerReason:string|null=null){super(code);this.name="AsaasClientError";}}
const safeCode=(value:unknown)=>typeof value==="string"?/^[A-Za-z0-9_.-]{1,80}$/.test(value)?value:null:null;
function providerErrorMetadata(value:unknown){
  if(!value||typeof value!=="object"||!Array.isArray((value as {errors?:unknown}).errors))return{codes:[] as string[],reason:null as string|null};
  const errors=(value as {errors:Array<{code?:unknown;description?:unknown}>}).errors;
  const codes=errors.map((item)=>safeCode(item.code)).filter((item):item is string=>!!item);
  const pixPending=errors.some((item)=>{const description=typeof item.description==="string"?item.description.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase():"";const code=typeof item.code==="string"?item.code.toLowerCase():"";return /(pix|qr.?code)/.test(`${code} ${description}`)&&/(aguard|indispon|process|geran|moment|tempor|not.?ready|not.?available|try.?again)/.test(`${code} ${description}`);});
  return{codes,reason:pixPending?"PIX_NOT_READY":null};
}
type Fetcher=typeof fetch;
export class AsaasClient{
  readonly baseUrl:string;
  constructor(private readonly apiKey:string,options:{baseUrl?:string;timeoutMs?:number;fetcher?:Fetcher}={}){if(!apiKey.trim())throw new AsaasClientError(null,"ASAAS_NOT_CONFIGURED");this.baseUrl=(options.baseUrl??ASAAS_SANDBOX_BASE_URL).trim().replace(/\/+$/,"");if(!ASAAS_BASE_URLS.has(this.baseUrl))throw new AsaasClientError(null,"ASAAS_BASE_URL_NOT_ALLOWED");this.timeoutMs=options.timeoutMs??10000;this.fetcher=options.fetcher??fetch;}
  private readonly timeoutMs:number;private readonly fetcher:Fetcher;
  async request<T>(path:string,init:RequestInit={}):Promise<T>{const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{const environment=this.baseUrl===ASAAS_PRODUCTION_BASE_URL?"Production":"Sandbox";const response=await this.fetcher(`${this.baseUrl}${path}`,{...init,signal:controller.signal,headers:{accept:"application/json","content-type":"application/json",access_token:this.apiKey.trim(),"user-agent":`BancadaSoft-${environment}/1.0`,...init.headers}});let data:unknown=null;try{const text=await response.text();data=text?JSON.parse(text):null;}catch{if(response.ok)throw new AsaasClientError(response.status,"ASAAS_INVALID_JSON");}if(!response.ok){const metadata=providerErrorMetadata(data);throw new AsaasClientError(response.status,`ASAAS_HTTP_${response.status}`,metadata.codes,metadata.reason);}if(data===null)throw new AsaasClientError(response.status,"ASAAS_INVALID_JSON");return data as T;}catch(error){if(error instanceof AsaasClientError)throw error;if(error instanceof Error&&error.name==="AbortError")throw new AsaasClientError(null,"ASAAS_TIMEOUT");throw new AsaasClientError(null,"ASAAS_NETWORK_ERROR");}finally{clearTimeout(timer);}}
}
