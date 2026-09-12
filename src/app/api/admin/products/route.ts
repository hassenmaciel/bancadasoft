import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { adminProductDto, productInputSchema } from "@/lib/admin-catalog";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
export const dynamic = "force-dynamic";
const include = {category:true,brand:true,providerProducts:{include:{provider:true}}} as const;
export async function GET(){try{await requireAdmin()}catch{return NextResponse.json({error:"Não autorizado."},{status:403})}const products=await prisma.product.findMany({include,orderBy:{updatedAt:"desc"}});return NextResponse.json({data:products.map(adminProductDto)})}
export async function POST(request:Request){let admin;try{admin=await requireAdmin()}catch{return NextResponse.json({error:"Não autorizado."},{status:403})}const parsed=productInputSchema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({error:parsed.error.issues[0]?.message??"Dados inválidos."},{status:422});const category=await prisma.category.findUnique({where:{id:parsed.data.categoryId},select:{id:true}});if(!category)return NextResponse.json({error:"Categoria não encontrada."},{status:422});try{const product=await prisma.product.create({data:parsed.data,include});await audit(admin.id,"PRODUCT_CREATED","Product",product.id,{name:product.name,status:product.status,priceCents:product.priceCents,costCents:product.costCents});return NextResponse.json({data:adminProductDto(product)},{status:201})}catch{return NextResponse.json({error:"Não foi possível criar o produto. Verifique o slug."},{status:409})}}
