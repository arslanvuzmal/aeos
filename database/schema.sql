CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(100) PRIMARY KEY,
    title TEXT NOT NULL,
    specifications TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'backlog',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_tasks (
    task_id VARCHAR(100) PRIMARY KEY,
    project_id VARCHAR(100) REFERENCES projects(id) ON DELETE CASCADE,
    assigned_agent VARCHAR(50) NOT NULL, -- 'claude_planner', 'antigravity_coder', 'tester', 'debugger'
    step_status VARCHAR(50) DEFAULT 'idle', -- 'idle', 'in_progress', 'completed', 'blocked'
    dependencies TEXT, -- JSON array of task_ids
    task_payload TEXT, -- Detail markdown specifications
    agent_findings TEXT, -- Discovered syntax, files, and paths
    last_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id VARCHAR(100) REFERENCES agent_tasks(task_id) ON DELETE CASCADE,
    agent_role VARCHAR(50) NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    api_cost_usd NUMERIC(10, 6) DEFAULT 0.000000,
    latency_ms INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
