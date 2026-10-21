import Link from "next/link";
import { formatBRL } from "@/lib/account-balance";
import { BALANCE_TOPUP_BLOCKED_MESSAGE, TOPUP_FREE_MAX_CENTS, TOPUP_MIN_CENTS } from "@/lib/commercial-pricing";
import { ledgerTypeLabel, signedBRL, type CustomerBalanceView } from "@/lib/customer-balance";

export const BALANCE_DISABLED_MESSAGE = "Saldo ainda não ativado. Ele é ativado automaticamente na sua primeira recarga.";
// Saldo não ativado e recarga bloqueada pelo Admin: não promete ativação.
export const BALANCE_UNAVAILABLE_MESSAGE = "Uso de saldo não habilitado para sua conta.";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function CustomerBalancePanel({ view }: { view: CustomerBalanceView }) {
  return (
    <div className="balance-panel">
      <section className="order-detail-card balance-summary">
        <h2>Saldo atual</h2>
        {view.enabled && view.balanceCents !== null ? (
          <strong className="balance-amount">{formatBRL(view.balanceCents)}</strong>
        ) : (
          <p className="notice balance-disabled">{view.topupBlocked ? BALANCE_UNAVAILABLE_MESSAGE : BALANCE_DISABLED_MESSAGE}</p>
        )}
      </section>

      <section className="order-detail-card balance-topup">
        <h2>Recarregar</h2>
        {view.topupBlocked ? (
          <p className="notice balance-disabled">{BALANCE_TOPUP_BLOCKED_MESSAGE}</p>
        ) : view.topupOptions.length ? (
          <div className="balance-topup-options">
            {view.topupOptions.map((option) => (
              <Link className="product-cta" href={option.href} key={option.key}>
                {option.freeAmount
                  ? `${option.label} — ${formatBRL(TOPUP_MIN_CENTS)} a ${formatBRL(TOPUP_FREE_MAX_CENTS)}`
                  : `${option.label} — ${formatBRL(option.priceCents)}`}
              </Link>
            ))}
          </div>
        ) : (
          <p>Nenhum pacote de recarga disponível no momento.</p>
        )}
      </section>

      <section className="order-history balance-ledger">
        <h2>Extrato</h2>
        {view.entries.length ? (
          <table>
            <thead>
              <tr><th>Data</th><th>Tipo</th><th>Valor</th><th>Saldo após</th></tr>
            </thead>
            <tbody>
              {view.entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{dateTime.format(entry.createdAt)}</td>
                  <td>{ledgerTypeLabel[entry.type] ?? entry.type}</td>
                  <td className={entry.amountCents < 0 ? "balance-debit" : "balance-credit"}>{signedBRL(entry.amountCents)}</td>
                  <td>{formatBRL(entry.balanceAfterCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Nenhuma movimentação ainda.</p>
        )}
      </section>
    </div>
  );
}
