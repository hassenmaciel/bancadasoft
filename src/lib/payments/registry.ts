import { createConfiguredAsaasProvider } from "./asaas";
import { MockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./types";
export function getPaymentProvider(code:string):PaymentProvider|null{if(code==="mock")return new MockPaymentProvider();if(code==="asaas")return createConfiguredAsaasProvider();return null;}
export function configuredPaymentProviderCode(env:NodeJS.ProcessEnv=process.env){if(env.PAYMENT_PROVIDER==="mock")return "mock";if(env.ASAAS_ENV==="sandbox"&&env.ASAAS_API_KEY)return "asaas";return "mock";}
