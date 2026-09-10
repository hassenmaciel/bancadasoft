import { NextResponse } from "next/server";
import { catalogue } from "@/lib/commerce";
import { productDto } from "@/lib/dto";
export const dynamic = "force-dynamic";
export async function GET() { return NextResponse.json({ data: (await catalogue()).map(productDto) }); }
