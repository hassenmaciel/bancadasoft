-- BancadaSoft — Supabase Cron como scheduler do recovery de fulfillment.
-- NÃO é migration Prisma. Executar manualmente no SQL Editor do Supabase,
-- SOMENTE após autorização. Nenhum secret real neste arquivo.
--
-- Supabase é apenas o scheduler: 1 chamada HTTP GET por minuto para
-- /api/internal/fulfillment-recovery. Toda a lógica fica no endpoint Next.js.

-- ==========================================================
-- PASSO 0 (manual, fora do Git): definir o mesmo CRON_SECRET
--   a) Vercel Production: variável de ambiente CRON_SECRET (+ redeploy).
--   b) Supabase Vault (rodar no SQL Editor, colando o valor SÓ na hora,
--      sem salvar em arquivo/histórico versionado):
--
--   select vault.create_secret(
--     '<COLE_O_CRON_SECRET_AQUI>',
--     'bancadasoft_cron_secret',
--     'Bearer secret do /api/internal/fulfillment-recovery'
--   );
-- ==========================================================

-- PASSO 1: extensões (infra do Supabase; vault já está instalado)
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- PASSO 2: job (idempotente — remove o anterior de mesmo nome, se houver)
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'bancadasoft-fulfillment-recovery';

select cron.schedule(
  'bancadasoft-fulfillment-recovery',
  '* * * * *',
  $job$
  select net.http_get(
    url := 'https://www.bancadasoft.com.br/api/internal/fulfillment-recovery',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'bancadasoft_cron_secret'
      )
    ),
    timeout_milliseconds := 60000
  );
  $job$
);

-- ==========================================================
-- OBSERVABILIDADE (somente leitura; nunca expõe o secret)
-- ==========================================================
-- Última execução e status do agendador:
--   select jobid, status, return_message, start_time, end_time
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job
--                    where jobname = 'bancadasoft-fulfillment-recovery')
--    order by start_time desc limit 10;
--
-- Resposta HTTP do endpoint (contagens candidates/attempted/skipped/errored;
-- pg_net retém ~6h):
--   select id, status_code, timed_out, error_msg, content, created
--     from net._http_response
--    order by created desc limit 10;
--
-- Rollback:
--   select cron.unschedule('bancadasoft-fulfillment-recovery');
