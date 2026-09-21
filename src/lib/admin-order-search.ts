import type { Prisma } from "@prisma/client";
import { buildAttentionWhere, parseAttentionKey } from "./admin-attention";

export type AdminOrderSearchFilters = {
  q?: string;
  orderStatus?: string;
  paymentStatus?: string;
  fulfillmentStatus?: string;
  // Alerta operacional (lista fixa em admin-attention.ts); valor inválido é ignorado.
  attention?: string;
};

const onlyDigits = (value: string) => value.replace(/\D/g, "");

/**
 * Monta o filtro de busca do Admin > Pedidos (PARTE 6/16): localizar por
 * ID/token do pedido, nome, e-mail, CPF, WhatsApp ou produto — inclusive
 * pedido avulso/guest, que usa exatamente o mesmo User/Order (sem estrutura
 * paralela).
 */
export function buildAdminOrderSearchWhere(
  filters: AdminOrderSearchFilters,
): Prisma.OrderWhereInput {
  const clauses: Prisma.OrderWhereInput[] = [];
  const term = filters.q?.trim();
  if (term) {
    const digits = onlyDigits(term);
    const textOr: Prisma.OrderWhereInput[] = [
      { id: { contains: term, mode: "insensitive" } },
      { publicToken: { contains: term, mode: "insensitive" } },
      { customer: { name: { contains: term, mode: "insensitive" } } },
      { customer: { email: { contains: term, mode: "insensitive" } } },
      { items: { some: { product: { name: { contains: term, mode: "insensitive" } } } } },
    ];
    // CPF/WhatsApp são armazenados só em dígitos — buscar pela versão
    // normalizada permite que o admin cole "529.982.247-25" ou "(11) 9...".
    if (digits.length >= 4) {
      textOr.push({ customer: { cpfCnpj: { contains: digits } } });
      textOr.push({ customer: { whatsapp: { contains: digits } } });
    }
    clauses.push({ OR: textOr });
  }
  if (filters.orderStatus && filters.orderStatus !== "ALL")
    clauses.push({ status: filters.orderStatus as never });
  if (filters.paymentStatus && filters.paymentStatus !== "ALL")
    clauses.push({ payment: { status: filters.paymentStatus as never } });
  if (filters.fulfillmentStatus && filters.fulfillmentStatus !== "ALL")
    clauses.push({ fulfillment: { status: filters.fulfillmentStatus as never } });
  // Mesmos builders da contagem do painel: a lista bate com o número do alerta.
  const attention = parseAttentionKey(filters.attention);
  if (attention) clauses.push(buildAttentionWhere(attention));
  return clauses.length ? { AND: clauses } : {};
}
