import { NextResponse } from "next/server";
import { getOrder } from "@/lib/commerce";
import { orderDto } from "@/lib/dto";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const order = await getOrder(id); return order ? NextResponse.json({ data: orderDto(order) }) : NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 }); }
