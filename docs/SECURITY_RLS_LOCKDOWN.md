# Security fix — Supabase `rls_disabled_in_public` (CRITICAL)

Status: **prepared, not applied**. Requires explicit authorization before running
`prisma migrate deploy` (or applying `prisma/migrations/20260915180000_security_rls_lockdown/migration.sql`
manually against `bancadasoft-dev`).

## Revalidation (read-only, done immediately before writing the migration)

Queried live catalog again (`pg_class`, `pg_roles`, `pg_default_acl`, `pg_auth_members`,
`information_schema.role_table_grants`) via a temporary read-only Node script
(created, run, and deleted in the same session — never committed):

- **21 business tables + `_prisma_migrations` = 22 tables** in schema `public`, matching
  exactly the 21 `model` declarations in `prisma/schema.prisma` (no `@@map` overrides,
  no divergence from the prior audit).
- **Owner of all 22 tables: `postgres`.**
- **Role used by `DATABASE_URL`: `postgres`** (`current_user = session_user = postgres`).
  Connection role **is** the table owner — no mismatch.
- `postgres` here: `rolsuper = false`, but **`rolbypassrls = true`**. Either the
  ownership or the `BYPASSRLS` attribute alone is sufficient for RLS to never apply to
  this connection; both are true. Enabling RLS (no `FORCE ROW LEVEL SECURITY` is used)
  is therefore safe for Prisma regardless of future policy changes.
- **No sequences** exist in schema `public` (all model ids are `text`/cuid, not
  autoincrement) — sequence-level default privileges are out of scope for this fix.
- **Default ACL for `TABLES` in schema `public` has two owning roles:**
  - `defaclrole = postgres` — this is the entry that matters: every future
    Prisma migration runs `CREATE TABLE` as `postgres`, which is exactly the role
    that will execute this fix migration, so `ALTER DEFAULT PRIVILEGES` with **no**
    `FOR ROLE` clause correctly targets it.
  - `defaclrole = supabase_admin` — Supabase's internal provisioning role.
    `postgres` is **not** a member of `supabase_admin` and is not a superuser, so it
    cannot alter this entry. This is not a functional gap: Prisma never creates
    tables as `supabase_admin`, so this entry is never exercised by application
    migrations. **Accepted as out of scope**, documented here rather than worked
    around.

No divergence from the previous read-only audit was found — proceeding as planned.

## `_prisma_migrations` — decision

- Owner: `postgres`. Current grants: `postgres`, `anon`, `authenticated`,
  `service_role` all have full privileges (identical pattern to the 21 business
  tables).
- `anon`/`authenticated` have no legitimate reason to read or write migration
  history — included in both `ENABLE ROW LEVEL SECURITY` and the `REVOKE`.
- `prisma migrate deploy`/`dev` runs as `postgres`, the table owner with
  `rolbypassrls = true` — RLS on this table has **no effect** on Prisma's own
  migration tooling.
- Decision: **include it**, same treatment as business tables.

## Storage

Not touched. No `GRANT`/`REVOKE`/`ALTER` on `storage.*`, no reference to the
`catalog-assets` bucket or its policies anywhere in the migration SQL (verified by
grep — the only occurrence of "storage"/"bucket" in the file is in a comment
confirming it was intentionally left alone).

## Rollback procedure (documented only — NOT executed)

Reverses the migration in the opposite order applied. Restores the exact grant set
that `anon`/`authenticated` had before this migration (`ALL PRIVILEGES`, i.e.
SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, matching what the audit
found live) and disables RLS again.

```sql
-- 1) Restore default privileges for future tables (postgres-owned entry)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated;

-- 2) Restore table grants (all 22 tables)
GRANT ALL PRIVILEGES ON TABLE public."AuditLog" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."Brand" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."Category" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."DeliveryAccessAttempt" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."DeliveryNotification" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."Fulfillment" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."Order" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."OrderEvent" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."OrderItem" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."Payment" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."PaymentEvent" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."PricingConfiguration" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."PricingGroupRule" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."Product" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."ProductVariant" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."Provider" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."ProviderCallbackEvent" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."ProviderOrder" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."ProviderProduct" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."SiteSettings" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."User" TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public."_prisma_migrations" TO anon, authenticated;

-- 3) Disable RLS again (all 22 tables)
ALTER TABLE public."AuditLog" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Brand" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Category" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."DeliveryAccessAttempt" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."DeliveryNotification" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Fulfillment" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Order" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderEvent" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderItem" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Payment" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."PaymentEvent" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."PricingConfiguration" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."PricingGroupRule" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Product" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductVariant" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."Provider" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProviderCallbackEvent" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProviderOrder" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProviderProduct" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."SiteSettings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" DISABLE ROW LEVEL SECURITY;
ALTER TABLE public."_prisma_migrations" DISABLE ROW LEVEL SECURITY;
```

Note: this restores the pre-migration state exactly (same broad exposure the audit
flagged). It is meant only as an emergency escape hatch if an unknown external
dependency on the Supabase Data API is discovered after applying, not as a normal
step.

## Post-apply test checklist (to run only after explicit authorization to apply)

### Banco
- [ ] `select relname, relrowsecurity from pg_class ... where nspname='public' and relkind='r'` → 22/22 `true`
- [ ] `pg_policies` for schema `public` → still 0 rows (deny-by-default, no permissive policy created)
- [ ] `information_schema.role_table_grants` for `anon`/`authenticated` on the 22 tables → 0 rows
- [ ] `pg_default_acl` postgres-owned `tables` entry → empty ACL for anon/authenticated
- [ ] `prisma migrate status` clean; `prisma migrate deploy` (or `db push` in dev) completes without error
- [ ] A basic Prisma read/write (e.g. via the app itself) still works end-to-end

### BancadaSoft (funcional, sem gerar cobrança real)
- [ ] Home
- [ ] Catálogo
- [ ] Página de Produto
- [ ] Login
- [ ] Cadastro
- [ ] Ativação de conta `PENDING_INVITE`
- [ ] Meus Pedidos
- [ ] Admin — Produtos
- [ ] Admin — Pedidos
- [ ] Admin — Usuários
- [ ] Admin — Configurações
- [ ] Upload de imagem via Storage (bucket `catalog-assets`, deve continuar funcionando sem alteração)
- [ ] Secure delivery / recovery (token de entrega)

### Checkout
- [ ] Fluxo validado apenas até a geração da intenção de pagamento — **sem criar PIX real**, sem cobrança real no ASAAS.

### Integrações
- [ ] Nenhum pedido real criado no HeartUnlocks.
- [ ] Nenhum ticket real criado no AdClean.

### Verificação externa (fora do Prisma)
- [ ] Requisição HTTP ao Data API (`GET {SUPABASE_URL}/rest/v1/User`) usando a chave anon/publishable → deve retornar `401`/`403` (antes da correção retornaria os dados).
