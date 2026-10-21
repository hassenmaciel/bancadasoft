// Leitura da resposta de criação de pedido da HeartUnlocks.
// Em produção (out/2026) data[0] veio como o orderId em texto (ex.: "I26101901..."),
// não como objeto; o formato antigo { order_uuid } continua aceito.

const kind = (value) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

// { orderId } quando aceito; { orderId: null } quando recusado. itemType nunca carrega valor.
export function parseHeartUnlocksOrderResponse(result) {
  const item = Array.isArray(result?.data) ? result.data[0] : undefined;
  const itemType = Array.isArray(result?.data) && result.data.length === 0 ? "empty" : kind(item);
  if (result?.status !== "success") return { orderId: null, itemType };
  if (typeof item === "string" && item.trim()) return { orderId: item.trim(), itemType };
  if (itemType === "object") {
    const id = item.order_uuid || item.order_id;
    if (id) return { orderId: String(id), itemType };
  }
  return { orderId: null, itemType };
}
