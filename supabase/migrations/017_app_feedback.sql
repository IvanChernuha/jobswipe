-- In-app feedback: testers rate the app (1-5) and say what they think, so
-- the founder can tell whether people like it before building the iPhone
-- version. Read on the admin page. Additive only.

CREATE TABLE IF NOT EXISTS public.app_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  message      text NOT NULL DEFAULT '',
  platform     text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios', 'web')),
  app_version  text NOT NULL DEFAULT '',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_feedback_created ON public.app_feedback(created_at DESC);

-- Only the API (service role) reads and writes it.
ALTER TABLE public.app_feedback ENABLE ROW LEVEL SECURITY;
