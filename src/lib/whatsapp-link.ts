import { digitsOnly, isValidWhatsapp } from "./checkout-validation";

// Link wa.me a partir do WhatsApp gravado (normalizado ou com máscara antiga do
// perfil). 12/13 dígitos com 55 já têm DDI; 10/11 recebem o 55 — inclusive DDD 55.
// Ausente, outro tamanho ou inválido → null (o painel desabilita o botão).
export function whatsappLink(whatsapp: string | null | undefined): string | null {
  if (!whatsapp) return null;
  const digits = digitsOnly(whatsapp);
  let phone: string;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) phone = digits;
  else if (digits.length === 10 || digits.length === 11) phone = `55${digits}`;
  else return null;
  return isValidWhatsapp(phone) ? `https://wa.me/${phone}` : null;
}
