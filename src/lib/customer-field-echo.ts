// Echo dos dados que o cliente informou no checkout (serial, ECID, e-mail da
// conta...), para conferir junto do resultado que o pedido foi feito para o
// aparelho/conta certos. providerFields guarda o valor sob providerFieldName
// (ex.: "ECID", "Serial ", "Serial Number"), não sob a key normalizada, então
// o cruzamento é sempre feito pelo fieldSchema do ProviderProduct comprado.
// Só entram campos customerVisible e não sensíveis; quantity nunca entra.
export type CustomerFieldEcho = { key: string; label: string; value: string };

type SchemaHolder = { fieldSchema?: unknown } | null | undefined;
export type EchoOrderItem = {
  providerFields?: unknown;
  providerProduct?: SchemaHolder;
  productVariant?: { providerProduct?: SchemaHolder } | null;
};

const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function customerFieldEcho(fieldSchema: unknown, providerFields: unknown): CustomerFieldEcho[] {
  const values = record(providerFields);
  if (!Array.isArray(fieldSchema) || !values) return [];
  return fieldSchema
    .flatMap((entry) => {
      const field = record(entry);
      if (!field || field.customerVisible !== true || field.sensitive === true) return [];
      const key = typeof field.key === "string" ? field.key : "";
      const name = typeof field.providerFieldName === "string" ? field.providerFieldName : "";
      if (!key || !name || key === "quantity" || field.type === "quantity") return [];
      const raw = values[name];
      const value = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
      if (!value) return [];
      const label = typeof field.label === "string" && field.label.trim() ? field.label.trim() : key;
      const position = typeof field.position === "number" ? field.position : 0;
      return [{ key, label, value: value.slice(0, 500), position }];
    })
    .sort((a, b) => a.position - b.position)
    .map(({ key, label, value }) => ({ key, label, value }));
}

// O ProviderProduct comprado fica em OrderItem.providerProduct; pedidos
// antigos sem esse vínculo caem no ProviderProduct da variante.
export const orderItemFieldEcho = (item: EchoOrderItem) =>
  customerFieldEcho(
    item.providerProduct?.fieldSchema ?? item.productVariant?.providerProduct?.fieldSchema,
    item.providerFields,
  );

export const orderFieldEcho = (items: EchoOrderItem[]) => items.flatMap((item) => orderItemFieldEcho(item));

// Mesmo formato para a resposta pública: o select do Prisma que as rotas usam.
export const orderItemEchoSelect = {
  providerFields: true,
  providerProduct: { select: { fieldSchema: true } },
  productVariant: { select: { providerProduct: { select: { fieldSchema: true } } } },
} as const;
