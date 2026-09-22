-- Threaded, signed notes on employer-side bookmarks (saved candidates).
-- Additive only — safe to apply before deploying the code that uses it.
--
-- Employer bookmarks become a team-shared resource (see bookmarks.py): any
-- org member can see and act on a saved candidate, and each teammate can
-- leave their own note, always shown signed with their name/email. Worker
-- bookmarks (saved jobs) are unaffected — still private, still use the
-- existing single bookmarks.note column.

CREATE TABLE IF NOT EXISTS public.bookmark_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmark_id uuid NOT NULL REFERENCES public.bookmarks(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id),
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookmark_notes_bookmark ON public.bookmark_notes(bookmark_id, created_at);

-- Preserve existing single employer notes as the first thread entry,
-- authored by whoever created the bookmark.
INSERT INTO public.bookmark_notes (bookmark_id, author_id, body, created_at)
SELECT b.id, b.user_id, b.note, COALESCE(b.created_at, now())
FROM public.bookmarks b
JOIN public.users u ON u.id = b.user_id
WHERE u.role = 'employer' AND b.note IS NOT NULL AND btrim(b.note) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.bookmark_notes n WHERE n.bookmark_id = b.id);

ALTER TABLE public.bookmark_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bookmark_notes_team" ON public.bookmark_notes;
CREATE POLICY "bookmark_notes_team" ON public.bookmark_notes FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.bookmarks b WHERE b.id = bookmark_notes.bookmark_id AND b.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.bookmarks b
    JOIN public.employer_profiles owner_ep ON owner_ep.user_id = b.user_id
    JOIN public.employer_profiles me_ep ON me_ep.user_id = auth.uid()
    WHERE b.id = bookmark_notes.bookmark_id
      AND me_ep.org_id IS NOT NULL AND me_ep.org_id = owner_ep.org_id
  )
);
