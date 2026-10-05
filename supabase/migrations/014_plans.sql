-- Plans: Free vs Pro for employers, granted (for now) only through promo
-- codes the founder hands out. Billing comes later and will write the same
-- pro_grants rows. Additive only.

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,              -- stored upper-case
  duration_days int NULL CHECK (duration_days IS NULL OR duration_days > 0),  -- NULL = Pro forever
  max_uses     int NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses         int NOT NULL DEFAULT 0,
  redeem_by    timestamptz NULL,                  -- code stops working after this
  note         text NOT NULL DEFAULT '',
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz DEFAULT now()
);

-- One row per period of Pro. Belongs to an organization when the employer is
-- in one (the whole team shares the plan), otherwise to the solo employer.
CREATE TABLE IF NOT EXISTS public.pro_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  text NOT NULL CHECK (subject_type IN ('org', 'user')),
  subject_id    uuid NOT NULL,
  source        text NOT NULL DEFAULT 'code' CHECK (source IN ('code', 'admin', 'billing')),
  promo_code_id uuid NULL REFERENCES public.promo_codes(id) ON DELETE SET NULL,
  redeemed_by   uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz NULL,                 -- NULL = forever
  created_at    timestamptz DEFAULT now(),
  UNIQUE (subject_type, subject_id, promo_code_id)
);
CREATE INDEX IF NOT EXISTS idx_pro_grants_subject ON public.pro_grants(subject_type, subject_id);

-- Server-side only (the API uses the service connection); no client access.
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_grants ENABLE ROW LEVEL SECURITY;
