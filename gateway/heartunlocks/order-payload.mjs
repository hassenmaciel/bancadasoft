export function buildHeartUnlocksOrderPayload({
  productUuid,
  referenceId,
  quantity,
  feedbackBase,
  callbackSecret,
}) {
  if (
    typeof productUuid !== "string" ||
    typeof referenceId !== "string" ||
    quantity !== 1
  )
    throw new Error("INVALID_ORDER_PAYLOAD");
  const feedbackUrl = new URL(
    `/callbacks/heartunlocks?token=${encodeURIComponent(callbackSecret)}`,
    feedbackBase,
  ).toString();
  return [
    {
      product_uuid: productUuid,
      fields: [
        {
          feedback_url: feedbackUrl,
          reference_id: referenceId,
          Quantity: quantity,
        },
      ],
    },
  ];
}
