import { prisma } from "@/lib/prisma";
import { handleResellerTicketRequest } from "@/lib/reseller-api";
import {
  adcleanResellerConfigured,
  configuredAdcleanResellerAdapter,
} from "@/lib/providers/adclean";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleResellerTicketRequest(request, {
    db: prisma,
    adapter: configuredAdcleanResellerAdapter,
    configured: () => adcleanResellerConfigured(),
  });
}
