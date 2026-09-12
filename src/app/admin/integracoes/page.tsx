import { heartUnlocksGatewayStatus, listAdminIntegrations } from "@/lib/admin-integrations";
import { publicAsaasDiagnostic, readAsaasRuntimeConfig } from "@/lib/payments/asaas-diagnostics";
import AsaasDiagnostic from "./asaas-diagnostic";
import ProviderModeControl from "./provider-mode-control";
import ProviderOperationControl from "./provider-operation-control";
import ProviderCatalogSync from "./provider-catalog-sync";
import ProviderProductCatalog from "./provider-product-catalog";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const heartGateway = await heartUnlocksGatewayStatus();
  const data = await listAdminIntegrations();
  const asaasDiagnostic = publicAsaasDiagnostic(readAsaasRuntimeConfig());
  return <>
    <header className="admin-heading"><div><small>PROVIDERS</small><h1>Integrações</h1><p>Fornecedores, contratos técnicos e vínculos do catálogo.</p></div></header>
    <ProviderModeControl initialMode={data.mode} />
    <h2 className="integration-section-title">Fornecedores técnicos</h2>
    <section className="integration-list">{data.providers.map((provider) => {
      const isHeartUnlocks = provider.code === "heartunlocks";
      const integrationLabel = provider.integrationStatus === "CONNECTED" ? "CONECTADO" : provider.integrationStatus === "NOT_CONNECTED" ? "NÃO CONECTADO" : "ERRO";
      return <article className="integration-card" key={provider.id}>
        <div className="integration-head"><div><span className="provider-mark">{provider.name.slice(0, 2).toUpperCase()}</span><div><h2>{provider.name}</h2><code>{provider.code}</code></div></div><span className={`connection-badge connection-${provider.integrationStatus.toLowerCase()}`}>Integração: {integrationLabel}</span></div>
        <div className="provider-operational-row"><ProviderOperationControl providerId={provider.id} initialActive={provider.active} />{isHeartUnlocks && <span className={`gateway-state ${heartGateway.online ? "gateway-online" : "gateway-offline"}`}>Gateway: {heartGateway.online ? "ONLINE" : "OFFLINE"}</span>}</div>
        {isHeartUnlocks && <ProviderCatalogSync providerId={provider.id} />}
        <dl><div><dt>API Base</dt><dd>{provider.apiBaseUrl ?? "Não configurada"}</dd></div><div><dt>Produtos sincronizados</dt><dd>{provider.productCount}</dd></div><div><dt>Pedidos externos</dt><dd>{provider.orderCount}</dd></div></dl>
        <ProviderProductCatalog products={provider.products} />
        {isHeartUnlocks && <div className="integration-note"><b>Catálogo do fornecedor</b><span>{provider.lastCatalogSync ? `Última sincronização: ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(provider.lastCatalogSync))}` : "Ainda não sincronizado"}</span></div>}
        {isHeartUnlocks && <div className="integration-note"><b>Gateway {heartGateway.configured ? "configurado" : "não configurado"}</b><span>{heartGateway.configured ? heartGateway.online ? "Gateway online" : "Gateway offline" : "Configure o gateway para habilitar o health."}</span></div>}
      </article>;
    })}</section>
    <h2 className="integration-section-title payment-title">Pagamentos</h2>
    <section className="integration-list"><AsaasDiagnostic initial={asaasDiagnostic} /></section>
  </>;
}
