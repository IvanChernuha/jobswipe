-- Profession layer, part 2: professions as data (docs/worklog/profession-layer.md).
-- Each profession lists its tag categories, pay type and extra profile/job
-- fields; web and mobile build their forms from it. Launch has one enabled
-- profession, "Software developer", and every existing worker, job and tech
-- tag moves to it. Safe to run twice (applied by hand on dev and Oracle).

CREATE TABLE IF NOT EXISTS public.professions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key              text NOT NULL UNIQUE,
  name             jsonb NOT NULL,                     -- {"en": ..., "he": ...}
  pay_type_default text NOT NULL DEFAULT 'monthly' CHECK (pay_type_default IN ('monthly', 'hourly', 'per_shift')),
  categories       text[] NOT NULL,                    -- tag categories shown, in order
  fields           jsonb NOT NULL DEFAULT '[]'::jsonb, -- extra-field definitions
  enabled          boolean NOT NULL DEFAULT false,
  sort             int NOT NULL DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

-- Tags of a profession. Tags with no row here are universal (soft skills,
-- spoken languages, shifts, driving licence).
CREATE TABLE IF NOT EXISTS public.profession_tags (
  profession_id uuid NOT NULL REFERENCES public.professions(id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (profession_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_profession_tags_tag ON public.profession_tags(tag_id);

INSERT INTO public.professions (key, name, pay_type_default, categories, fields, enabled, sort)
VALUES (
  'software_dev',
  '{"en": "Software developer", "he": "מפתח/ת תוכנה"}',
  'monthly',
  ARRAY['language', 'framework', 'tool', 'database', 'cloud', 'certification', 'soft_skill', 'spoken_language', 'other'],
  '[
    {"key": "github_url", "type": "url", "for": "worker", "optional": true,
     "label": {"en": "GitHub", "he": "GitHub"}},
    {"key": "portfolio_url", "type": "url", "for": "worker", "optional": true,
     "label": {"en": "Portfolio", "he": "תיק עבודות"}},
    {"key": "education", "type": "list", "for": "worker", "optional": true, "max": 3,
     "label": {"en": "Education", "he": "השכלה"},
     "item": [
       {"key": "kind", "type": "select", "options": ["degree", "bootcamp", "course", "self_taught"],
        "label": {"en": "Type", "he": "סוג"}},
       {"key": "institution", "type": "text", "max": 80, "label": {"en": "Where", "he": "איפה"}},
       {"key": "grad_year", "type": "int", "min": 1980, "max": 2035, "optional": true,
        "label": {"en": "Year", "he": "שנה"}}
     ]},
    {"key": "projects", "type": "list", "for": "worker", "optional": true, "max": 3,
     "label": {"en": "Projects", "he": "פרויקטים"},
     "item": [
       {"key": "title", "type": "text", "max": 60, "label": {"en": "Project", "he": "פרויקט"}},
       {"key": "stack", "type": "tags", "optional": true, "label": {"en": "Built with", "he": "נבנה עם"}},
       {"key": "url", "type": "url", "optional": true, "label": {"en": "Link", "he": "קישור"}}
     ]},
    {"key": "army_role", "type": "text", "for": "worker", "optional": true, "max": 80,
     "label": {"en": "Army tech role", "he": "תפקיד טכנולוגי בצבא"}},
    {"key": "junior_friendly", "type": "bool", "for": "job", "optional": true,
     "label": {"en": "Junior-friendly", "he": "מתאים לג׳וניורים"}},
    {"key": "office_days", "type": "int", "for": "job", "optional": true, "min": 0, "max": 5,
     "label": {"en": "Office days per week", "he": "ימים במשרד בשבוע"}}
  ]',
  true,
  0
)
ON CONFLICT (key) DO NOTHING;

-- Existing tech tags belong to software_dev. Only tags no profession claims
-- yet, so a second run never pulls in tags added later for other professions.
INSERT INTO public.profession_tags (profession_id, tag_id)
SELECT p.id, t.id
FROM public.professions p
JOIN public.tags t ON t.category IN ('language', 'framework', 'tool', 'database', 'cloud', 'certification', 'other')
WHERE p.key = 'software_dev'
  AND NOT EXISTS (SELECT 1 FROM public.profession_tags pt WHERE pt.tag_id = t.id)
ON CONFLICT DO NOTHING;

-- Until the backend sets professions itself (profession layer step 3), new
-- rows default to software_dev so nothing breaks in between.
CREATE OR REPLACE FUNCTION public.default_profession_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM public.professions WHERE key = 'software_dev' $$;

ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS profession_id uuid REFERENCES public.professions(id),
  ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.worker_profiles ALTER COLUMN profession_id SET DEFAULT public.default_profession_id();
UPDATE public.worker_profiles SET profession_id = public.default_profession_id() WHERE profession_id IS NULL;

ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS profession_id uuid REFERENCES public.professions(id),
  ADD COLUMN IF NOT EXISTS pay_type text NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly', 'hourly', 'per_shift')),
  ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.job_postings ALTER COLUMN profession_id SET DEFAULT public.default_profession_id();
UPDATE public.job_postings SET profession_id = public.default_profession_id() WHERE profession_id IS NULL;
ALTER TABLE public.job_postings ALTER COLUMN profession_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_profiles_profession ON public.worker_profiles(profession_id);
CREATE INDEX IF NOT EXISTS idx_job_postings_profession ON public.job_postings(profession_id) WHERE active;

-- Server-side only (the API uses the service connection); no client access.
ALTER TABLE public.professions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profession_tags ENABLE ROW LEVEL SECURITY;
