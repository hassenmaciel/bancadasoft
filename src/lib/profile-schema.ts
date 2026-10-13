import { z } from "zod";
import { isValidWhatsapp } from "./checkout-validation";

export const profileSchema = z.object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
    whatsapp: z.string().min(10).max(25).refine(isValidWhatsapp),
});

export type ProfileUpdateInput = z.infer<typeof profileSchema>;