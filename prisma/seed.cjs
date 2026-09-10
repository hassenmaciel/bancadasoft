const { PrismaClient, ProductStatus, ProductType, ProviderIntegrationStatus } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const prisma = new PrismaClient();
async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const userPassword = process.env.SEED_USER_PASSWORD;
  if (!adminPassword || !userPassword) throw new Error("Variáveis de senha do seed não configuradas.");
  const category = await prisma.category.upsert({ where: { slug: "ferramentas" }, update: {}, create: { name: "Ferramentas", slug: "ferramentas" } });
  await prisma.user.upsert({ where: { email: "admin@bancadasoft.local" }, update: { passwordHash: await bcrypt.hash(adminPassword, 12) }, create: { name: "Administrador", email: "admin@bancadasoft.local", role: "ADMIN", passwordHash: await bcrypt.hash(adminPassword, 12) } });
  await prisma.user.upsert({ where: { email: "usuario@bancadasoft.local" }, update: { passwordHash: await bcrypt.hash(userPassword, 12) }, create: { name: "Usuário de desenvolvimento", email: "usuario@bancadasoft.local", role: "USER", passwordHash: await bcrypt.hash(userPassword, 12) } });
  const product = await prisma.product.upsert({ where: { slug: "unlocktool-6h" }, update: { status: ProductStatus.PUBLISHED, available: true, categoryId: category.id }, create: { slug: "unlocktool-6h", name: "UnlockTool", description: "Produto controlado para validar o fluxo sandbox.", type: ProductType.RENTAL, duration: "Aluguel 6 horas", priceCents: 2900, status: ProductStatus.PUBLISHED, categoryId: category.id } });
  await prisma.provider.upsert({ where: { code: "heartunlocks" }, update: { name: "HeartUnlocks", apiBaseUrl: "https://api.heartunlocks.com", active: false, integrationStatus: ProviderIntegrationStatus.NOT_CONNECTED }, create: { name: "HeartUnlocks", code: "heartunlocks", apiBaseUrl: "https://api.heartunlocks.com", active: false, integrationStatus: ProviderIntegrationStatus.NOT_CONNECTED } });
  const sandbox = await prisma.provider.upsert({ where: { code: "mock-sandbox" }, update: { active: true, integrationStatus: ProviderIntegrationStatus.CONNECTED }, create: { name: "Sandbox BancadaSoft", code: "mock-sandbox", active: true, integrationStatus: ProviderIntegrationStatus.CONNECTED } });
  await prisma.providerProduct.upsert({ where: { providerId_productId_externalProductId: { providerId: sandbox.id, productId: product.id, externalProductId: "unlocktool-sandbox" } }, update: { active: true, providerCostCents: 1000, currency: "BRL" }, create: { providerId: sandbox.id, productId: product.id, externalProductId: "unlocktool-sandbox", label: "UnlockTool Sandbox", providerCostCents: 1000, currency: "BRL", active: true } });
}
main().then(() => prisma.$disconnect()).catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
