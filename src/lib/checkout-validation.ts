export const digitsOnly = (value: string) => value.replace(/\D/g, "");

export function isValidCpf(value: string) {
  const cpf = digitsOnly(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index++)
      sum += Number(cpf[index]) * (length + 1 - index);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function normalizeWhatsapp(value: string) {
  const phone = digitsOnly(value);
  return phone.startsWith("55") ? phone : `55${phone}`;
}
export const isValidWhatsapp = (value: string) => {
  const phone = normalizeWhatsapp(value);
  return /^55\d{10,11}$/.test(phone) && !/^(\d)\1+$/.test(phone.slice(2));
};
