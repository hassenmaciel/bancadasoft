import { z } from "zod";
import { isValidCpf, isValidWhatsapp } from "./checkout-validation";
export const checkoutSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  // name/email/whatsapp/cpfCnpj são obrigatórios para guest, mas opcionais
  // para cliente autenticado com cadastro completo (PARTE 1/3/4) — a conta
  // autenticada é a fonte principal desses dados; ver resolveAuthenticated
  // CheckoutIdentity em commerce.ts, que nunca confia nesses campos vindos
  // do client para sobrescrever nome/e-mail já cadastrados.
  name: z.string().trim().min(2).max(100).optional(),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase())
    .optional(),
  whatsapp: z.string().min(10).max(25).refine(isValidWhatsapp).optional(),
  cpfCnpj: z.string().refine(isValidCpf).optional(),
  deliveryAccessToken: z.string().min(32).max(200),
  providerFields: z.record(z.string(), z.string().max(500)).optional().default({}),
});
