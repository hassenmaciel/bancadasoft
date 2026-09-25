import Link from "next/link";
import { formatBRL } from "@/lib/account-balance";
import { ledgerTypeLabel, signedBRL, type CustomerBalanceView } from "@/lib/customer-balance";

export const BALANCE_DISABLED_MESSAGE = "Uso de saldo ainda não habilitado para sua conta. Fale com o suporte.";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function CustomerBalancePanel({ view }: { view: CustomerBalanceView }) {
  return (
    <div className="balance-panel">
      <section className="order-detail-card balance-summary">
        <h2>Saldo atual</h2>
        {view.enabled && view.balanceCents !== null ? (
          <strong className="balance-amount">{formatBRL(view.balanceCents)}</strong>
        ) : (
          <p className="notice balance-disabled">{BALANCE_DISABLED_MESSAGE}</p>
        )}
      </section>

      {view.enabled && (
        <section className="order-detail-card balance-topup">
          <h2>Recarregar</h2>
          {view.topupOptions.length ? (
            <div className="balance-topup-options">
              {view.topupOptions.map((option) => (
                <Link className="product-cta" href={option.href} key={option.key}>
                  {option.label} — {formatBRL(option.priceCents)}
                </Link>
              ))}
            </div>
          ) : (
            <p>Nenhum pacote de recarga disponível no momento.</p>
          )}
        </section>
      )}

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
