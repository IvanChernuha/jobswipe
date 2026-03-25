-- 006_organizations.sql — Multi-user employer teams

-- Organization role enum
CREATE TYPE org_role AS ENUM ('owner', 'admin', 'manager', 'viewer');

-- Organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Organization members
CREATE TABLE IF NOT EXISTS public.org_members (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role        org_role NOT NULL DEFAULT 'viewer',
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(org_id, user_id)
);

CREATE INDEX idx_org_members_org ON public.org_members(org_id);
CREATE INDEX idx_org_members_user ON public.org_members(user_id);

-- Link employer_profiles to organizations
ALTER TABLE public.employer_profiles
    ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- Invite tokens for joining an org
CREATE TABLE IF NOT EXISTS public.org_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email       text NOT NULL,
    role        org_role NOT NULL DEFAULT 'viewer',
    token       text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    used        boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days'
);

CREATE INDEX idx_org_invites_token ON public.org_invites(token);

-- Permission definitions (which role can do what)
-- Stored in code, not DB. Here's the reference:
-- owner:   all actions + delete org + transfer ownership
-- admin:   manage members + all job/match/chat actions
-- manager: create/edit/toggle jobs + chat with matches + view
-- viewer:  read-only (view jobs, matches, stats)

-- RLS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

-- Org: members can read their own org
CREATE POLICY org_select ON public.organizations FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = id AND m.user_id = auth.uid())
);
CREATE POLICY org_insert ON public.organizations FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY org_update ON public.organizations FOR UPDATE USING (owner_id = auth.uid());

-- Members: org members can see fellow members
CREATE POLICY members_select ON public.org_members FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.org_members me WHERE me.org_id = org_members.org_id AND me.user_id = auth.uid())
);

-- Invites: only org admins+ can see/create
CREATE POLICY invites_select ON public.org_invites FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.org_members m
        WHERE m.org_id = org_invites.org_id AND m.user_id = auth.uid()
          AND m.role IN ('owner', 'admin')
    )
);
