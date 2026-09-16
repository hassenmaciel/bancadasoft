# Implantação comercial — FRPFILE / UnlockTool / Phoenix ServiceTool / SamsungTool

## Objetivo

Organizar em lote e publicar os quatro catálogos prioritários identificados na
auditoria HeartUnlocks, preservando integralmente o que já funcionava
(`unlocktool-6h`, `tsm-tool-aluguel-3h`, RLS, autenticação, checkout,
gateway), sem gerar nenhuma cobrança/pedido/ticket/e-mail real.

## Produtos implementados

- **FRPFILE**: os 12 `Product`/28 `ProductVariant` já existiam (seed
  anterior). Precificados e publicados 10 dos 12 cards (26 das 28
  variantes). `frpfile-fmi-off-open-menu` e `frpfile-open-menu-macbook`
  permanecem `DRAFT` — sua única variante tem `holdReason` documentado
  ("Origem/formato do Order code/Code não confirmado") e não foi tocada.
- **UnlockTool — Licença/Ativação** (`unlocktool-licenca-ativacao`, novo):
  3 variantes (3/6/12 meses).
- **Phoenix Service Tool — Nokia HMD (FRP Server)**
  (`phoenix-servicetool-nokia-hmd-frp`, novo): produto simples, vínculo
  direto (mesmo padrão de AMT/CF Tools/DFT Pro), sem variante.
- **SamsungTool — KG Bypass** (`samsungtool-kg-bypass`, novo): 5 variantes
  (3/6/12 meses, 1 dia/10 créditos, créditos usuário existente).
- **SamsungTool.us — Aluguel 10 Horas (Celltool)**
  (`samsungtool-us-aluguel-10h`, novo): produto separado do anterior porque
  a HeartUnlocks os categoriza de forma diferente ("Samsung Tool, KG Bypass"
  vs. "Remote Default Group") e representam ofertas comerciais distintas
  (licença/créditos vs. aluguel por hora).

`unlocktool-6h` (`cmtuuzxrr0003tx5k7otyb0jr`) não foi alterado — verificado
byte a byte antes/depois (`status`, `priceCents`, `normalPriceCents`
idênticos).

## ProviderProducts usados

FRPFILE: 221, 222, 223, 224, 225, 226, 227, 228, 229, 3081, 3126, 3128,
3175(bloqueado), 230(bloqueado), 3183, 3475–3484, 4400, 4401, 4493.
UnlockTool: 4661, 4662, 4663. Phoenix: 1808. SamsungTool: 64, 65, 2182,
3321, 3322, 3323.

