CREATE TABLE episode_unlocks (
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (child_id, video_id)
);

INSERT OR IGNORE INTO episode_unlocks (child_id, video_id, unlocked_at)
SELECT child_id, video_id, MIN(claimed_at) FROM episode_claims GROUP BY child_id, video_id;

-- Older daily claims were pruned. Recover confirmed cartoon playback still
-- present in retained viewing records, without unlocking ordinary videos.
INSERT OR IGNORE INTO episode_unlocks (child_id, video_id, unlocked_at)
SELECT child_id, video_id, MIN(authorized_at) FROM viewing_events
WHERE usage_bucket = 'cartoon' GROUP BY child_id, video_id;

-- The credit debit and permanent unlock commit in the same SQLite statement.
CREATE TRIGGER episode_claim_unlock AFTER INSERT ON episode_claims BEGIN
  INSERT OR IGNORE INTO episode_unlocks (child_id, video_id, unlocked_at)
  VALUES (NEW.child_id, NEW.video_id, NEW.claimed_at);
END;
