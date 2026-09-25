// Conversão centavos <-> campo de formulário para preços opcionais do Admin
// (mesma regra do Preço Premium): campo vazio = null; valor em reais é
// arredondado para centavos.
export const optionalCentsToInput = (cents: number | null | undefined) =>
  cents == null ? "" : String(cents / 100);

export const optionalInputToCents = (value: string) =>
  value === "" ? null : Math.round(Number(value) * 100);
