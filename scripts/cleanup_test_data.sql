-- Remove automated-test accounts and everything they own. DRY RUN by default:
-- the transaction is rolled back unless you change the last line to COMMIT.
--
--   docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/cleanup_test_data.sql
--
-- Matches emails at @t.com, @test.com, @test.local (Playwright/pytest fixtures)
-- and the two @jobswipe.dev fixtures. Never touches @demo.com, demo_employer,
-- or real people. Take a backup first: scripts/backup_db.sh
BEGIN;

CREATE TEMP TABLE doomed AS
  SELECT id FROM public.users
  WHERE email LIKE '%@t.com' OR email LIKE '%@test.com' OR email LIKE '%@test.local'
     OR email IN ('testworker@jobswipe.dev', 'testemployer@jobswipe.dev');

CREATE TEMP TABLE doomed_jobs AS
  SELECT id FROM public.job_postings WHERE employer_id IN (SELECT id FROM doomed);

SELECT (SELECT count(*) FROM doomed) AS users_to_delete, (SELECT count(*) FROM doomed_jobs) AS jobs_to_delete;

-- Dependency order (explicit, so it does not rely on ON DELETE CASCADE being set everywhere)
DELETE FROM public.message_read_cursors WHERE user_id IN (SELECT id FROM doomed)
   OR match_id IN (SELECT id FROM public.matches WHERE worker_id IN (SELECT id FROM doomed) OR employer_id IN (SELECT id FROM doomed) OR job_posting_id IN (SELECT id FROM doomed_jobs));
DELETE FROM public.messages WHERE sender_id IN (SELECT id FROM doomed)
   OR match_id IN (SELECT id FROM public.matches WHERE worker_id IN (SELECT id FROM doomed) OR employer_id IN (SELECT id FROM doomed) OR job_posting_id IN (SELECT id FROM doomed_jobs));
DELETE FROM public.matches WHERE worker_id IN (SELECT id FROM doomed) OR employer_id IN (SELECT id FROM doomed) OR job_posting_id IN (SELECT id FROM doomed_jobs);
DELETE FROM public.swipes WHERE swiper_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed_jobs);
DELETE FROM public.bookmarks WHERE user_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed_jobs) OR job_posting_id IN (SELECT id FROM doomed_jobs);
DELETE FROM public.reports WHERE reporter_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed) OR target_id IN (SELECT id FROM doomed_jobs);
DELETE FROM public.blocked_users WHERE blocker_id IN (SELECT id FROM doomed) OR blocked_id IN (SELECT id FROM doomed);
DELETE FROM public.job_posting_tags WHERE job_posting_id IN (SELECT id FROM doomed_jobs);
DELETE FROM public.job_postings WHERE id IN (SELECT id FROM doomed_jobs);
DELETE FROM public.worker_tags WHERE worker_id IN (SELECT id FROM doomed);
DELETE FROM public.org_invites WHERE org_id IN (SELECT id FROM public.organizations WHERE owner_id IN (SELECT id FROM doomed));
DELETE FROM public.org_members WHERE user_id IN (SELECT id FROM doomed) OR org_id IN (SELECT id FROM public.organizations WHERE owner_id IN (SELECT id FROM doomed));
UPDATE public.employer_profiles SET org_id = NULL WHERE org_id IN (SELECT id FROM public.organizations WHERE owner_id IN (SELECT id FROM doomed));
DELETE FROM public.organizations WHERE owner_id IN (SELECT id FROM doomed);
DELETE FROM public.worker_profiles WHERE user_id IN (SELECT id FROM doomed);
DELETE FROM public.employer_profiles WHERE user_id IN (SELECT id FROM doomed);
DELETE FROM public.users WHERE id IN (SELECT id FROM doomed);
DELETE FROM auth.users WHERE id IN (SELECT id FROM doomed);

SELECT (SELECT count(*) FROM public.users) AS users_left, (SELECT count(*) FROM public.job_postings) AS jobs_left,
       (SELECT count(*) FROM public.worker_profiles WHERE name <> '') AS workers_left;

ROLLBACK;  -- change to COMMIT to apply
