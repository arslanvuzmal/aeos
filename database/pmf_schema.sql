-- ============================================================================
-- AEOS PMF-Aware Database Schema (PostgreSQL 15+)
-- File: database/pmf_schema.sql
-- Subsystem: Dan Olsen PMF Pyramid & Problem Space vs Solution Space Tracking
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Projects Table Alignment (Problem Space & Customer Needs)
-- ----------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_slug TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_importance INTEGER CHECK (customer_importance BETWEEN 1 AND 10);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_satisfaction INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT CHECK (status IN ('discovery', 'planning', 'mvp_exec', 'completed'));

UPDATE projects SET project_slug = COALESCE(project_slug, name) WHERE project_slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(project_slug);

-- ----------------------------------------------------------------------------
-- 2. Agent Tasks Table Alignment (Feature Chunks & Kano Classification)
-- ----------------------------------------------------------------------------
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS agent_name TEXT;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS task_type TEXT CHECK (task_type IN ('must-have', 'performance', 'delighter'));
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS token_budget INTEGER;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS tokens_used INTEGER DEFAULT 0;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'queued';

UPDATE agent_tasks SET agent_name = COALESCE(agent_name, assigned_agent) WHERE agent_name IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Execution Ledger (State Attestation & Problem Space vs Solution Space Logs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS execution_ledger (
    id SERIAL PRIMARY KEY,
    task_id UUID REFERENCES agent_tasks(id) ON DELETE CASCADE,
    state_hash TEXT NOT NULL, -- SHA-256 Plan Attestation
    problem_space_notes TEXT, -- The "What" (Customer need & requirement definition)
    solution_space_logs JSONB, -- The "How" (Model generated code & execution traces)
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_exec_ledger_task_id ON execution_ledger(task_id);
CREATE INDEX IF NOT EXISTS idx_exec_ledger_state_hash ON execution_ledger(state_hash);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_type ON agent_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
