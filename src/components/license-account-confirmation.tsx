import { LICENSE_ACCOUNT_CONFIRMATION } from "@/lib/unlocktool-license";

// Conferência obrigatória antes de gerar o PIX da licença UnlockTool. Estado
// controlado pelo checkout; nada aqui é persistido nem enviado à API.
export default function LicenseAccountConfirmation({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor="checkout-license-confirm" className="license-confirmation">
      <input
        id="checkout-license-confirm"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        required
      />
      <span>{LICENSE_ACCOUNT_CONFIRMATION}</span>
    </label>
  );
}
