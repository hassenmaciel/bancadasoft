-- Idempotência da API de revenda: um mesmo revendedor (userId) não pode ter
-- dois lançamentos com a mesma externalReference. Várias linhas com
-- externalReference NULL continuam permitidas (NULLs são distintos no índice
-- único do Postgres), então recargas via Order e ajustes não são afetados.
-- Aditiva: só cria um índice; não altera nenhuma tabela ou dado existente.

-- CreateIndex
CREATE UNIQUE INDEX "AccountLedgerEntry_userId_externalReference_key" ON "AccountLedgerEntry"("userId", "externalReference");

