-- D1 Migration: Add notebook functionality
-- Creates tables for notebook configurations and execution tracking

-- Notebook configurations table
CREATE TABLE IF NOT EXISTS notebook_configurations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    processing_period TEXT DEFAULT 'monthly' CHECK (processing_period IN ('daily', 'weekly', 'monthly')),
    steps TEXT NOT NULL, -- JSON: [{ id, label, query_template, ai_prompt, auto_run_ai }]
    variables TEXT DEFAULT '{}', -- JSON: { processing_month: "2024-01", client_id: "ABC" }
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Notebook execution sessions table
CREATE TABLE IF NOT EXISTS notebook_sessions (
    id TEXT PRIMARY KEY, -- UUID
    notebook_id INTEGER NOT NULL,
    processing_period TEXT NOT NULL, -- "2024-01" or "2024-01-15" depending on period type
    variables TEXT DEFAULT '{}', -- JSON: resolved variables for this session
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'paused')),
    FOREIGN KEY (notebook_id) REFERENCES notebook_configurations(id) ON DELETE CASCADE
);

-- Individual step execution results
CREATE TABLE IF NOT EXISTS notebook_step_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    step_id TEXT NOT NULL, -- matches step.id in notebook_configurations.steps JSON
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    query_executed TEXT, -- actual resolved query that was run
    query_result TEXT, -- JSON: DuckDB result data
    ai_analysis TEXT, -- AI analysis result if requested
    execution_time_ms INTEGER,
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'skipped', 'running')),
    error_message TEXT,
    FOREIGN KEY (session_id) REFERENCES notebook_sessions(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_notebook_configurations_name ON notebook_configurations(name);
CREATE INDEX IF NOT EXISTS idx_notebook_configurations_status ON notebook_configurations(status);
CREATE INDEX IF NOT EXISTS idx_notebook_sessions_notebook_id ON notebook_sessions(notebook_id);
CREATE INDEX IF NOT EXISTS idx_notebook_sessions_period ON notebook_sessions(processing_period);
CREATE INDEX IF NOT EXISTS idx_notebook_sessions_status ON notebook_sessions(status);
CREATE INDEX IF NOT EXISTS idx_notebook_step_runs_session_id ON notebook_step_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_notebook_step_runs_step_id ON notebook_step_runs(step_id);
CREATE INDEX IF NOT EXISTS idx_notebook_step_runs_status ON notebook_step_runs(status);