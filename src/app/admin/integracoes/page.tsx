import { heartUnlocksGatewayStatus, listAdminIntegrations } from "@/lib/admin-integrations";
import { publicAsaasDiagnostic, readAsaasRuntimeConfig } from "@/lib/payments/asaas-diagnostics";
import AsaasDiagnostic from "./asaas-diagnostic";
import ProviderModeControl from "./provider-mode-control";
import ProviderOperationControl from "./provider-operation-control";
import ProviderCatalogSync from "./provider-catalog-sync";

export const dynamic = "force-dynamic";
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
const providerMeta = (value: unknown, key: string) => typeof value === "object" && value && key in value ? String((value as Record<string,unknown>)[key] ?? "") : "";

export default async function IntegrationsPage() {
  const heartGateway = await heartUnlocksGatewayStatus();
  const data = await listAdminIntegrations();
  const asaasDiagnostic = publicAsaasDiagnostic(readAsaasRuntimeConfig());
  return <>
    <header className="admin-heading"><div><small>PROVIDERS</small><h1>Integrações</h1><p>Fornecedores e vínculos técnicos do catálogo.</p></div></header>
    <ProviderModeControl initialMode={data.mode} />
    <h2 className="integration-section-title">Fornecedores técnicos</h2>
    <section className="integration-list">{data.providers.map((provider) => {
      const isHeartUnlocks = provider.code === "heartunlocks";
      const integrationLabel = provider.integrationStatus === "CONNECTED" ? "CONECTADO" : provider.integrationStatus === "NOT_CONNECTED" ? "NÃO CONECTADO" : "ERRO";
      return <article className="integration-card" key={provider.id}>
        <div className="integration-head"><div><span className="provider-mark">{provider.name.slice(0, 2).toUpperCase()}</span><div><h2>{provider.name}</h2><code>{provider.code}</code></div></div><span className={`connection-badge connection-${provider.integrationStatus.toLowerCase()}`}>Integração: {integrationLabel}</span></div>
        <div className="provider-operational-row"><ProviderOperationControl providerId={provider.id} initialActive={provider.active} />{isHeartUnlocks && <span className={`gateway-state ${heartGateway.online ? "gateway-online" : "gateway-offline"}`}>Gateway: {heartGateway.online ? "ONLINE" : "OFFLINE"}</span>}</div>
        {isHeartUnlocks && <ProviderCatalogSync providerId={provider.id} />}
        <dl><div><dt>API Base</dt><dd>{provider.apiBaseUrl ?? "Não configurada"}</dd></div><div><dt>Produtos vinculados</dt><dd>{provider.productCount}</dd></div><div><dt>Pedidos externos</dt><dd>{provider.orderCount}</dd></div></dl>
        <div className="provider-links"><h3>Catálogo e vínculos</h3>{provider.products.length ? <div className="provider-table"><div className="provider-row provider-row-head"><span>Produto BancadaSoft</span><span>ID externo</span><span>Custo</span><span>Modo / operação</span></div>{provider.products.map((link) => <div className="provider-row" key={link.id}><span><b>{link.product?.name ?? "Não vinculado"}</b><small>{link.label ?? link.product?.slug ?? "Produto do fornecedor"}{providerMeta(link.metadata,"providerTime") ? ` · ${providerMeta(link.metadata,"providerTime")}` : ""}</small></span><code>{link.externalProductId}</code><span>{link.providerCostCents === null ? "Não informado" : money(link.providerCostCents, link.currency)}<small>{providerMeta(link.metadata,"providerType") || "Tipo não informado"}</small></span><span><b>{link.mode}</b><small>{link.product ? link.operational ? "Operacional" : "Fora do modo atual ou inativo" : "Disponível para vinculação"}</small></span></div>)}</div> : <p>Nenhum produto sincronizado.</p>}</div>
        {isHeartUnlocks && <div className="integration-note"><b>Catálogo do fornecedor</b><span>{provider.lastCatalogSync ? `Última sincronização bem-sucedida: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(provider.lastCatalogSync))}` : "Ainda não sincronizado"}</span></div>}
        {isHeartUnlocks && <div className="integration-note"><b>Gateway {heartGateway.configured ? "configurado" : "não configurado"}</b><span>{heartGateway.configured ? heartGateway.online ? "Gateway online" : "Gateway offline" : "Configure as variáveis do gateway para habilitar o health."}{heartGateway.checkedAt ? ` · Verificado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(heartGateway.checkedAt))}` : ""}</span></div>}
      </article>;
    })}</section>
    <h2 className="integration-section-title payment-title">Pagamentos</h2>
    <section className="integration-list"><AsaasDiagnostic initial={asaasDiagnostic} /></section>
  </>;
}