`3127` ("FRPFILE A12+ Bypass Refund") e `58` ("unlocktool licence not add
for Verify") permanecem fora do catálogo comercial (administrativos).

## Critérios de agrupamento

- FRPFILE: 1 `Product` por função (bypass MDM, ramdisk, screen time, etc.),
  1 `ProductVariant` por modelo/estado de dispositivo — estrutura já
  definida no seed original, apenas revalidada.
- SamsungTool: separado em 2 `Product`s por `categoryName`/natureza
  comercial real do provider (licença por duração vs. aluguel por hora),
  conforme instrução explícita de não esconder diferença comercial.
- UnlockTool licença: 1 `Product` com 3 `ProductVariant`s (uma por
  duração) — reduz duplicidade, reutiliza `ProductVariant` como já feito no
  FRPFILE, não exige migration.

## Fonte escolhida para UnlockTool (SOURCE A vs. SOURCE B)

Revalidação direta no banco mostrou que os contratos técnicos
(`contractSignature`) NÃO são idênticos entre fontes em todas as durações:

| Duração | SOURCE A (unlocktool Reseller) | SOURCE B (UnlockTool ❤️) | Mesmo contrato? |
|---|---|---|---|
| 3 meses | 4662 — US$15,95 | 2068 — US$16,00 | NÃO (B tem campo `quantity` extra) |
| 6 meses | 4661 — US$23,85 | 2069 — US$24,00 | SIM |
| 12 meses | 4663 — US$39,75 | 2067 — US$40,00 | NÃO (B tem campo `quantity` extra) |

SOURCE A é mais barata e tecnicamente `READY`/ativa nas 3 durações — usada
como vínculo comercial primário. SOURCE B registrada como alternativa
futura, **não vinculada, sem fallback automático** (exigiria arquitetura
nova, fora do escopo desta etapa). `2333` ("Rent For UnlockTool 6 Hour
Souce 2") é uma fonte alternativa para o aluguel de 6h já provado (mesmo
`contractSignature` de `2194`) — registrada como candidata a fallback, sem
afetar `2194`.

## Itens excluídos (falso positivo, verificado antes desta etapa)

- **FlexUnlock Tool, MultiUnlock Tool, Ultra Unlock Tool**: ferramentas
  diferentes, não pertencem à família UnlockTool.
- **Octoplus Samsung Tool (3438/3437), Z3X Samsung Tool (2130/2126)**:
  módulos de outras ferramentas (Octoplus/Z3X), não são a ferramenta
  "SamsungTool".

## Disponibilidade do provider

`resolveProviderProduct`/`resolveCheckoutVariant`/`validateProviderExecution`
já filtram por `ProviderProduct.active` + `Provider.active` +
`technicalEligibility === READY` — checkout e fulfillment já negam
automaticamente qualquer item que um admin desative manualmente. Não foi
implementada desativação automática por `providerStatus` da HeartUnlocks
porque **esse campo é `null` em 100% dos 1821 ProviderProducts hoje**
(verificado nesta etapa) — não há sinal real para mapear, e inventar um
mapeamento sem evidência violaria a regra de não presumir comportamento do
provider. A via de proteção hoje é manual (Admin desativa
`ProviderProduct`/`Provider`), e já é imediatamente respeitada pelo
checkout.

## Política de saldo (balance precheck)

```
BALANCE PRECHECK NOT AVAILABLE
```
O gateway HeartUnlocks (`gateway/heartunlocks/server.mjs`) só expõe
`/health`, `/products`, `POST /orders` e `POST /callbacks/heartunlocks` —
nenhum endpoint de saldo/wallet/crédito. O adapter já tem `getBalance()`
escrito para lançar `HEARTUNLOCKS_BALANCE_NOT_ENABLED` deliberadamente. Não
foi inventado nenhum cálculo de saldo. A rede de segurança real para o
cenário "saldo insuficiente" é o tratamento de falha pós-pagamento (abaixo),
que já existia e foi reforçado nesta etapa.

## Política de falha (provider indisponível após pagamento)

O `fulfillment-engine.ts` já implementava corretamente: nunca marca
`DELIVERED`/`FULFILLED` em falha, nunca gera credencial falsa, claim atômico
evita execução duplicada, `MAX_PROVIDER_ATTEMPTS=3`, retry só manual via
Admin (`/api/admin/orders/[id]/retry`, nunca automático/cron).

**Gap real encontrado e corrigido nesta etapa**: se o provider/produto
ficasse indisponível exatamente entre a confirmação do pagamento e a
tentativa de fulfillment (checagem de pré-condição falhando antes de
qualquer `Fulfillment` ser criado), o pedido ficava `PAID` sem nenhum
registro de `Fulfillment`/`OrderEvent` — invisível no Admin. Corrigido em
`src/lib/fulfillment-engine.ts` (nova função pura
`shouldRecordPaidFulfillmentFailure` em `fulfillment-rules.ts`, testada):
agora esse cenário específico (primeira tentativa, sem `Fulfillment`
existente, pagamento `PAID`) cria `Fulfillment.FAILED` +
`Order.FAILED` + `OrderEvent`, tornando o pedido visível para revisão. Não
altera nenhum outro caminho (retry, sucesso, falha após já iniciado
processamento) — escopo mínimo, coberto por 4 testes novos.

## Política de refund

**ESTRATÉGIA B — ADMIN REVIEW.** O `AsaasClient` não tem nenhum método de
refund hoje; o código só consome passivamente o evento de webhook
`PAYMENT_REFUNDED` (já mapeado para `PaymentStatus.REFUNDED`), ou seja,
refunds feitos manualmente no painel Asaas já refletem corretamente no
BancadaSoft. Implementar disparo automático de refund agora exigiria API
nova, tratamento de idempotência novo, e testes financeiros — risco
desproporcional para esta etapa. `Order.status=FAILED` +
`Payment.status=PAID` já ficam visíveis juntos no Admin
(`src/lib/admin-order.ts`), suficiente para um humano identificar e agir.

## Arquivos alterados

- `scripts/implement-priority-catalog.mjs` (novo — script de implantação,
  idempotente, dry-run por padrão)
- `src/lib/fulfillment-rules.ts` (+ `shouldRecordPaidFulfillmentFailure`)
- `src/lib/fulfillment-rules.test.ts` (+4 testes)
- `src/lib/fulfillment-engine.ts` (grava falha quando pagamento já confirmado
  e a pré-validação bloqueia antes do provider ser chamado)
- `docs/PRIORITY_CATALOG_IMPLEMENTATION.md` (este arquivo)

**Migrations**: nenhuma. Todo o schema necessário (`Product`,
`ProductVariant`, `Brand`, `PricingMode.MANUAL`) já existia.

## Testes

`npm run test`: 402/402 (398 anteriores + 4 novos). `npm run lint`: limpo.
`npm run build`: sem erros.

## Rollback

Não usar `DELETE`. Para reverter a publicação:

```sql
UPDATE "Product" SET status = 'PAUSED'
WHERE slug IN (
  'unlocktool-licenca-ativacao','phoenix-servicetool-nokia-hmd-frp',
  'samsungtool-kg-bypass','samsungtool-us-aluguel-10h',
  'frpfile-premium','frpfile-activator-a5-a6','frpfile-activator-a12-plus',
  'frpfile-ramdisk-passcode','frpfile-ramdisk-hello','frpfile-mdm-iphone-ipad',
  'frpfile-mdm-macbook','frpfile-screen-time-open-menu',
  'frpfile-macbook-t2-bypass','frpfile-mac-owner-info'
);
```

Isso tira os cards do catálogo público imediatamente sem apagar
`ProviderProduct`/`ProductVariant`/pedidos históricos. Para reverter o
código: `git revert` do commit desta implementação (reverte
`fulfillment-engine.ts`/`fulfillment-rules.ts` ao comportamento anterior;
`unlocktool-6h`/`tsm-tool-aluguel-3h` nunca foram tocados, não precisam de
rollback).
