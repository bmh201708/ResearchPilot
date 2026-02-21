CREATE TABLE IF NOT EXISTS paper_likes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_paper_likes_user_id
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_paper_likes_paper_id
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
  CONSTRAINT uq_paper_likes_user_paper UNIQUE (user_id, paper_id)
);

CREATE INDEX IF NOT EXISTS idx_paper_likes_user_created_at
  ON paper_likes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paper_likes_paper_id
  ON paper_likes (paper_id);
