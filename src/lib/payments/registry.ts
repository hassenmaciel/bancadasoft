import { createConfiguredAsaasProvider } from "./asaas";
import { resolveAsaasApiKey } from "./asaas-api-key";
import { MockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./types";
export function getPaymentProvider(code:string):PaymentProvider|null{if(code==="mock")return new MockPaymentProvider();if(code==="asaas")return createConfiguredAsaasProvider();return null;}
export function configuredPaymentProviderCode(env:NodeJS.ProcessEnv=process.env){const explicit=env.PAYMENT_PROVIDER?.trim().toLowerCase();if(explicit){if(explicit==="mock"||explicit==="asaas")return explicit;return "invalid"}const asaasEnvironment=env.ASAAS_ENV?.trim().toLowerCase();if(asaasEnvironment==="production"&&resolveAsaasApiKey(env).key)return "invalid";if(asaasEnvironment==="sandbox"&&resolveAsaasApiKey(env).key)return "asaas";return "mock";}
