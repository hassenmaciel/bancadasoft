import { createConfiguredAsaasProvider } from "./asaas";
import { MockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./types";
export function getPaymentProvider(code:string):PaymentProvider|null{if(code==="mock")return new MockPaymentProvider();if(code==="asaas")return createConfiguredAsaasProvider();return null;}
export function configuredPaymentProviderCode(env:NodeJS.ProcessEnv=process.env){const explicit=env.PAYMENT_PROVIDER?.trim().toLowerCase();if(explicit){if(explicit==="mock"||explicit==="asaas")return explicit;return "invalid"}if(env.ASAAS_ENV==="sandbox"&&env.ASAAS_API_KEY?.trim())return "asaas";return "mock";}
