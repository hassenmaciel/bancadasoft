import {
  DeliveryNotificationStatus,
  OrderStatus,
  Prisma,
} from "@prisma/client";
import { Resend } from "resend";
import { prisma } from "../prisma";
import { createDeliveryAccess, decryptDeliveryToken } from "../guest-delivery";
import { maskEmail } from "../masking";
import { secureDeliveryUrl, type DeliveryNotice } from "./delivery";

export type DeliveryEmailContent = {
  subject: string;
  html: string;
  text: string;
};
export type EmailTransport = {
  send(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }>;
};
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export function deliveryEmailContent(
  notice: DeliveryNotice & { customerName: string },
): DeliveryEmailContent {
  const subject = `BancadaSoft — Seu acesso ${notice.productName} foi liberado`;
  const name = escapeHtml(notice.customerName);
  const number = escapeHtml(notice.orderNumber);
  const product = escapeHtml(notice.productName);
  const url = escapeHtml(notice.secureUrl);
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;color:#10213b;max-width:600px;margin:auto"><h1 style="color:#0878f9">BancadaSoft</h1><p>Olá, ${name}.</p><p>Seu acesso a ${product} foi liberado.</p><p><strong>Pedido:</strong> ${number}</p><p><a href="${url}" style="display:inline-block;background:#0878f9;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">ACESSAR MEU LOGIN</a></p><p>Por segurança, não compartilhe este link.</p><p>BancadaSoft<br>Encontrou. Pagou. Liberou.</p></div>`,
    text: `Olá, ${notice.customerName}.\n\nSeu acesso a ${notice.productName} foi liberado.\n\nPedido: ${notice.orderNumber}\n\nAcesse seu login com segurança:\n${notice.secureUrl}\n\nPor segurança, não compartilhe este link.\n\nBancadaSoft\nEncontrou. Pagou. Liberou.`,
  };
}
export class ResendEmailTransport implements EmailTransport {
  constructor(private readonly client: Resend) {}
  async send(input: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
  }) {
    const { data, error } = await this.client.emails.send(input);
    if (error || !data?.id) throw new Error("RESEND_SEND_FAILED");
    return { messageId: data.id };
  }
}
const safeError = (error: unknown) =>
  error instanceof Error && /NOT_CONFIGURED/.test(error.message)
    ? error.message
    : "EMAIL_DELIVERY_FAILED";

