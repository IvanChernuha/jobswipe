-- Notifications (Phase: notifications). Additive only — safe to apply before
-- deploying the code that uses it.
--
-- title_key + params (jsonb) instead of free-text title/body: notification
-- text is rendered client-side via i18n (title_key looked up per-language,
-- params interpolated), so no display text is stored server-side.

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('match','like_received','chat','team','account')),
  title_key text NOT NULL,
  params jsonb DEFAULT '{}',
  link text DEFAULT '',
  actor_id uuid NULL,
  created_at timestamptz DEFAULT now(),
  read_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, type)
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
CREATE POLICY "notifications_own" ON public.notifications
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notification_prefs_own" ON public.notification_prefs;
CREATE POLICY "notification_prefs_own" ON public.notification_prefs
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
