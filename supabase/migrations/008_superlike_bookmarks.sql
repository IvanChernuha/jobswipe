-- Add super_like to swipe direction enum
ALTER TYPE swipe_direction_enum ADD VALUE IF NOT EXISTS 'super_like';

-- Bookmarks table
CREATE TABLE IF NOT EXISTS public.bookmarks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON public.bookmarks(user_id);

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookmarks_own" ON public.bookmarks USING (auth.uid() = user_id);
