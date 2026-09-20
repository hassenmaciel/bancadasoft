"use client";

export default function NewPurchaseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="new-purchase-button" onClick={onClick}>
      Fazer nova compra
    </button>
  );
}
