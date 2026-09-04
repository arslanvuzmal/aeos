-- AEOS Multi-Tenant Architecture & Telemetry Ledger
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    git_repo_url TEXT,
    workspace_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_project UNIQUE (tenant_id, name)
);

CREATE TYPE agent_role_enum AS ENUM ('planner', 'coder', 'qa_tester', 'debugger');

CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    role agent_role_enum NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE task_status_enum AS ENUM ('pending', 'in_progress', 'blocked', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    assigned_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    phase_order INT NOT NULL DEFAULT 1,
    status task_status_enum DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS agent_turns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    turn_number INT NOT NULL,
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    cached_tokens INT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    execution_duration_ms INT NOT NULL,
    cpu_usage_pct REAL,
    memory_usage_bytes BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tool_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id UUID NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    tool_name VARCHAR(150) NOT NULL,
    input_payload JSONB NOT NULL,
    output_payload JSONB,
    is_error BOOLEAN DEFAULT FALSE,
    duration_ms INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_attestations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    sha256_hash CHAR(64) NOT NULL,
    attested_by VARCHAR(100) NOT NULL,
    is_valid BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opik_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    turn_id UUID NOT NULL REFERENCES agent_turns(id) ON DELETE CASCADE,
    opik_trace_id VARCHAR(128) NOT NULL,
    opik_span_id VARCHAR(128) NOT NULL,
    project_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_turns_task ON agent_turns(task_id);
CREATE INDEX IF NOT EXISTS idx_tools_turn ON tool_executions(turn_id);
CREATE INDEX IF NOT EXISTS idx_attest_proj ON plan_attestations(project_id, is_valid);
CREATE INDEX IF NOT EXISTS idx_opik_trace ON opik_traces(opik_trace_id);

CREATE OR REPLACE VIEW v_project_spend_analytics AS
SELECT 
    p.id AS project_id,
    p.name AS project_name,
    COUNT(DISTINCT t.id) AS total_tasks,
    COUNT(DISTINCT at.id) AS total_turns,
    SUM(COALESCE(at.prompt_tokens, 0)) AS aggregate_prompt_tokens,
    SUM(COALESCE(at.completion_tokens, 0)) AS aggregate_completion_tokens,
    SUM(COALESCE(at.cost_usd, 0.0)) AS total_cost_usd,
    AVG(COALESCE(at.execution_duration_ms, 0)) AS avg_turn_latency_ms
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
LEFT JOIN agent_turns at ON at.task_id = t.id
GROUP BY p.id, p.name;

-- Multi-Tenant Agent State & Institutional Telemetry Extensions
CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    assigned_agent VARCHAR(50) NOT NULL, -- 'planner', 'coder', 'tester', 'debugger'
    task_instruction TEXT NOT NULL,
    step_status VARCHAR(50) DEFAULT 'idle', -- 'idle', 'in_progress', 'completed', 'blocked'
    dependencies JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_telemetry (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID REFERENCES agent_tasks(id) ON DELETE CASCADE,
    trace_id UUID NOT NULL DEFAULT gen_random_uuid(),
    agent_thought TEXT,
    tool_calls JSONB,
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    cost_usd NUMERIC(10, 6) DEFAULT 0.000000,
    execution_time_ms INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

