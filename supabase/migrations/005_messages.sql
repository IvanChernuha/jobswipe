-- 005_messages.sql — In-app chat messages between matched users

CREATE TABLE IF NOT EXISTS public.messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id    uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    sender_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    body        text NOT NULL CHECK (char_length(body) > 0 AND char_length(body) <= 5000),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index for fast "get messages for a match" queries (ordered by time)
CREATE INDEX idx_messages_match_created ON public.messages(match_id, created_at);

-- Index for "unread count" queries per sender
CREATE INDEX idx_messages_sender ON public.messages(sender_id);

-- Read-tracking: last time each user read a given match's chat
CREATE TABLE IF NOT EXISTS public.message_read_cursors (
    match_id    uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    last_read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (match_id, user_id)
);

-- RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_read_cursors ENABLE ROW LEVEL SECURITY;

-- Messages: only participants of the match can read/write
CREATE POLICY messages_select ON public.messages FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = messages.match_id
          AND (m.worker_id = auth.uid() OR m.employer_id = auth.uid())
    )
);

CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = messages.match_id
          AND (m.worker_id = auth.uid() OR m.employer_id = auth.uid())
    )
);

-- Read cursors: only the owning user
CREATE POLICY cursors_select ON public.message_read_cursors FOR SELECT USING (user_id = auth.uid());
CREATE POLICY cursors_upsert ON public.message_read_cursors FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY cursors_update ON public.message_read_cursors FOR UPDATE USING (user_id = auth.uid());
