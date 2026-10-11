import { isUnlockToolLicense, type LicenseSubject } from "./unlocktool-license";

// Rótulos específicos por marca para campos do fornecedor no checkout, para
// não confundir a conta da ferramenta com o e-mail de contato do comprador.
// Só apresentação: nunca altera key nem providerFieldName do campo. O critério
// é sempre marca (+ tipo, quando preciso), nunca slug.
type FieldLike = { key: string; label: string; placeholder?: string };
export type ProviderFieldPresentation = {
  label: string;
  placeholder?: string;
  help?: string;
  autoComplete?: "off";
};
type FieldCopy = Required<Omit<ProviderFieldPresentation, "autoComplete">>;

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
    applies: (product) => product?.brand?.name === "Phoenix ServiceTool",
    fields: {
      email: {
        label: "E-mail da conta Phoenix",
        placeholder: "E-mail da sua conta Phoenix",
        help: "E-mail cadastrado na sua conta Phoenix ServiceTool. Não é o e-mail de contato.",
      },
    },
  },
];

export function providerFieldPresentation(
  product: LicenseSubject | null | undefined,
  field: FieldLike,
): ProviderFieldPresentation {
  const copy = BRAND_FIELD_COPY.find((entry) => entry.applies(product))?.fields[field.key];
  if (!copy) return { label: field.label, placeholder: field.placeholder };
  return { ...copy, autoComplete: "off" };
}
