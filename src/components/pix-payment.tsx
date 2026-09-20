"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { PaymentDTO } from "@/lib/dto";
import { PIX_ALERT_MS, formatPixCountdown, pixRemainingMs } from "@/lib/payments/pix-expiry";

type Props = {
  payment: PaymentDTO;
  amountLabel: string;
  copied: boolean;
  onCopy: () => void;
  onRenew: () => void;
  renewing: boolean;
  renewError: string;
};

// Renderize com key={payment.serverTime}: cada resposta do servidor remonta o
// componente e reancora o contador no horário do servidor (nunca no relógio do
// cliente), então um relógio adiantado/atrasado não prejudica quem paga no fim.
export default function PixPayment({ payment, amountLabel, copied, onCopy, onRenew, renewing, renewError }: Props) {
  const [receivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(receivedAt);
  const serverExpired = payment.status === "EXPIRED";
  useEffect(() => {
    if (serverExpired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [serverExpired]);

  const remaining = serverExpired ? 0 : pixRemainingMs(payment.expirationDate, payment.serverTime, receivedAt, now);
  if (remaining <= 0)
    return (
      <>
        <span className="checkout-kicker">Pagamento via PIX</span>
        <h2 id="checkout-title">PIX expirado</h2>
        <p className="checkout-guidance">
          O tempo para pagar este PIX acabou. Não pague o código antigo; gere um novo PIX para continuar.
        </p>
        <button type="button" className="copy-pix" onClick={onRenew} disabled={renewing}>
          {renewing ? "Gerando..." : "Gerar novo PIX"}
        </button>
        {renewError && <small role="alert">{renewError}</small>}
        <p className="checkout-recovery">
          Se você já pagou, aguarde: confirmaremos o pagamento automaticamente.
        </p>
      </>
    );

  const alert = remaining <= PIX_ALERT_MS;
  return (
    <>
      <span className="checkout-kicker">Pagamento via PIX</span>
      <h2 id="checkout-title">Aguardando pagamento</h2>
      <div className="pix-status">
        <span />
        Aguardando confirmação do pagamento
      </div>
      <p className={alert ? "pix-countdown pix-countdown-alert" : "pix-countdown"} role="timer">
        Expira em <strong>{formatPixCountdown(remaining)}</strong>
      </p>
      <div className="pix-layout">
        <div className="qr-frame">
          {payment.qrCodeImage && (
            <Image src={payment.qrCodeImage} width={210} height={210} unoptimized alt="QR Code PIX do pedido" />
          )}
        </div>
        <div className="pix-details">
          <small>VALOR</small>
          <strong>{amountLabel}</strong>
          <label>
            PIX COPIA E COLA
            <code>{payment.pixPayload}</code>
          </label>
          <button type="button" className="copy-pix" onClick={onCopy}>
            {copied ? "COPIADO ✓" : "COPIAR PIX"}
          </button>
        </div>
      </div>
      <p className="checkout-guidance">
        Após realizar o pagamento, aguarde nesta página. Seu acesso será liberado automaticamente.
      </p>
      <p className="checkout-warning">Não feche esta janela até seu login ser exibido.</p>
      <p className="checkout-recovery">
        Se fechar por engano, você poderá recuperar o acesso pelo link enviado ao seu e-mail.
      </p>
    </>
  );
}
