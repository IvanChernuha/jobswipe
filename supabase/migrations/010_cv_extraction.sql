-- CV extraction status tracking on worker profiles
ALTER TABLE worker_profiles
    ADD COLUMN IF NOT EXISTS cv_extraction_status TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS cv_extracted_tag_count INT DEFAULT 0;

-- Index for querying workers by extraction status
CREATE INDEX IF NOT EXISTS idx_worker_profiles_cv_status ON worker_profiles(cv_extraction_status);
