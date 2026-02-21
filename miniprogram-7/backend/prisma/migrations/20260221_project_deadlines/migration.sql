CREATE TABLE IF NOT EXISTS project_deadlines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  abbr TEXT NOT NULL,
  full_name TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  start_date DATE,
  deadline DATE NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  color_theme TEXT NOT NULL DEFAULT 'green',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_project_deadlines_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_project_deadlines_progress
    CHECK (progress >= 0 AND progress <= 100),
  CONSTRAINT chk_project_deadlines_color_theme
    CHECK (color_theme IN ('green', 'purple', 'yellow', 'blue', 'orange')),
  CONSTRAINT uq_project_deadlines_user_abbr_deadline
    UNIQUE (user_id, abbr, deadline)
);

CREATE INDEX IF NOT EXISTS idx_project_deadlines_user_deadline
  ON project_deadlines (user_id, deadline);
