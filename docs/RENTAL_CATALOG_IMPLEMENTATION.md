# Implantação comercial — Rent's Digital Tools (HeartUnlocks)

## Objetivo

Organizar e publicar o cluster de aluguel automático de ferramentas
(login+senha entregues automaticamente), identificado pela
`contractSignature` `102cbb9ce75f...` (`AUTO_CREDENTIAL`/`READY`/
`expectedDeliveryType=CREDENTIALS`, campo único `quantity`), sem regredir
nada já publicado.

## Revalidação (antes de escrever)

Recontagem direta no banco confirmou: Provider HeartUnlocks ativo, 1821
ProviderProducts, **35 itens** no cluster (mesma contagem da auditoria
anterior, recontada agora — não presumida). Todos `active=true`,
`technicalEligibility=READY`, `automationClass=AUTO_CREDENTIAL`,
`expectedDeliveryType=CREDENTIALS`, `fieldSchema=[quantity]`,
`providerDescription=null` (100%, todos `DESCRIPTION_SOURCE=TITLE_ONLY`).

## Ferramentas identificadas (marca real, não substring)

| Ferramenta | Status | Product(s) |
|---|---|---|
| AMT, CF Tools, DFT Pro, TSM Tool, UnlockTool | Já publicados (Fase 3/4) | **não tocados** |
| AnonySHU Tool, Arab FRP Tool, Galaxy Multi Tool, Hydra Tool, Lazy Login Tool, MDM FIX Tool, Meow Login Tool, MRT Tool, KG Killer Tool, TFM Tool, UAT PRO TOOL, TR Tool | Novos, 1 Product cada | criados |
| GAPro Login Tool (OnePlus/Realme) | Novo, 2 variantes | criado |
| Griffin Unlocker (Não Premium 6h / Premium 5h) | **Reaproveitado** placeholder PAUSED já existente (`griffin-unlocker-aluguel`) | atualizado, não duplicado |
| OplusPro Login (OnePlus/Realme/Tecno-Infinix-Itel) | Novo, 3 variantes | criado |
| RFT Loader OTP Login Tool (OnePlus/Oppo/Realme) | Novo, 3 variantes | criado |

**Atenção de nomenclatura**: "OplusPro Login" (novo, marca própria) é
diferente de "Octoplus" (marca já existente, placeholders `octoplus-samsung-
aluguel`/`octoplus-frp-aluguel`, não relacionados e não tocados) — nomes
parecidos, ferramentas diferentes, confirmado por `categoryName`/título
reais.

## Duração — extraída somente do título (nunca inventada)

Tools "Rent X Hours" têm duração explícita no título (2h–24h, ou "24x7
Server Access" para Lazy Login Tool). A família "Login/OTP/Loader" (GAPro,
Meow Login, OplusPro, RFT Loader) **não menciona duração em hora alguma**
no título — `Product.duration` foi deixado `null` para esses casos, não
inventado.

## Fontes alternativas (documentadas, não publicadas)

| Ferramenta | Duração | Primary | Alternative | Motivo |
|---|---|---|---|---|
| AMT | 2h | 2337 (já publicado) | 2216, 2995 | mesma oferta, custo diferente |
| DFT Pro | 48h | 2338 (já publicado) | 2211 | mesma oferta, custo diferente |
| Griffin — Não Premium | 6h | 2996 (nesta fase) | 2210 | mesma oferta, mesmo custo |
| MDM FIX Tool | 6h | 2202 (nesta fase) | 2336 | rotulado "Souce 2" pelo provider |
| TSM Tool | 3h | 2334 (já publicado) | 2998 | mesma oferta, mesmo custo |
| UnlockTool | 6h | 2194 (já publicado) | 2333 | já documentado na Fase 4 |

Nenhum fallback automático foi implementado (exigiria arquitetura nova,
fora do escopo desta fase).

## Bloqueado para revisão humana

`2335` — "TFM Tool Pro Rent [6 Hours] Souce 2": título indica tier "Pro" e
6h, diferente do TFM Tool base (2200, 5h). Rotulado "Souce 2" pelo provider,
mas a divergência de tier/duração impede presumir que é a mesma oferta
comercial de 2200. Não publicado até confirmação.

## Preços (custo → sugerido pelo engine existente, sem alterar configuração global)

Faixa: R$10,90 (mínimo global) a R$431,90 (RFT Loader Oppo, custo real
US$29,70). Nenhum `normalPriceCents`/`premiumPriceCents` diferenciado foi
configurado (mesma decisão da Fase 4).

## Segurança — credenciais

Entrega de login/senha usa o `secure delivery` já existente
(`Fulfillment.delivery`, acesso via token, nunca em DTO público/HTML/logs/
listagem geral do Admin) — nenhuma alteração nesse fluxo. `REMOTE_SESSION`
não apareceu neste cluster (todos os 35 são `AUTO_CREDENTIAL`); nenhum item
`REMOTE_SESSION` foi publicado como aluguel automático.

## Saldo HeartUnlocks

`BALANCE PRECHECK NOT AVAILABLE` (inalterado desde a Fase 4 — endpoint não
existe).

## Arquivos alterados

- `scripts/implement-rental-catalog.mjs` (novo — idempotente, dry-run por
  padrão, escopado aos 35 externalIds analisados)
- `docs/RENTAL_CATALOG_IMPLEMENTATION.md` (este arquivo)

**Nenhum código de biblioteca foi alterado** (checkout, fulfillment,
pricing, automation permanecem exatamente como na Fase 4) — esta fase é
puramente de dados/catálogo. **Nenhuma migration.**

## Testes

Nenhum teste novo foi necessário: a implementação não introduziu nenhum
caminho de código novo — reutiliza integralmente `resolveProviderProduct`,
`resolveCheckoutVariant`, `calculatePricing` e o fluxo de fulfillment já
cobertos pela suíte existente (incluindo os 4 testes de
`shouldRecordPaidFulfillmentFailure` da Fase 4). `npm run test`: 402/402
(mesma baseline, sem regressão).

## Rollback

```sql
UPDATE "Product" SET status = 'PAUSED' WHERE slug IN (
  'anonyshu-tool-rent-10h','arab-frp-tool-rent-3h','galaxy-multi-tool-rent-2h',
  'hydra-tool-rent-20h','lazy-login-tool-realme','mdm-fix-tool-rent-6h',
  'meow-login-tool-realme','mrt-tool-rent-24h','kg-killer-tool-rent-4h',
  'tfm-tool-rent-5h','uat-pro-tool-rent-2h','tr-tool-rent-24h',
  'gapro-login-tool','oplus-pro-login','rft-loader-otp-login-tool'
);
-- griffin-unlocker-aluguel: reverter para o estado anterior (PAUSED) se necessário,
-- mas SEM remover as ProductVariants criadas (preserva histórico/estrutura).
UPDATE "Product" SET status = 'PAUSED' WHERE slug = 'griffin-unlocker-aluguel';
```

Não usar `DELETE`. `ProviderProduct`/pedidos históricos nunca são tocados.
