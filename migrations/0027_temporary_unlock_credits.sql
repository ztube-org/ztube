-- One row grants one additional Unlock Credit for the Child's Viewing Day.
-- A stable request ID makes a retried grant safe after a lost HTTP response.
CREATE TABLE episode_credit_grants (
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  viewing_day TEXT NOT NULL,
  granted_by INTEGER REFERENCES children(id) ON DELETE SET NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (child_id, request_id)
);
CREATE INDEX episode_credit_grants_day ON episode_credit_grants(child_id, viewing_day);
