-- ─────────────────────────────────────────────
-- TAG REQUIREMENT TYPES
-- ─────────────────────────────────────────────
-- 'required'  = worker MUST have ALL of these
-- 'preferred' = worker MUST have at least ONE of these
-- 'nice'      = optional, only affects score (default / backward-compat)

CREATE TYPE tag_requirement_enum AS ENUM ('required', 'preferred', 'nice');

ALTER TABLE public.job_posting_tags
  ADD COLUMN requirement tag_requirement_enum NOT NULL DEFAULT 'nice';

-- Index for filtering
CREATE INDEX idx_job_posting_tags_req ON public.job_posting_tags(job_posting_id, requirement);
