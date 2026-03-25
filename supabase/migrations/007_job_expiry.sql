-- Add expires_at column to job_postings (default 30 days from creation)
ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Set existing jobs to expire 30 days from their creation date
UPDATE public.job_postings
  SET expires_at = created_at + interval '30 days'
  WHERE expires_at IS NULL;

-- Make it NOT NULL with default for new jobs
ALTER TABLE public.job_postings
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '30 days');

-- Index for efficient feed filtering
CREATE INDEX IF NOT EXISTS idx_job_postings_expires_at ON public.job_postings(expires_at);
