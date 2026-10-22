import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { linkCandidateWhere, providerLinkSelect } from "@/lib/admin-provider-link";
import { prisma } from "@/lib/prisma";
import { recalculateProducts } from "@/lib/pricing-service";

type Context = { params: Promise<{ id: string }> };

const bodySchema = z.object({ providerProductId: z.string().min(1).nullable() });

class LinkRefusal extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

// Liga (ou troca/remove) o item do fornecedor de um produto sem variantes.
// Um item por produto: o claim do novo item é atômico (updateMany com guarda
// productId nulo ou deste produto) e os demais vínculos do produto são
// desfeitos na mesma transação, com a linha do Product travada.
export async function PUT(request: Request, context: Context) {
  let admin;
  try { admin = await requireAdmin(); }
  catch { return NextResponse.json({ error: "Não autorizado." }, { status: 403 }); }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos." }, { status: 422 });
  const { id } = await context.params;
  const { providerProductId } = parsed.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id} FOR UPDATE`;
      const product = await tx.product.findUnique({
        where: { id },
        select: {
          status: true,
          deliveryType: true,
          _count: { select: { variants: true } },
          providerProducts: { select: providerLinkSelect, orderBy: { createdAt: "asc" } },
        },
      });
      if (!product) throw new LinkRefusal(404, "Produto não encontrado.");
      if (product._count.variants)
        throw new LinkRefusal(422, "Produto com variantes: o produto do fornecedor é escolhido em cada variante.");
      const before = product.providerProducts[0] ?? null;
      if (providerProductId === null) {
        if (product.status === "PUBLISHED" && product.deliveryType === "AUTOMATIC")
          throw new LinkRefusal(422, "Produto publicado com entrega automática não pode ficar sem produto do fornecedor. Pause o produto antes de remover o vínculo.");
        if (!product.providerProducts.length) return { changed: false, after: null };
        await tx.providerProduct.updateMany({ where: { productId: id }, data: { productId: null } });
      } else {
        if (product.providerProducts.length === 1 && before?.id === providerProductId)
          return { changed: false, after: before };
        const claim = await tx.providerProduct.updateMany({
          where: { id: providerProductId, ...linkCandidateWhere(id) },
          data: { productId: id },
        });
        if (claim.count !== 1)
          throw new LinkRefusal(409, "Item do fornecedor indisponível: já está ligado a outro produto ou a uma variante, ou não está operacional.");
        await tx.providerProduct.updateMany({
          where: { productId: id, id: { not: providerProductId } },
          data: { productId: null },
        });
      }
      const after = providerProductId
        ? await tx.providerProduct.findUnique({ where: { id: providerProductId }, select: providerLinkSelect })
        : null;
      await tx.auditLog.create({
        data: {
          actorUserId: admin.id,
          action: "PRODUCT_PROVIDER_LINK_CHANGED",
          entityType: "Product",
          entityId: id,
          metadata: { before, after },
        },
      });
      return { changed: true, after };
    });
    if (result.changed) await recalculateProducts([id]);
    return NextResponse.json({ data: { providerProduct: result.after } });
  } catch (error) {
    if (error instanceof LinkRefusal)
      return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível atualizar o produto do fornecedor." }, { status: 409 });
  }
}
