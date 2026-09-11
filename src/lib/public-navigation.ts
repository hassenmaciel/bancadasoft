import { ProductType } from "@prisma/client";

const productTypeAliases: Record<string, ProductType> = {
  ferramenta: ProductType.TOOL,
  ferramentas: ProductType.TOOL,
  aluguel: ProductType.RENTAL,
  alugueis: ProductType.RENTAL,
  ativacao: ProductType.ACTIVATION,
  ativacoes: ProductType.ACTIVATION,
  licenca: ProductType.LICENSE,
  licencas: ProductType.LICENSE,
  credito: ProductType.CREDIT,
  creditos: ProductType.CREDIT,
  imei: ProductType.IMEI_SN,
  arquivo: ProductType.FILE,
  arquivos: ProductType.FILE,
  servico: ProductType.REMOTE_SERVICE,
  servicos: ProductType.REMOTE_SERVICE,
  remoto: ProductType.REMOTE_SERVICE,
};

const normalize = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

export function parsePublicProductType(value?: string | null) {
  if (!value) return undefined;
  return productTypeAliases[normalize(value)];
}

export function safeNextPath(value?: string | null, fallback = "/meus-pedidos") {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export function canReadOrder(user: { id: string; role: string }, customerId: string) {
  return user.role === "ADMIN" || user.id === customerId;
}
