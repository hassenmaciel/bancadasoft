# BancadaSoft MVP

MVP vertical local para validar `catálogo → PIX sandbox → webhook idempotente → fulfillment mock → entrega`.

## Executar

```powershell
npm.cmd run dev
npm.cmd test
```

Abra `http://localhost:3000`. A aplicação não chama HeartUnlocks nem um provedor PIX real.

## Escopo implementado

- catálogo público de itens publicados (`GET /api/products`);
- checkout validado (`POST /api/checkout`);
- PIX sandbox, consulta de pedido e entrega demonstrativa;
- webhook sandbox idempotente (`POST /api/webhooks/payments/sandbox`);
- administração básica de publicação (`GET/PATCH /api/admin/products`);
- testes das regras de catálogo, pedido e webhook.

Os dados são mantidos em memória para este MVP. Antes de produção, substituir por PostgreSQL, autenticação/RBAC, fila Redis/BullMQ, cofre de segredos e adaptadores reais de pagamento e HeartUnlocks.
