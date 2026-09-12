export type DeliveryChannel = "WEB" | "EMAIL" | "WHATSAPP";
export type DeliveryNotice = {
  orderNumber: string;
  productName: string;
  secureUrl: string;
  recipientEmail: string;
};
export interface DeliveryNotifier {
  readonly channel: DeliveryChannel;
  send(notice: DeliveryNotice): Promise<{ messageId: string }>;
}
export class DeliveryNotificationNotConfiguredError extends Error {
  constructor() {
    super("DELIVERY_EMAIL_NOT_CONFIGURED");
    this.name = "DeliveryNotificationNotConfiguredError";
  }
}
export const secureDeliveryUrl = (
  baseUrl: string,
  orderId: string,
  token: string,
) =>
  `${baseUrl.replace(/\/$/, "")}/acompanhar/${encodeURIComponent(orderId)}#token=${encodeURIComponent(token)}`;
