import { timingSafeEqual } from "node:crypto";
export function validateAsaasWebhookToken(received:string|null,expected=process.env.ASAAS_WEBHOOK_TOKEN){if(!received||!expected)return false;const left=Buffer.from(received);const right=Buffer.from(expected);return left.length===right.length&&timingSafeEqual(left,right);}
