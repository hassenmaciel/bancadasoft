import { isUnlockToolLicense, type LicenseSubject } from "./unlocktool-license";

// Rótulos específicos por marca para campos do fornecedor no checkout, para
// não confundir a conta da ferramenta com o e-mail de contato do comprador.
// Só apresentação: nunca altera key, type nem providerFieldName do campo. O
// critério é sempre marca (+ tipo, quando preciso) e key, nunca slug.
type FieldLike = { key: string; label: string; placeholder?: string };
export type ProviderFieldPresentation = {
  label: string;
  placeholder?: string;
  help?: string;
  autoComplete?: "off";
};
// placeholder e help opcionais: o que faltar cai no valor cru do campo.
type FieldCopy = { label: string; placeholder?: string; help?: string };

const brandIs = (name: string) => (product: LicenseSubject | null | undefined) =>
  product?.brand?.name === name;

const BRAND_FIELD_COPY: {
  applies: (product: LicenseSubject | null | undefined) => boolean;
  fields: Record<string, FieldCopy>;
}[] = [
  {
    // Só a licença: unlocktool-6h (aluguel) mantém os rótulos originais.
    applies: isUnlockToolLicense,
    fields: {
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
    },
  },
  {
    applies: brandIs("Phoenix ServiceTool"),
    fields: {
      email: {
        label: "E-mail da conta Phoenix",
        placeholder: "E-mail da sua conta Phoenix",
        help: "E-mail cadastrado na sua conta Phoenix ServiceTool. Não é o e-mail de contato.",
      },
    },
  },
  {
    applies: brandIs("Fenix Tool Pro"),
    fields: {
      username: {
        label: "Usuário do Fenix Tool Pro",
        placeholder: "Seu usuário do Fenix Tool Pro",
        help: "Você encontra o usuário dentro do próprio Fenix Tool Pro. Não é o e-mail de contato.",
      },
    },
  },
  {
    applies: brandIs("Moto M Tool"),
    fields: {
      hwid: {
        label: "HWID do Moto M Tool",
        placeholder: "Cole aqui o HWID",
        help: "Você encontra o HWID dentro do próprio Moto M Tool.",
      },
      email: {
        label: "E-mail da conta Moto M",
        placeholder: "E-mail da sua conta Moto M Tool",
        help: "Informe o e-mail da conta Moto M que será renovada. Não é o e-mail de contato da compra.",
      },
    },
  },
];

export function providerFieldPresentation(
  product: LicenseSubject | null | undefined,
  field: FieldLike,
): ProviderFieldPresentation {
  // A entrada precisa casar marca E key; sem isso, valores crus do campo.
  const copy = BRAND_FIELD_COPY.find(
    (entry) => entry.applies(product) && Object.hasOwn(entry.fields, field.key),
  )?.fields[field.key];
  if (!copy) return { label: field.label, placeholder: field.placeholder };
  return {
    label: copy.label,
    placeholder: copy.placeholder ?? field.placeholder,
    ...(copy.help ? { help: copy.help } : {}),
    autoComplete: "off",
  };
}
