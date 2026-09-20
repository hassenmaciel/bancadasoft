/**
 * Rastreia a imagem enviada NESTA sessão do formulário e ainda não salva.
 * Só ela pode ser descartada ao trocar/remover; qualquer outro valor (por
 * exemplo a URL que veio do banco) nunca é apagado pelo cliente.
 */
export function createUploadSession() {
  let pending = "";
  return {
    /** Chamar quando o `value` do campo mudar. Se ele deixou de ser o upload pendente, o formulário foi salvo, limpo ou trocado. */
    sync(value: string) {
      if (pending && value !== pending) pending = "";
    },
    /** URL que pode ser descartada agora, ou null. */
    discardTarget(value: string) {
      return pending && pending === value ? pending : null;
    },
    uploaded(url: string) {
      pending = url;
    },
    clear() {
      pending = "";
    },
  };
}
