import { NextResponse } from "next/server";
import { session } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ data: await session() });
}
