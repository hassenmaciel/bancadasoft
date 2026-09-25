import { z } from "zod";

const slug = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const optionalUrl = z.union([z.string().url(), z.literal("")]).transform((value) => value || null);
export const brandInputSchema = z.object({ name: z.string().trim().min(1).max(80), slug, imageUrl: optionalUrl.nullable().optional(), active: z.boolean().default(true) });
export const adminUserInputSchema = z.object({name:z.string().trim().min(2).max(100),email:z.string().trim().toLowerCase().email(),password:z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/),role:z.enum(["CUSTOMER","USER","ADMIN","RESELLER"]).default("USER"),customerTier:z.enum(["NORMAL","PREMIUM"]).default("NORMAL")});
export const adminUserUpdateSchema = z.object({name:z.string().trim().min(2).max(100).optional(),role:z.enum(["CUSTOMER","USER","ADMIN","RESELLER"]).optional(),customerTier:z.enum(["NORMAL","PREMIUM"]).optional(),active:z.boolean().optional()}).refine(v=>Object.keys(v).length>0);
export const settingsInputSchema = z.object({ businessName: z.string().trim().min(1).max(100), slogan: z.string().trim().max(160), domain: z.string().trim().max(160), supportWhatsapp: z.string().trim().max(40).nullable().optional(), supportEmail: z.union([z.string().email(), z.literal(""), z.null()]).optional().transform((v) => v || null), supportText: z.string().trim().max(300).nullable().optional(), maintenanceEnabled: z.boolean(), maintenanceMessage: z.string().trim().min(1).max(300) });
export const roleInputSchema = z.object({ role: z.enum(["CUSTOMER", "USER", "ADMIN", "RESELLER"]) });
