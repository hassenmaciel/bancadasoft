import type { Prisma } from "@prisma/client";
import { canPublishVariantProduct } from "./product-variants";
import {
  NON_PRODUCTION_PROVIDER_CODES,
  resolveProviderProduct,
  type ProviderProductCandidate,
} from "./providers/selection";

// Vínculo direto Product <-> ProviderProduct (ProviderProduct.productId), feito
// pelo seletor "Produto do fornecedor" do Admin. Mesmos critérios do vínculo
// por variante (rotas de variantes) e da resolução do checkout no modo REAL.

// Itens que podem ser ligados ao produto: operacionais, de fornecedor de
// produção, sem variante ligada e livres (ou já ligados a este produto).
export const linkCandidateWhere = (productId: string) => ({
  active: true,
  mode: "REAL",
  technicalEligibility: "READY",
  provider: { active: true, code: { notIn: [...NON_PRODUCTION_PROVIDER_CODES] } },
  variants: { none: {} },
  OR: [{ productId: null }, { productId }],
}) satisfies Prisma.ProviderProductWhereInput;

type PublicationVariant = Parameters<typeof canPublishVariantProduct>[0][number];
export type PublicationSubject = {
  deliveryType: string;
  variants?: PublicationVariant[] | null;
  providerProducts?: ProviderProductCandidate[] | null;
};

// Produto com variantes: regra atual (canPublishVariantProduct). Sem variantes,
// entrega AUTOMATIC exige exatamente um vínculo direto elegível — o mesmo que
// o checkout resolveria no modo REAL. Outros tipos de entrega não mudam.
export function canPublishAutomatic(product: PublicationSubject) {
  const variants = product.variants ?? [];
  if (variants.length) return canPublishVariantProduct(variants);
  if (product.deliveryType !== "AUTOMATIC") return true;
  return resolveProviderProduct(product.providerProducts ?? [], "REAL").status === "SELECTED";
}

export const VARIANT_PUBLICATION_ERROR =
  "Configure ao menos uma variante ativa, liberada e com preço antes de publicar.";
export const PROVIDER_LINK_PUBLICATION_ERROR =
  "Falta o produto do fornecedor: produto de entrega automática só pode ser publicado com um item do fornecedor vinculado (seção “Produto do fornecedor”).";

export function publicationError(product: PublicationSubject) {
  if (canPublishAutomatic(product)) return null;
  return product.variants?.length ? VARIANT_PUBLICATION_ERROR : PROVIDER_LINK_PUBLICATION_ERROR;
}

// Resumo gravado no AuditLog (before/after) e devolvido pela rota.
export const providerLinkSelect = {
  id: true,
  externalProductId: true,
  label: true,
  provider: { select: { id: true, code: true, name: true } },
} as const;
