-- JobSwipe: Initial Schema
-- Run this in Supabase SQL editor or via supabase db push

-- Enable pgvector for AI skill matching
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- USERS (mirrors Supabase auth.users, adds role)
-- ─────────────────────────────────────────────
CREATE TABLE public.users (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('worker', 'employer')),
  created_at  timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- WORKER PROFILES
-- ─────────────────────────────────────────────
CREATE TABLE public.worker_profiles (
  user_id          uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT '',
  bio              text DEFAULT '',
  location         text DEFAULT '',
  skills           text[] DEFAULT '{}',
  experience_years int DEFAULT 0,
  resume_url       text DEFAULT '',
  avatar_url       text DEFAULT '',
  embedding        vector(1536),          -- pgvector: OpenAI skill embedding
  updated_at       timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- EMPLOYER PROFILES
-- ─────────────────────────────────────────────
CREATE TABLE public.employer_profiles (
  user_id      uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  company_name text NOT NULL DEFAULT '',
  description  text DEFAULT '',
  industry     text DEFAULT '',
  location     text DEFAULT '',
  logo_url     text DEFAULT '',
  updated_at   timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- JOB POSTINGS
-- ─────────────────────────────────────────────
CREATE TABLE public.job_postings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title            text NOT NULL,
  description      text DEFAULT '',
  skills_required  text[] DEFAULT '{}',
  salary_min       int DEFAULT 0,
  salary_max       int DEFAULT 0,
  location         text DEFAULT '',
  remote           boolean DEFAULT false,
  active           boolean DEFAULT true,
  embedding        vector(1536),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────
-- SWIPES
-- ─────────────────────────────────────────────
CREATE TYPE swiper_type_enum AS ENUM ('worker', 'employer');
CREATE TYPE swipe_direction_enum AS ENUM ('like', 'pass');

CREATE TABLE public.swipes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swiper_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  swiper_type  swiper_type_enum NOT NULL,
  target_id    uuid NOT NULL,              -- worker profile user_id OR job_posting id
  direction    swipe_direction_enum NOT NULL,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (swiper_id, target_id)            -- one swipe per pair
);

CREATE INDEX idx_swipes_swiper ON public.swipes(swiper_id);
CREATE INDEX idx_swipes_target ON public.swipes(target_id);

-- ─────────────────────────────────────────────
-- MATCHES
-- ─────────────────────────────────────────────
CREATE TYPE match_status_enum AS ENUM ('active', 'archived');

CREATE TABLE public.matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employer_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  job_posting_id uuid REFERENCES public.job_postings(id) ON DELETE SET NULL,
  status         match_status_enum DEFAULT 'active',
  matched_at     timestamptz DEFAULT now(),
  UNIQUE (worker_id, employer_id, job_posting_id)
);

CREATE INDEX idx_matches_worker   ON public.matches(worker_id);
CREATE INDEX idx_matches_employer ON public.matches(employer_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_postings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches          ENABLE ROW LEVEL SECURITY;

-- users: anyone can read (for feed), only self can update
CREATE POLICY "users_read_all"    ON public.users FOR SELECT USING (true);
CREATE POLICY "users_insert_self" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_self" ON public.users FOR UPDATE USING (auth.uid() = id);

-- worker_profiles: anyone authenticated can read (feed), only owner can write
CREATE POLICY "worker_profiles_read"   ON public.worker_profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "worker_profiles_write"  ON public.worker_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "worker_profiles_update" ON public.worker_profiles FOR UPDATE USING (auth.uid() = user_id);

-- employer_profiles
CREATE POLICY "employer_profiles_read"   ON public.employer_profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "employer_profiles_write"  ON public.employer_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "employer_profiles_update" ON public.employer_profiles FOR UPDATE USING (auth.uid() = user_id);

-- job_postings: anyone authenticated can read, only employer-owner can write
CREATE POLICY "job_postings_read"   ON public.job_postings FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "job_postings_insert" ON public.job_postings FOR INSERT WITH CHECK (auth.uid() = employer_id);
CREATE POLICY "job_postings_update" ON public.job_postings FOR UPDATE USING (auth.uid() = employer_id);
CREATE POLICY "job_postings_delete" ON public.job_postings FOR DELETE USING (auth.uid() = employer_id);

-- swipes: only owner can read/write their own swipes
CREATE POLICY "swipes_own" ON public.swipes FOR ALL USING (auth.uid() = swiper_id);

-- matches: both worker and employer can read their match
CREATE POLICY "matches_read" ON public.matches FOR SELECT
  USING (auth.uid() = worker_id OR auth.uid() = employer_id);
CREATE POLICY "matches_insert" ON public.matches FOR INSERT
  WITH CHECK (auth.uid() = worker_id OR auth.uid() = employer_id);

-- ─────────────────────────────────────────────
-- STORAGE BUCKETS (run via Supabase dashboard or CLI)
-- ─────────────────────────────────────────────
-- supabase storage create avatars --public
-- supabase storage create resumes  (private)

-- ─────────────────────────────────────────────────────────────
-- TRIGGER: auto-create public.users when a new auth user signs up
-- (handles the case where Register.tsx calls supabase.auth.signUp directly)
-- Role is read from user_metadata.role set by the frontend during sign-up.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  -- Read role from user_metadata (set by frontend signUp options.data.role)
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'worker');
  IF v_role NOT IN ('worker', 'employer') THEN
    v_role := 'worker';
  END IF;

  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;

  -- Create empty profile row so upserts from onboarding always succeed
  IF v_role = 'worker' THEN
    INSERT INTO public.worker_profiles (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    INSERT INTO public.employer_profiles (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
