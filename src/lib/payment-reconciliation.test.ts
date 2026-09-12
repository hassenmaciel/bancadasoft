import { PaymentStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { reconcilePendingPixPayment } from "./payment-reconciliation";
import type { PaymentProvider } from "./payments/types";

const payment = {
  id: "payment-local",
  orderId: "order-local",
  provider: "asaas",
  status: PaymentStatus.PENDING,
  externalPaymentId: "pay_existing",
  pixCode: "",
};

const provider = (getPixPaymentDetails: PaymentProvider["getPixPaymentDetails"]) =>
  ({ code: "asaas", getPixPaymentDetails }) as PaymentProvider;

describe("reconciliação de PIX pendente", () => {
  it("recupera e persiste a mesma cobrança sem criar outra", async () => {
    const getPixPaymentDetails = vi.fn(async () => ({ externalPaymentId: "pay_existing", pixCode: "same-pix", qrCode: "same-qr", expiresAt: new Date("2026-09-15T23:59:59Z") }));
    const persist = vi.fn(async () => undefined);
    const result = await reconcilePendingPixPayment("order-local", {
      findPayment: vi.fn(async () => payment),
      providerFor: vi.fn(() => provider(getPixPaymentDetails)),
      persist,
    });
    expect(result.status).toBe("RECONCILED");
    expect(getPixPaymentDetails).toHaveBeenCalledWith("pay_existing");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reload com PIX existente não consulta nem cria cobrança", async () => {
    const providerFor = vi.fn();
    const persist = vi.fn();
    const result = await reconcilePendingPixPayment("order-local", {
      findPayment: vi.fn(async () => ({ ...payment, pixCode: "existing-pix" })),
      providerFor,
      persist,
    });
    expect(result.status).toBe("ALREADY_AVAILABLE");
    expect(providerFor).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("não tenta recuperar Payment sem referência externa válida", async () => {
    const providerFor = vi.fn();
    const result = await reconcilePendingPixPayment("order-local", {
      findPayment: vi.fn(async () => ({ ...payment, externalPaymentId: null })),
      providerFor,
      persist: vi.fn(),
    });
    expect(result.status).toBe("NOT_RECOVERABLE");
    expect(providerFor).not.toHaveBeenCalled();
  });
});
