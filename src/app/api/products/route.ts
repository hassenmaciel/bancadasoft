import { NextResponse } from "next/server";
import { catalogue } from "@/lib/commerce";
import { productDto } from "@/lib/dto";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET() { const settings=await prisma.siteSettings.findUnique({where:{id:"default"},select:{maintenanceEnabled:true,maintenanceMessage:true}});if(settings?.maintenanceEnabled)return NextResponse.json({maintenance:true,message:settings.maintenanceMessage},{status:503});return NextResponse.json({ data: (await catalogue()).map(productDto) }); }
