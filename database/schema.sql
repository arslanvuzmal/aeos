CREATE TABLE IF NOT EXISTS institutions (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    institution_id UUID REFERENCES institutions(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    specifications TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'backlog',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    assigned_agent VARCHAR(50) NOT NULL,
    task_instruction TEXT NOT NULL,
    step_status VARCHAR(50) DEFAULT 'idle',
    dependencies JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_telemetry (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID REFERENCES agent_tasks(id) ON DELETE CASCADE,
    trace_id UUID NOT NULL,
    agent_thought TEXT,
    tool_calls JSONB,
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    cost_usd NUMERIC(10, 6) DEFAULT 0.000000,
    execution_time_ms INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
