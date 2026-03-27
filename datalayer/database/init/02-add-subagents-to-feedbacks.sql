-- Migration: Add subagents column to feedbacks table.
-- Associates feedback entries with the subagent(s) that contributed to the response.
-- This is idempotent and safe to run on both new and existing databases.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'feedbacks' AND column_name = 'subagents'
    ) THEN
        ALTER TABLE feedbacks ADD COLUMN "subagents" TEXT[];
    END IF;
END $$;

-- Index for querying feedback by subagent
CREATE INDEX IF NOT EXISTS idx_feedbacks_subagents ON feedbacks USING GIN ("subagents");
