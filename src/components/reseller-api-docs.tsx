import { ADCLEAN_TICKET_DURATION_HOURS } from "@/lib/providers/adclean-contract";
import { RESELLER_RATE_LIMIT } from "@/lib/reseller-api";

export const RESELLER_API_ENDPOINT = "https://www.bancadasoft.com.br/api/reseller/v1/tickets";

// Valores fictícios, só para ilustrar o formato. Nunca uma chave real.
const requestExample = `curl -X POST ${RESELLER_API_ENDPOINT} \\
  -H "Authorization: Bearer SUA_CHAVE_DE_API" \\
  -H "Content-Type: application/json" \\
  -d '{ "external_reference": "pedido-10293" }'`;

const successExample = `HTTP 200
{
  "ok": true,
  "status": "COMPLETED",
  "replay": false,
  "external_reference": "pedido-10293",
  "ticket": { "code": "XXXX-XXXX-XXXX", "duration_hours": ${ADCLEAN_TICKET_DURATION_HOURS} },
  "charged_cents": 2500,
  "balance_cents": 4500
}`;

const processingExample = `HTTP 202
{
  "ok": true,
  "status": "PROCESSING",
  "external_reference": "pedido-10293",
  "charged_cents": 2500,
  "message": "Emissão em confirmação. Reenvie a mesma external_reference para consultar o resultado."
}`;

const errorExample = `{ "ok": false, "code": "INSUFFICIENT_BALANCE", "error": "Saldo insuficiente." }`;

export const RESELLER_API_ERRORS: { status: number; code: string; meaning: string; action: string }[] = [
  { status: 400, code: "INVALID_BODY", meaning: "Corpo inválido ou external_reference ausente/fora do formato.", action: "Corrija o corpo: 1 a 100 caracteres, só letras, números, ponto, hífen ou sublinhado. Não repita sem corrigir." },
  { status: 401, code: "INVALID_API_KEY", meaning: "Chave ausente, inválida, desativada ou revogada.", action: "Confira o header Authorization. Se a chave foi revogada, peça uma nova ao suporte." },
  { status: 402, code: "INSUFFICIENT_BALANCE", meaning: "Saldo pré-pago insuficiente. Nada foi debitado.", action: "Recarregue em Meu saldo e reenvie com a mesma external_reference." },
  { status: 403, code: "RESELLER_ROLE_REQUIRED / BALANCE_NOT_ENABLED", meaning: "Conta sem permissão de revenda ou sem saldo habilitado.", action: "Fale com o suporte para liberar a conta." },
  { status: 409, code: "PRODUCT_NOT_AVAILABLE_FOR_RESALE", meaning: "Produto temporariamente sem preço de revenda.", action: "Tente mais tarde ou fale com o suporte." },
  { status: 429, code: "RATE_LIMITED", meaning: `Mais de ${RESELLER_RATE_LIMIT.maxPurchases} compras novas por minuto na conta.`, action: "Aguarde um minuto e reenvie. Reenvios da mesma external_reference não contam no limite." },
  { status: 502, code: "TICKET_FAILED_REFUNDED", meaning: "A emissão falhou e o valor voltou para o saldo.", action: "Use uma NOVA external_reference para tentar de novo." },
  { status: 503, code: "RESELLER_INTEGRATION_NOT_CONFIGURED", meaning: "Integração temporariamente indisponível. Nada foi debitado.", action: "Tente de novo mais tarde com a mesma external_reference." },
];

export default function ResellerApiDocs() {
  return (
    <div className="api-docs">
      <section>
        <h2>Endpoint</h2>
        <p><code>POST {RESELLER_API_ENDPOINT}</code></p>
        <p>Cada chamada compra um ticket AdClean ({ADCLEAN_TICKET_DURATION_HOURS} horas) e debita o preço de revenda do seu saldo pré-pago.</p>
      </section>

      <section>
        <h2>Autenticação</h2>
        <p>Envie os headers abaixo em toda requisição. A chave de API é entregue pelo suporte BancadaSoft.</p>
        <pre><code>{"Authorization: Bearer <sua chave>\nContent-Type: application/json"}</code></pre>
      </section>

      <section>
        <h2>Corpo da requisição</h2>
        <pre><code>{`{ "external_reference": "pedido-10293" }`}</code></pre>
        <p><code>external_reference</code> é <b>obrigatório</b>: um identificador único por venda no seu sistema (1 a 100 caracteres: letras, números, ponto, hífen ou sublinhado).</p>
      </section>

      <section>
        <h2>Exemplo de requisição</h2>
        <pre><code>{requestExample}</code></pre>
      </section>

      <section>
        <h2>Resposta de sucesso</h2>
        <pre><code>{successExample}</code></pre>
        <p><code>ticket.code</code> é o código a entregar ao seu cliente. <code>charged_cents</code> é o valor debitado e <code>balance_cents</code> o saldo restante, ambos em centavos. <code>replay: true</code> indica que a resposta é de uma compra já feita com a mesma <code>external_reference</code>.</p>
        <p>Se a emissão ainda estiver em confirmação, a resposta é <code>202</code> com <code>status: &quot;PROCESSING&quot;</code>. O valor já foi debitado: reenvie a mesma <code>external_reference</code> em alguns segundos para obter o ticket.</p>
        <pre><code>{processingExample}</code></pre>
      </section>

      <section>
        <h2>Erros</h2>
        <p>Toda resposta de erro traz <code>ok: false</code>, um <code>code</code> estável e uma mensagem em <code>error</code>:</p>
        <pre><code>{errorExample}</code></pre>
        <div className="api-docs-table">
          <table>
            <thead><tr><th>Status</th><th>Código</th><th>Significado</th><th>O que fazer</th></tr></thead>
            <tbody>
              {RESELLER_API_ERRORS.map((row) => (
                <tr key={row.status}><td>{row.status}</td><td><code>{row.code}</code></td><td>{row.meaning}</td><td>{row.action}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Boas práticas</h2>
        <ul>
          <li><b>Reenvio seguro:</b> em timeout, erro de rede ou <code>PROCESSING</code>, reenvie com a <b>mesma</b> <code>external_reference</code>. Ela nunca gera um segundo débito nem um segundo ticket: a API devolve o resultado da compra original.</li>
          <li><b>Uma referência por venda:</b> gere a <code>external_reference</code> a partir do ID do pedido no seu sistema. Só troque de referência depois de um <code>502 TICKET_FAILED_REFUNDED</code>.</li>
          <li><b>Chave só no servidor:</b> nunca coloque a chave em aplicativo, navegador, JavaScript de frontend ou repositório público. Chame a API a partir do seu backend. Se a chave vazar, peça a revogação ao suporte imediatamente.</li>
          <li><b>Saldo insuficiente:</b> trate o <code>402</code> avisando que a venda está pendente, recarregue o saldo e reenvie com a mesma referência. Acompanhe o saldo pelo campo <code>balance_cents</code> para recarregar antes de zerar.</li>
          <li><b>Limite de uso:</b> no máximo {RESELLER_RATE_LIMIT.maxPurchases} compras novas por minuto por conta. Em <code>429</code>, espere e tente de novo.</li>
        </ul>
      </section>
    </div>
  );
}
