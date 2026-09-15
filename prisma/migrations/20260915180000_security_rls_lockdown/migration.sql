-- Security fix: Supabase Security Advisor CRITICAL "rls_disabled_in_public"
--
-- Prepared read-only on 2026-09-15. NOT applied automatically by this commit.
-- Requires explicit authorization before running `prisma migrate deploy`.
--
-- Revalidated against the live catalog immediately before writing this file:
--   - 22 tables in schema public (21 business tables + _prisma_migrations),
--     all owned by role "postgres", all with RLS disabled, 0 policies.
--   - DATABASE_URL (Prisma) connects as "postgres" (current_user = session_user
--     = postgres). "postgres" is NOT a superuser here, but has rolbypassrls =
--     true AND owns every table in this schema. Either fact alone is enough
--     for RLS to never apply to it; together they make this migration safe
--     for Prisma regardless of policies (none are created below) or a future
--     FORCE ROW LEVEL SECURITY (not used here).
--   - No sequences exist in schema public (all model ids are text/cuid), so
--     sequence-level default privileges are out of scope: not part of the
--     rls_disabled_in_public finding and there is nothing to revoke.
--   - service_role and the Storage bucket "catalog-assets" are not
--     referenced anywhere below. Confirmed via pg_roles that "service_role"
--     also has rolbypassrls = true, so it is unaffected by RLS being turned
--     on regardless -- this migration only leaves its existing grants as-is.
--
-- Net effect for anon/authenticated via the Supabase Data API (PostgREST):
-- deny-by-default on all 22 tables. No policies are created, matching the
-- requirement that no table currently needs anon/authenticated access.

-- =========================================================================
-- 1. ENABLE ROW LEVEL SECURITY (no policies) on every table in schema public
-- =========================================================================

ALTER TABLE public."AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DeliveryAccessAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DeliveryNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Fulfillment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PaymentEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PricingConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PricingGroupRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Provider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProviderCallbackEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProviderOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProviderProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SiteSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
-- _prisma_migrations: decision documented in docs/SECURITY_RLS_LOCKDOWN.md.
-- Included for consistency (anon/authenticated have no legitimate reason to
-- read/write migration history). Prisma migrate itself runs as the table
-- owner ("postgres"), which bypasses RLS, so this does not affect
-- `prisma migrate deploy`/`dev`.
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 2. REVOKE existing broad grants from anon/authenticated
--    (postgres, the table owner, and service_role are untouched)
-- =========================================================================

REVOKE ALL PRIVILEGES ON TABLE public."AuditLog" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."Brand" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."Category" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."DeliveryAccessAttempt" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."DeliveryNotification" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."Fulfillment" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."Order" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."OrderEvent" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."OrderItem" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."Payment" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."PaymentEvent" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."PricingConfiguration" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."PricingGroupRule" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."Product" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."ProductVariant" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."Provider" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."ProviderCallbackEvent" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."ProviderOrder" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."ProviderProduct" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."SiteSettings" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."User" FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public."_prisma_migrations" FROM anon, authenticated;

-- =========================================================================
-- 3. DEFAULT PRIVILEGES for future tables (schema public, object type TABLES)
-- =========================================================================
--
-- Catalog check (pg_default_acl, read-only) found default-ACL entries for
-- TABLES in schema public owned by two different roles:
--   defaclrole = postgres        <- the role DATABASE_URL/Prisma uses to run
--                                    `prisma migrate deploy` and CREATE TABLE
--   defaclrole = supabase_admin  <- Supabase-internal provisioning role
--
-- "postgres" is not a member of "supabase_admin" (confirmed via a recursive
-- pg_auth_members walk) and is not a superuser here (rolsuper = false), so it
-- has no technical permission to alter the supabase_admin-owned entry.
-- "supabase_admin" is itself superuser (rolsuper = true) and holds identical
-- default-ACL entries across every Supabase-managed schema (public, storage,
-- graphql, graphql_public, realtime) -- this is Supabase's own project
-- bootstrap, run once as supabase_admin, not something a Dashboard/SQL
-- Editor/Table Editor session ever re-triggers (those run as "postgres",
-- confirmed by "public".* having zero tables owned by supabase_admin today).
-- The supabase_admin entry is left untouched and documented as an accepted
-- residual in docs/SECURITY_RLS_LOCKDOWN.md.
--
-- FOR ROLE postgres is explicit (not relied on as the implicit default) so
-- this statement always targets the postgres-owned entry regardless of how
-- it is later executed.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

-- Sequences: no sequences currently exist in schema public (all model ids
-- are text/cuid, not autoincrement), so no sequence-level default privilege
-- revoke is included. If a future migration introduces a serial/identity
-- column, its default ACL should be reviewed at that time.
