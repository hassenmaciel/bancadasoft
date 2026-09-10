import { NextResponse } from "next/server";
import { z } from "zod";
import { createOrder } from "@/lib/commerce";
import { orderDto } from "@/lib/dto";
const schema = z.object({ productId: z.string().min(1), name: z.string().min(2).max(100), email: z.string().email(), whatsapp: z.string().min(8).max(25), cpfCnpj: z.string().regex(/^\d{11}$|^\d{14}$/).optional() });
export async function POST(request: Request) { const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Dados de checkout inválidos.", details: parsed.error.flatten() }, { status: 422 }); const order = await createOrder(parsed.data); if (!order) return NextResponse.json({ error: "Produto não disponível para venda." }, { status: 404 }); return NextResponse.json({ data: orderDto(order) }, { status: 201 }); }
