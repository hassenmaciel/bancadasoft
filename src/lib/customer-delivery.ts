export type CredentialDeliveryData = { title?:string; username?:string; password?:string; instructions?:string };

export function customerOrderState(order:string, payment?:string, fulfillment?:string) {
  if (order === "DELIVERED") return "Acesso liberado";
  if (order === "FAILED" || fulfillment === "FAILED") return "Falha — requer atenção";
  if (fulfillment === "PROCESSING" || order === "PROCESSING") return "Processando liberação";
  if (payment === "PAID") return "Pagamento confirmado";
  return "Pagamento aguardando";
}

export function hasCredentialDelivery(value:unknown): value is CredentialDeliveryData {
  if (!value || typeof value !== "object") return false;
  const data=value as Record<string,unknown>;
  return typeof data.username === "string" && data.username.length > 0 && typeof data.password === "string" && data.password.length > 0;
}
