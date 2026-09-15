export const maskEmail = (email: string) => {
  const [local, domain] = email.split("@");
  return local && domain ? `${local.slice(0, 2)}***@${domain}` : "***";
};

export const maskCpf = (cpfCnpj: string | null | undefined) =>
  cpfCnpj ? `***.***.***-${cpfCnpj.slice(-2)}` : null;

export const maskWhatsapp = (whatsapp: string | null | undefined) =>
  whatsapp && whatsapp.length >= 4 ? `•••••-${whatsapp.slice(-4)}` : null;
