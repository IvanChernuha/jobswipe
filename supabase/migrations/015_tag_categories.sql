-- Profession layer, part 1: tag categories beyond tech, so other professions'
-- needs are ordinary tags that the existing required/preferred matching
-- already handles (docs/worklog/profession-layer.md §4.1).
--   spoken_language: Hebrew, Arabic, Russian, English, Amharic
--   license:         RN licence, plumbing licence, forklift, driving B/C
--   shift:           mornings, nights, weekends
-- (The existing `language` category stays: programming languages.)
ALTER TYPE tag_category_enum ADD VALUE IF NOT EXISTS 'spoken_language';
ALTER TYPE tag_category_enum ADD VALUE IF NOT EXISTS 'license';
ALTER TYPE tag_category_enum ADD VALUE IF NOT EXISTS 'shift';
