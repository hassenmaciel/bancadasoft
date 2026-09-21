import type { DeliveryDTO } from "./dto";

const deliveryTypes = new Set<NonNullable<DeliveryDTO["deliveryType"]>>([
  "CREDENTIALS",
  "LICENSE",
  "CODE",
  "TEXT",
  "MULTI_FIELD",
]);

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;

export function customerDelivery(value: unknown): DeliveryDTO | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const username = text(data.username);
  const password = text(data.password);
  const credential = text(data.credential);
  const title = text(data.title);
  const instructions = text(data.instructions);
  const deliveryFields = Array.isArray(data.deliveryFields)
    ? data.deliveryFields.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const field = entry as Record<string, unknown>;
        const key = text(field.key);
        const label = text(field.label);
        const fieldValue = text(field.value);
        if (!key || !label || !fieldValue) return [];
        return [{ key, label, value: fieldValue, sensitive: field.sensitive === true }];
      })
    : [];
  const declaredType = deliveryTypes.has(
    data.deliveryType as NonNullable<DeliveryDTO["deliveryType"]>,
  )
    ? (data.deliveryType as NonNullable<DeliveryDTO["deliveryType"]>)
    : undefined;
  const deliveryType =
    declaredType ??
    (username && password
      ? "CREDENTIALS"
      : credential
        ? "CODE"
        : deliveryFields.length > 1
          ? "MULTI_FIELD"
          : deliveryFields.length === 1
            ? "TEXT"
            : undefined);
  const valid =
    (deliveryType === "CREDENTIALS" && Boolean(username && password)) ||
    ((deliveryType === "CODE" || deliveryType === "LICENSE") &&
      Boolean(credential || deliveryFields.length)) ||
    // Licença confirmada pelo fornecedor sem retorno textual (UnlockTool): a
    // entrega mínima não tem credential nem campos, só a confirmação.
    (deliveryType === "LICENSE" && Boolean(instructions)) ||
    (deliveryType === "TEXT" && Boolean(deliveryFields.length || instructions)) ||
    (deliveryType === "MULTI_FIELD" && deliveryFields.length > 0);
  if (!deliveryType || !valid) return null;
  return {
    deliveryType,
    ...(title ? { title } : {}),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(credential ? { credential } : {}),
    ...(instructions ? { instructions } : {}),
    ...(deliveryFields.length ? { deliveryFields } : {}),
  };
}

export function customerOrderState(
  order: string,
  payment?: string,
  fulfillment?: string,
) {
  if (order === "DELIVERED") return "Acesso liberado";
  if (order === "FAILED" || fulfillment === "FAILED")
    return "Falha — requer atenção";
  if (fulfillment === "PROCESSING" || order === "PROCESSING")
    return "Processando liberação";
  if (payment === "PAID") return "Pagamento confirmado";
  return "Pagamento aguardando";
}

export const hasCustomerDelivery = (value: unknown) =>
  customerDelivery(value) !== null;

export const deliveryHeading = (deliveryType?: DeliveryDTO["deliveryType"]) =>
  deliveryType === "CODE"
    ? "Código liberado"
    : deliveryType === "LICENSE"
      ? "Licença liberada"
      : deliveryType === "TEXT" || deliveryType === "MULTI_FIELD"
        ? "Resultado disponível"
        : "Acesso liberado";