async function deliverToClaimedNotification(
  order: {
    id: string;
    publicToken: string;
    deliveryTokenEncrypted: string;
    customer: { name: string; email: string };
    items: Array<{ product: { name: string } }>;
  },
  notificationId: string,
  recipient: string,
  options: { apiKey?: string; from?: string; transport?: EmailTransport },
) {
  const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
  const from = options.from ?? process.env.EMAIL_FROM;
  if (!apiKey?.trim() || !from?.trim()) {
    await prisma.deliveryNotification.update({
      where: { id: notificationId },
      data: {
        status: DeliveryNotificationStatus.NOT_CONFIGURED,
        errorMessage: "NOTIFICATION_NOT_CONFIGURED",
      },
    });
    return { status: "NOT_CONFIGURED" as const };
  }
  const token = decryptDeliveryToken(order.deliveryTokenEncrypted);
  if (!token) {
    await prisma.deliveryNotification.update({
      where: { id: notificationId },
      data: {
        status: DeliveryNotificationStatus.FAILED,
        errorMessage: "DELIVERY_TOKEN_UNAVAILABLE",
      },
    });
    return { status: "FAILED" as const };
  }
  const domain =
    (
      await prisma.siteSettings.findUnique({
        where: { id: "default" },
        select: { domain: true },
      })
    )?.domain ?? "www.bancadasoft.com.br";
  const notice = {
    customerName: order.customer.name,
    orderNumber: order.publicToken.slice(0, 8).toUpperCase(),
    productName: order.items[0]?.product.name ?? "UnlockTool 6 horas",
    recipientEmail: recipient,
    secureUrl: secureDeliveryUrl(`https://${domain}`, order.id, token),
  };
  const content = deliveryEmailContent(notice);
  const transport =
    options.transport ?? new ResendEmailTransport(new Resend(apiKey.trim()));
  try {
    const sent = await transport.send({
      from: from.trim(),
      to: recipient,
      ...content,
    });
    await prisma.$transaction([
      prisma.deliveryNotification.update({
        where: { id: notificationId },
        data: {
          status: DeliveryNotificationStatus.SENT,
          providerMessageId: sent.messageId,
          sentAt: new Date(),
          errorMessage: null,
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { deliveryNotifiedAt: new Date() },
      }),
    ]);
    return { status: "SENT" as const };
  } catch (error) {
    await prisma.deliveryNotification.update({
      where: { id: notificationId },
      data: {
        status: DeliveryNotificationStatus.FAILED,
        errorMessage: safeError(error),
      },
    });
    return { status: "FAILED" as const };
  }
}

// Cobertura contra duplo clique no "Reenviar acesso" do Admin: um novo envio só
// é aceito depois desse intervalo desde a última tentativa para o mesmo pedido.
export const RESEND_DELIVERY_COOLDOWN_MS = 30_000;

/**
 * Reenvio administrativo do acesso já entregue (PARTE 9/18). Reaproveita a
 * mesma tabela de notificação e o mesmo token seguro (reemitindo apenas se
 * estiver expirado/revogado) em vez de criar Order/Payment/Fulfillment novos.
 */
export async function resendDeliveryEmail(
  orderId: string,
  options: { apiKey?: string; from?: string; transport?: EmailTransport; now?: Date } = {},
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      publicToken: true,
      status: true,
      deliveryTokenHash: true,
      deliveryTokenEncrypted: true,
      deliveryTokenExpiresAt: true,
      deliveryTokenRevokedAt: true,
      customer: { select: { name: true, email: true } },
      items: { select: { product: { select: { name: true } } } },
      fulfillment: { select: { delivery: true } },
    },
  });
  if (
    !order ||
    order.status !== OrderStatus.DELIVERED ||
    !order.fulfillment?.delivery
  )
    return { status: "SKIPPED" as const };
  const recipient = order.customer.email.trim().toLowerCase();
  const masked = maskEmail(recipient);
  const now = options.now ?? new Date();
  const notification = await prisma.deliveryNotification.upsert({
    where: { orderId_channel: { orderId, channel: "EMAIL" } },
    create: { orderId, channel: "EMAIL", recipientMasked: masked },
    update: { recipientMasked: masked },
  });
  const cooldownStart = new Date(now.getTime() - RESEND_DELIVERY_COOLDOWN_MS);
  const claim = await prisma.deliveryNotification.updateMany({
    where: {
      id: notification.id,
      OR: [
        { lastAttemptAt: null },
        { lastAttemptAt: { lt: cooldownStart } },
      ],
    },
    data: { attempts: { increment: 1 }, lastAttemptAt: now },
  });
  if (claim.count !== 1) return { status: "DUPLICATE" as const };
  const revoked = Boolean(order.deliveryTokenRevokedAt);
  const expired =
    !order.deliveryTokenExpiresAt || order.deliveryTokenExpiresAt <= now;
  let deliveryTokenEncrypted = order.deliveryTokenEncrypted;
  if (revoked || expired || !deliveryTokenEncrypted) {
    const access = createDeliveryAccess(now);
    await prisma.order.update({
      where: { id: orderId },
      data: {
        deliveryTokenHash: access.tokenHash,
        deliveryTokenExpiresAt: access.expiresAt,
        deliveryTokenEncrypted: access.encryptedToken,
        deliveryTokenRevokedAt: null,
      },
    });
    deliveryTokenEncrypted = access.encryptedToken;
  }
  return deliverToClaimedNotification(
    { ...order, deliveryTokenEncrypted },
    notification.id,
    recipient,
    options,
  );
}

export async function sendDeliveryEmail(
  orderId: string,
  options: { apiKey?: string; from?: string; transport?: EmailTransport } = {},
) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      publicToken: true,
      status: true,
      deliveryTokenEncrypted: true,
      deliveryNotifiedAt: true,
      customer: { select: { name: true, email: true } },
      items: { select: { product: { select: { name: true } } } },
      fulfillment: { select: { delivery: true } },
    },
  });
  if (
    !order ||
    order.status !== OrderStatus.DELIVERED ||
    !order.fulfillment?.delivery ||
    !order.deliveryTokenEncrypted
  )
    return { status: "SKIPPED" as const };
  const recipient = order.customer.email.trim().toLowerCase();
  const masked = maskEmail(recipient);
  let notification;
  try {
    notification = await prisma.deliveryNotification.create({
      data: { orderId, channel: "EMAIL", recipientMasked: masked },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return { status: "DUPLICATE" as const };
    throw error;
  }
  const claim = await prisma.deliveryNotification.updateMany({
    where: {
      id: notification.id,
      status: DeliveryNotificationStatus.PENDING,
      attempts: 0,
    },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
  });
  if (claim.count !== 1) return { status: "DUPLICATE" as const };
  return deliverToClaimedNotification(
    { ...order, deliveryTokenEncrypted: order.deliveryTokenEncrypted! },
    notification.id,
    recipient,
    options,
  );
}
