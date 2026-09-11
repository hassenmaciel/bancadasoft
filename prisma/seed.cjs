const {
  PrismaClient,
  ProductStatus,
  ProductType,
  DeliveryType,
  ProviderIntegrationStatus,
} = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const brands = [
  ["UnlockTool", "unlocktool"],
  ["AMT", "amt"],
  ["Chimera", "chimera"],
  ["Octoplus", "octoplus"],
  ["Pandora", "pandora"],
  ["Griffin", "griffin"],
  ["DFT", "dft"],
  ["Sigma", "sigma"],
  ["AdClean", "adclean"],
];

const products = [
  { slug: "unlocktool-6h", name: "UnlockTool", brand: "unlocktool", type: ProductType.RENTAL, duration: "Aluguel 6 horas", description: "Acesso temporário para uso técnico em ambiente de homologação.", priceCents: 2900, featured: true, sortOrder: 100, searchTerms: "unlock unlocktool aluguel ferramenta gsm mobile" },
  { slug: "amt-aluguel", name: "Android Multi Tool / AMT", brand: "amt", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Acesso temporário para avaliação do fluxo comercial da ferramenta.", priceCents: 4900, featured: true, sortOrder: 90, searchTerms: "amt android multi tool aluguel ferramenta mobile" },
  { slug: "chimera-tool-aluguel", name: "Chimera Tool", brand: "chimera", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Produto de homologação para acesso temporário à ferramenta.", priceCents: 5990, featured: true, sortOrder: 80, searchTerms: "chimera tool aluguel ferramenta gsm" },
  { slug: "octoplus-samsung-aluguel", name: "Octoplus Samsung", brand: "octoplus", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Acesso técnico temporário apresentado para homologação do catálogo.", priceCents: 5490, featured: true, sortOrder: 70, searchTerms: "octoplus samsung aluguel ferramenta mobile" },
  { slug: "octoplus-frp-aluguel", name: "Octoplus FRP", brand: "octoplus", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Item de homologação para avaliação da modalidade de aluguel.", priceCents: 5290, sortOrder: 60, searchTerms: "octoplus frp aluguel ferramenta android" },
  { slug: "pandora-tool-aluguel", name: "Pandora Tool", brand: "pandora", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Acesso temporário cadastrado para homologação comercial.", priceCents: 5190, sortOrder: 50, searchTerms: "pandora tool aluguel ferramenta gsm" },
  { slug: "griffin-unlocker-aluguel", name: "Griffin Unlocker", brand: "griffin", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Produto de homologação para acesso técnico temporário.", priceCents: 4990, sortOrder: 40, searchTerms: "griffin unlocker aluguel unlock ferramenta" },
  { slug: "dft-pro-aluguel", name: "DFT Pro", brand: "dft", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Acesso temporário para avaliação funcional do catálogo.", priceCents: 4890, sortOrder: 30, searchTerms: "dft pro aluguel ferramenta mobile" },
  { slug: "sigmaplus-aluguel", name: "SigmaPlus", brand: "sigma", type: ProductType.RENTAL, duration: "Modalidade de aluguel", description: "Item de homologação da oferta de ferramentas por aluguel.", priceCents: 4790, sortOrder: 20, searchTerms: "sigma sigmaplus aluguel ferramenta gsm" },
  { slug: "unlocktool-ativacao", name: "Ativação UnlockTool", brand: "unlocktool", type: ProductType.ACTIVATION, description: "Ativação cadastrada para homologação, com condições comerciais ajustáveis pelo Admin.", priceCents: 14990, sortOrder: 45, searchTerms: "unlocktool ativacao licença software" },
  { slug: "chimera-licenca", name: "Licença Chimera", brand: "chimera", type: ProductType.LICENSE, description: "Licença de homologação sem definição de plano ou prazo comercial definitivo.", priceCents: 18990, sortOrder: 44, searchTerms: "chimera licença licenca ativacao software" },
  { slug: "dft-pro-ativacao", name: "Ativação DFT Pro", brand: "dft", type: ProductType.ACTIVATION, description: "Ativação de homologação para validação do catálogo e do checkout.", priceCents: 15990, sortOrder: 43, searchTerms: "dft pro ativacao licença software" },
  { slug: "pandora-licenca", name: "Licença Pandora", brand: "pandora", type: ProductType.LICENSE, description: "Licença cadastrada com dados provisórios para avaliação comercial.", priceCents: 17990, sortOrder: 42, searchTerms: "pandora licença licenca software ativacao" },
  { slug: "amt-ativacao", name: "Ativação AMT", brand: "amt", type: ProductType.ACTIVATION, description: "Ativação de homologação sem promessa de plano ou benefício específico.", priceCents: 13990, sortOrder: 41, searchTerms: "amt android multi tool ativacao licença" },
  { slug: "creditos-tecnicos", name: "Créditos para serviços técnicos", type: ProductType.CREDIT, description: "Item de homologação para validar a modalidade de créditos no catálogo.", priceCents: 5000, sortOrder: 15, searchTerms: "creditos créditos saldo serviços tecnicos" },
  { slug: "consulta-imei-sn", name: "Consulta IMEI / SN", type: ProductType.IMEI_SN, description: "Serviço de homologação para validar consultas por IMEI ou número de série.", priceCents: 2500, sortOrder: 14, searchTerms: "imei sn serial consulta serviço mobile" },
  { slug: "suporte-remoto-android", name: "Suporte remoto Android", type: ProductType.REMOTE_SERVICE, description: "Atendimento técnico remoto de homologação, sujeito à análise antes da execução.", priceCents: 7900, sortOrder: 13, searchTerms: "android suporte remoto assistência tecnica" },
  { slug: "diagnostico-remoto-mobile", name: "Diagnóstico remoto mobile", type: ProductType.REMOTE_SERVICE, description: "Diagnóstico remoto de homologação, sem garantia antecipada de resultado.", priceCents: 5900, sortOrder: 12, searchTerms: "diagnostico remoto mobile android suporte" },
  { slug: "adclean", name: "AdClean", brand: "adclean", type: ProductType.TOOL, description: "Solução profissional para diagnóstico e remoção de adwares, aplicativos indesejados e problemas relacionados a anúncios em dispositivos Android.", priceCents: 3990, featured: true, sortOrder: 65, searchTerms: "adclean anúncios anuncios adware limpeza android produto próprio" },
];

async function main() {
  const userPassword = process.env.SEED_USER_PASSWORD;
  if (!userPassword) {
    throw new Error("Variáveis de senha do seed não configuradas.");
  }

  const category = await prisma.category.upsert({
    where: { slug: "ferramentas" },
    update: { name: "Ferramentas", active: true },
    create: { name: "Ferramentas", slug: "ferramentas" },
  });

  const brandIds = new Map();
  for (const [name, slug] of brands) {
    const brand = await prisma.brand.upsert({
      where: { slug },
      update: { name, active: true },
      create: { name, slug, active: true },
    });
    brandIds.set(slug, brand.id);
  }

  const userHash = await bcrypt.hash(userPassword, 12);
  const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
  if (!existingAdmin) {
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!adminPassword) throw new Error("Variável de senha do ADMIN de desenvolvimento não configurada.");
    const adminHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.create({ data: { name: "Administrador", email: "admin@bancadasoft.local", role: "ADMIN", passwordHash: adminHash } });
  }
  await prisma.user.upsert({
    where: { email: "usuario@bancadasoft.local" },
    update: { passwordHash: userHash },
    create: { name: "Usuário de desenvolvimento", email: "usuario@bancadasoft.local", role: "USER", passwordHash: userHash },
  });

  const persistedProducts = new Map();
  for (const item of products) {
    const data = {
      name: item.name,
      description: item.description,
      longDescription: null,
      type: item.type,
      deliveryType: DeliveryType.ON_REQUEST,
      deliveryEstimate: "Prazo informado após análise",
      duration: item.duration ?? null,
      imageUrl: null,
      priceCents: item.priceCents,
      featured: item.featured ?? false,
      sortOrder: item.sortOrder,
      status: ProductStatus.PUBLISHED,
      available: true,
      categoryId: category.id,
      brandId: item.brand ? brandIds.get(item.brand) : null,
      searchTerms: `${item.searchTerms} homologação`,
    };
    const product = await prisma.product.upsert({
      where: { slug: item.slug },
      update: data,
      create: { slug: item.slug, ...data },
    });
    persistedProducts.set(item.slug, product);
  }

  await prisma.siteSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", businessName: "BANCADASOFT", slogan: "Encontrou. Pagou. Liberou.", domain: "bancadasoft.com.br" },
  });
  const heartUnlocks = await prisma.provider.upsert({
    where: { code: "heartunlocks" },
    update: { name: "HeartUnlocks", apiBaseUrl: "https://api.heartunlocks.com", active: false, integrationStatus: ProviderIntegrationStatus.NOT_CONNECTED },
    create: { name: "HeartUnlocks", code: "heartunlocks", apiBaseUrl: "https://api.heartunlocks.com", active: false, integrationStatus: ProviderIntegrationStatus.NOT_CONNECTED },
  });
  const sandbox = await prisma.provider.upsert({
    where: { code: "mock-sandbox" },
    update: { active: true, integrationStatus: ProviderIntegrationStatus.CONNECTED },
    create: { name: "Sandbox BancadaSoft", code: "mock-sandbox", active: true, integrationStatus: ProviderIntegrationStatus.CONNECTED },
  });
  const unlockTool = persistedProducts.get("unlocktool-6h");
  await prisma.providerProduct.upsert({
    where: { providerId_productId_externalProductId: { providerId: heartUnlocks.id, productId: unlockTool.id, externalProductId: "2194" } },
    update: { label: "UNLOCKTOOL RENT [6 Hours]", active: true, providerCostCents: 30, currency: "USD", metadata: { requiredFields: ["Quantity"], quantity: 1, providerTime: "1-60 Minutes", imageUrl: "https://static.dhrufusion.net/f127194c-9ca4-40c1-a937-27c66f4e8c26/2026/05/24/9MaSE7cD_WhatsApp_Image_2026-05-14_at_13.46.39.jpeg" } },
    create: { providerId: heartUnlocks.id, productId: unlockTool.id, externalProductId: "2194", label: "UNLOCKTOOL RENT [6 Hours]", providerCostCents: 30, currency: "USD", active: true, metadata: { requiredFields: ["Quantity"], quantity: 1, providerTime: "1-60 Minutes", imageUrl: "https://static.dhrufusion.net/f127194c-9ca4-40c1-a937-27c66f4e8c26/2026/05/24/9MaSE7cD_WhatsApp_Image_2026-05-14_at_13.46.39.jpeg" } },
  });
  await prisma.providerProduct.upsert({
    where: { providerId_productId_externalProductId: { providerId: sandbox.id, productId: unlockTool.id, externalProductId: "unlocktool-sandbox" } },
    update: { active: true, providerCostCents: 1000, currency: "BRL" },
    create: { providerId: sandbox.id, productId: unlockTool.id, externalProductId: "unlocktool-sandbox", label: "UnlockTool Sandbox", providerCostCents: 1000, currency: "BRL", active: true },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : "Falha ao executar o seed.");
    await prisma.$disconnect();
    process.exit(1);
  });
