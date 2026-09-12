export function buildHeartUnlocksOrderPayload({
  productUuid,
  referenceId,
  quantity,
  feedbackBase,
  callbackSecret,
  fields = {},
}) {
  if (
    typeof productUuid !== "string" ||
    typeof referenceId !== "string" ||
    quantity !== 1 || !fields || typeof fields !== "object" || Array.isArray(fields)
  )
    throw new Error("INVALID_ORDER_PAYLOAD");
  const feedbackUrl = new URL(
    `/callbacks/heartunlocks?token=${encodeURIComponent(callbackSecret)}`,
    feedbackBase,
  ).toString();
  const providerFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (["feedback_url", "reference_id", "Quantity"].includes(key)) continue;
    if (!key || key.length > 100 || (typeof value !== "string" && typeof value !== "number")) throw new Error("INVALID_ORDER_PAYLOAD");
    providerFields[key] = value;
  }
  return [
    {
      product_uuid: productUuid,
      fields: [
        {
          feedback_url: feedbackUrl,
          reference_id: referenceId,
          Quantity: quantity,
          ...providerFields,
        },
      ],
    },
  ];
}
