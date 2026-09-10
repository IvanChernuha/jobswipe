-- Trust & safety (Phase 2): account suspension, user blocks, report actioning.
-- Additive only — safe to apply before deploying the code that uses it.

-- Suspension: set by the automated report loop or an admin. While set, every
-- authenticated API call returns 403 and the user is excluded from feeds.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS suspended_at     timestamptz DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS suspended_reason text        DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_users_suspended
    ON public.users(suspended_at) WHERE suspended_at IS NOT NULL;

-- Why a job was auto-hidden (active = false) by the report loop. NULL = never.
ALTER TABLE public.job_postings
    ADD COLUMN IF NOT EXISTS moderation_note text DEFAULT NULL;

ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS actioned_at timestamptz DEFAULT NULL;

-- Blocks are per-user and one-directional in storage, but enforced in both
-- directions (neither party sees the other in feeds, swipes, or chat).
CREATE TABLE IF NOT EXISTS public.blocked_users (
  blocker_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON public.blocked_users(blocked_id);

ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "blocks_own" ON public.blocked_users;
CREATE POLICY "blocks_own" ON public.blocked_users
    FOR ALL USING (auth.uid() = blocker_id) WITH CHECK (auth.uid() = blocker_id);
