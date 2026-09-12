import { prisma } from "@/lib/prisma";
import CategoryManager from "./category-manager";
export const dynamic = "force-dynamic";
export default async function CategoriesPage() { const categories = await prisma.category.findMany({include:{_count:{select:{products:true}}},orderBy:{name:"asc"}}); return <CategoryManager initialCategories={categories.map((item) => ({id:item.id,name:item.name,slug:item.slug,active:item.active,productCount:item._count.products}))} />; }
