import { heartUnlocksGatewayStatus, listAdminIntegrations } from "@/lib/admin-integrations";
import ProviderOperationControl from "./provider-operation-control";

export const dynamic = "force-dynamic";
const money = (value: number, currency: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);

export default async function IntegrationsPage() {
  const heartGateway = await heartUnlocksGatewayStatus();
  const providers = await listAdminIntegrations();
  const asaasConfigured = process.env.ASAAS_ENV === "sandbox" && Boolean(process.env.ASAAS_API_KEY);
  return <>
    <header className="admin-heading"><div><small>PROVIDERS</small><h1>Integrações</h1><p>Fornecedores e vínculos técnicos do catálogo.</p></div></header>
    <h2 className="integration-section-title">Fornecedores técnicos</h2>
    <section className="integration-list">{providers.map((provider) => {
      const isHeartUnlocks = provider.code === "heartunlocks";
      const integrationLabel = provider.integrationStatus === "CONNECTED" ? "CONECTADO" : provider.integrationStatus === "NOT_CONNECTED" ? "NÃO CONECTADO" : "ERRO";
      return <article className="integration-card" key={provider.id}>
        <div className="integration-head"><div><span className="provider-mark">{provider.name.slice(0, 2).toUpperCase()}</span><div><h2>{provider.name}</h2><code>{provider.code}</code></div></div><span className={`connection-badge connection-${provider.integrationStatus.toLowerCase()}`}>Integração: {integrationLabel}</span></div>
        <div className="provider-operational-row"><ProviderOperationControl providerId={provider.id} initialActive={provider.active} />{isHeartUnlocks && <span className={`gateway-state ${heartGateway.online ? "gateway-online" : "gateway-offline"}`}>Gateway: {heartGateway.online ? "ONLINE" : "OFFLINE"}</span>}</div>
        <dl><div><dt>API Base</dt><dd>{provider.apiBaseUrl ?? "Não configurada"}</dd></div><div><dt>Produtos vinculados</dt><dd>{provider.productCount}</dd></div><div><dt>Pedidos externos</dt><dd>{provider.orderCount}</dd></div></dl>
        <div className="provider-links"><h3>Vínculos de produtos</h3>{provider.products.length ? <div className="provider-table"><div className="provider-row provider-row-head"><span>Produto BancadaSoft</span><span>ID externo</span><span>Custo</span><span>Estado</span></div>{provider.products.map((link) => <div className="provider-row" key={link.id}><span><b>{link.product.name}</b><small>{link.label ?? link.product.slug}</small></span><code>{link.externalProductId}</code><span>{link.providerCostCents === null ? "Não informado" : money(link.providerCostCents, link.currency)}</span><span>{link.active ? "Ativo" : "Inativo"}</span></div>)}</div> : <p>Nenhum produto vinculado. A sincronização permanece desativada.</p>}</div>
        {isHeartUnlocks && <div className="integration-note"><b>Gateway {heartGateway.configured ? "configurado" : "não configurado"}</b><span>{heartGateway.configured ? heartGateway.online ? "Gateway online" : "Gateway offline" : "Configure as variáveis do gateway para habilitar o health."}{heartGateway.checkedAt ? ` · Verificado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(heartGateway.checkedAt))}` : ""}</span></div>}
      </article>;
    })}</section>
    <h2 className="integration-section-title payment-title">Pagamentos</h2>
    <section className="integration-list"><article className="integration-card payment-integration"><div className="integration-head"><div><span className="provider-mark">AS</span><div><h2>Asaas</h2><code>asaas</code></div></div><span className="connection-badge">{asaasConfigured ? "SANDBOX CONFIGURADO" : "NÃO CONFIGURADO"}</span></div><dl><div><dt>Tipo</dt><dd>PIX</dd></div><div><dt>API Base</dt><dd>https://api-sandbox.asaas.com/v3</dd></div><div><dt>Ambiente</dt><dd>Sandbox</dd></div><div><dt>Credenciais</dt><dd>{asaasConfigured ? "Configuradas" : "Não configuradas"}</dd></div></dl><div className="integration-note"><b>Ambiente seguro de testes</b><span>A chave nunca é exibida. Nenhuma operação de produção é permitida por esta integração.</span></div></article></section>
  </>;
}
