-- D1 Migration: Add sessions table for secure session management
-- This creates server-side session storage with proper expiration and invalidation

-- Sessions table for secure session management
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,  -- session ID (UUID)
    user_id INTEGER NOT NULL,
    user_data TEXT NOT NULL,  -- JSON with user info (id, username, role)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    user_agent TEXT,
    ip_address TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_is_active ON sessions(is_active);
CREATE INDEX idx_sessions_user_id_active ON sessions(user_id, is_active);

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_sessions_updated_at
    AFTER UPDATE ON sessions
    FOR EACH ROW
    BEGIN
        UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;