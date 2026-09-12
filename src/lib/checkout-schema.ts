import { z } from "zod";
import { isValidCpf, isValidWhatsapp } from "./checkout-validation";
export const checkoutSchema = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  whatsapp: z.string().min(10).max(25).refine(isValidWhatsapp),
  cpfCnpj: z.string().refine(isValidCpf),
  deliveryAccessToken: z.string().min(32).max(200),
});
