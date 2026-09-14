import { z } from "zod";
import {
  digitsOnly,
  isValidCpf,
  isValidWhatsapp,
  normalizeWhatsapp,
} from "./checkout-validation";

export const registrationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email(),
    whatsapp: z
      .string()
      .trim()
      .refine(isValidWhatsapp, "Informe um WhatsApp válido.")
      .transform(normalizeWhatsapp),
    cpfCnpj: z
      .string()
      .trim()
      .refine(isValidCpf, "Informe um CPF válido.")
      .transform(digitsOnly),
    password: z
      .string()
      .min(12)
      .max(128)
      .regex(/[a-z]/)
      .regex(/[A-Z]/)
      .regex(/[0-9]/)
      .regex(/[^A-Za-z0-9]/),
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "As senhas não coincidem.",
    path: ["passwordConfirmation"],
  });

export type PublicRegistration = z.infer<typeof registrationSchema>;

export function publicUserCreateData(
  registration: PublicRegistration,
  passwordHash: string,
) {
  return {
    name: registration.name,
    email: registration.email,
    whatsapp: registration.whatsapp,
    cpfCnpj: registration.cpfCnpj,
    passwordHash,
    role: "USER" as const,
    customerTier: "NORMAL" as const,
  };
}
