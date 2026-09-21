import type { DeliveryDTO } from "./dto";

// Escopo único da apresentação específica da licença UnlockTool (Active/Renew,
// espera de 1 a 24 h, sem código devolvido ao cliente). TODA mudança de texto
// ou de tela dessa licença passa por este helper: qualquer outro produto
// (unlocktool-6h, AMT, CF, DFT, TSM, SamsungTool, AdClean...) precisa continuar
// com o comportamento anterior.
export type LicenseSubject = {
  brand?: { name?: string | null } | null;
  type?: string | null;
};

export const isUnlockToolLicense = (product: LicenseSubject | null | undefined) =>
  product?.brand?.name === "UnlockTool" && product?.type === "LICENSE";

type FieldLike = { key: string; label: string; placeholder?: string };
export type ProviderFieldPresentation = {
  label: string;
  placeholder?: string;
  help?: string;
  autoComplete?: "off";
};

// Só apresentação: nunca altera key nem providerFieldName do campo.
const UNLOCKTOOL_FIELD_COPY: Record<string, Required<Omit<ProviderFieldPresentation, "autoComplete">>> = {
  email: {
    label: "E-mail da conta UnlockTool",
    placeholder: "E-mail da sua conta UnlockTool",
    help: "E-mail cadastrado na sua conta UnlockTool. Não é o e-mail de contato.",
  },
  username: {
    label: "Usuário da conta UnlockTool",
    placeholder: "Usuário da sua conta UnlockTool",
    help: "Usuário (login) da sua conta UnlockTool, onde a licença será ativada.",
  },
};

export function providerFieldPresentation(
  licenseMode: boolean,
  field: FieldLike,
): ProviderFieldPresentation {
  const copy = licenseMode ? UNLOCKTOOL_FIELD_COPY[field.key] : undefined;
  if (!copy) return { label: field.label, placeholder: field.placeholder };
  return { ...copy, autoComplete: "off" };
}

export const LICENSE_ACCOUNT_CONFIRMATION =
  "Conferi que o usuário da conta UnlockTool está correto. A licença é ativada na conta informada e a ativação não pode ser desfeita.";

// Gerar PIX fica bloqueado até marcar a conferência (apenas no cliente, sem
// persistir e sem enviar à API). Para os demais produtos o resultado é o de sempre.
export const canSubmitCheckout = (state: {
  licenseMode: boolean;
  confirmed: boolean;
  submitting: boolean;
}) => !state.submitting && (!state.licenseMode || state.confirmed);

export const summaryBadge = (licenseMode: boolean, type: string) =>
  licenseMode ? "LICENÇA" : type === "RENTAL" ? "ALUGUEL" : "FERRAMENTA";

export function licenseActivationMessage(deliveryEstimate: string | null | undefined) {
  const estimate = deliveryEstimate?.trim();
  return `Pagamento confirmado. Sua licença está sendo ativada.${estimate ? ` Prazo: ${estimate}.` : ""} Você receberá por e-mail e pode fechar esta página.`;
}

export const LICENSE_DELIVERY_TITLE = "Licença ativada";
export const LICENSE_DELIVERY_TEXT =
  "A licença foi ativada na conta UnlockTool informada no pedido.";

// Retorno do fornecedor (ex.: "Success"): texto informativo, nunca credencial.
// Vazio quando o provider não devolveu nada legível.
export function licenseProviderReturn(
  delivery: Pick<DeliveryDTO, "deliveryFields" | "credential">,
) {
  const fromFields = (delivery.deliveryFields ?? [])
    .map((field) =>
      field.key === "license" || field.key === "text" || field.key === "value"
        ? field.value
        : `${field.label}: ${field.value}`,
    )
    .map((value) => value.trim())
    .filter(Boolean);
  if (fromFields.length) return fromFields.join(" · ");
  return delivery.credential?.trim() || null;
}

// Usuário da conta UnlockTool informado no checkout. providerFields guarda o
// valor sob providerFieldName ("Username"); aceita também a key em minúsculas.
export function licenseAccountUsername(providerFields: unknown) {
  if (!providerFields || typeof providerFields !== "object" || Array.isArray(providerFields))
    return null;
  const record = providerFields as Record<string, unknown>;
  const value = record.Username ?? record.username;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

// Mensagem de licença em ativação: do pagamento confirmado até DELIVERED, nas
// duas fases do polling. FAILED com pagamento PAID mantém o comportamento
// anterior (prometer e-mail seria falso).
export const showLicenseActivationMessage = (state: {
  licenseMode: boolean;
  paid: boolean;
  orderStatus: string;
}) => state.licenseMode && state.paid && state.orderStatus !== "FAILED";

// Callback do HeartUnlocks com status "success" e sem retorno textual utilizável:
// para a licença UnlockTool a ativação na conta é a própria entrega. O gate usa
// os mesmos critérios da apresentação (marca UnlockTool + tipo LICENSE, sem
// depender de slug) e exige também que o ProviderProduct escolhido seja de
// entrega LICENSE, para nunca dar como entregue um produto de credencial.
export const acceptsLicenseSuccessWithoutText = (
  product: LicenseSubject | null | undefined,
  expectedDeliveryType: string | null | undefined,
) => isUnlockToolLicense(product) && expectedDeliveryType === "LICENSE";

export const LICENSE_SUCCESS_INSTRUCTIONS =
  "A ativação foi confirmada pelo fornecedor, sem retorno textual.";
export const LICENSE_SUCCESS_MANUAL_REVIEW_NOTE =
  "REVISÃO MANUAL: o fornecedor confirmou sucesso sem retorno textual. Conferir a licença no painel do fornecedor.";

// Delivery mínimo do tipo LICENSE: sem credential e sem campos.
export const licenseConfirmationDelivery = (product: { name: string }) => ({
  kind: "provider-delivery",
  deliveryType: "LICENSE" as const,
  title: product.name,
  instructions: LICENSE_SUCCESS_INSTRUCTIONS,
});
