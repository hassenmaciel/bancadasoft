"use client";

import { useState } from "react";
import type { AsaasDiagnosticDTO } from "@/lib/payments/asaas-diagnostics";

const label = (value: string) => value.replaceAll("_", " ").toUpperCase();
const reasons:Record<NonNullable<AsaasDiagnosticDTO["reason"]>,string>={PROVIDER_INVALID:"PAYMENT_PROVIDER inválido",ENVIRONMENT_INVALID:"ASAAS_ENV inválido",BASE_URL_INVALID:"ASAAS_BASE_URL inválida",API_KEY_MISSING:"ASAAS_API_KEY ausente",WEBHOOK_TOKEN_MISSING:"ASAAS_WEBHOOK_TOKEN ausente",AUTHENTICATION_FAILED:"Credencial rejeitada pelo Asaas",HTTP_ERROR:"Asaas retornou erro HTTP",TIMEOUT:"Tempo limite ao conectar ao Asaas",NETWORK_ERROR:"Falha de rede antes da resposta HTTP"};

export default function AsaasDiagnostic({ initial }: { initial: AsaasDiagnosticDTO }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function testConnection() {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response=await fetch("/api/admin/payments/asaas/test-connection",{method:"POST"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"Não foi possível testar a conexão.");
      setState(result.data);
    } catch(cause) { setError(cause instanceof Error?cause.message:"Não foi possível testar a conexão."); }
    finally { setPending(false); }
  }
  return <article className="integration-card payment-integration">
    <div className="integration-head"><div><span className="provider-mark">AS</span><div><h2>Asaas</h2><code>Diagnóstico somente leitura</code></div></div><span className={`connection-badge ${state.authentication==="ONLINE"?"connection-connected":state.authentication==="ERROR"?"connection-error":""}`}>{state.authentication === "NOT_TESTED" ? "NÃO TESTADA" : state.authentication}</span></div>
    <dl><div><dt>Payment Provider</dt><dd>{label(state.provider)}</dd></div><div><dt>Ambiente</dt><dd>{label(state.environment)}</dd></div><div><dt>Base URL</dt><dd>{state.baseUrl}</dd></div><div><dt>API Key configurada</dt><dd>{state.apiKeyConfigured?"SIM":"NÃO"}</dd></div><div><dt>Webhook token</dt><dd>{state.webhookTokenConfigured?"SIM":"NÃO"}</dd></div><div><dt>HTTP</dt><dd>{state.httpStatus??"—"}</dd></div><div><dt>Última verificação</dt><dd>{state.checkedAt?new Date(state.checkedAt).toLocaleString("pt-BR"):"Nunca"}</dd></div></dl>
    {state.configurationError&&<p className="asaas-config-error">ERRO DE CONFIGURAÇÃO: revise provider, ambiente, URL e credenciais.</p>}
    {state.reason&&<p className="asaas-diagnostic-reason">Motivo: {reasons[state.reason]}</p>}
    <div className="diagnostic-actions"><button type="button" disabled={pending} onClick={testConnection}>{pending?"Testando...":"Testar conexão Asaas"}</button>{error&&<small role="alert">{error}</small>}</div>
    <div className="integration-note"><b>Consulta segura</b><span>Executa somente GET /finance/balance. O saldo e as credenciais nunca são retornados à interface.</span></div>
  </article>;
}
