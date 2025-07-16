-- Create files table for R2 file metadata
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    r2_key TEXT NOT NULL UNIQUE,
    upload_time TEXT NOT NULL DEFAULT (datetime('now')),
    last_accessed TEXT,
    metadata TEXT, -- JSON field for custom properties
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create index for user file queries
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

-- Create index for r2_key lookups
CREATE INDEX IF NOT EXISTS idx_files_r2_key ON files(r2_key);