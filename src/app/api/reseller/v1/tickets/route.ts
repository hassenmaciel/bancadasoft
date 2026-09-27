import { prisma } from "@/lib/prisma";
import { adcleanLicenseResellerFulfiller, handleResellerTicketRequest } from "@/lib/reseller-api";
import {
  adcleanResellerConfigured,
  configuredAdcleanResellerAdapter,
} from "@/lib/providers/adclean";
import {
  ADCLEAN_LICENSE_CODE,
  adcleanLicenseConfigured,
  configuredAdcleanLicenseAdapter,
} from "@/lib/providers/adclean-license";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleResellerTicketRequest(request, {
    db: prisma,
    adapter: configuredAdcleanResellerAdapter,
    configured: () => adcleanResellerConfigured(),
    fulfillers: {
      [ADCLEAN_LICENSE_CODE]: adcleanLicenseResellerFulfiller({
        configured: () => adcleanLicenseConfigured(),
        adapter: configuredAdcleanLicenseAdapter,
      }),
    },
  });
}
