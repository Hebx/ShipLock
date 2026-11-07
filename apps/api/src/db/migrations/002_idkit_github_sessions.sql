-- ShipLock schema v2: World Agent Pass OIDC tables are replaced by World IDKit 4.0 enrollment,
-- per-proof replay protection and GitHub OAuth maintainer sessions.
-- World nullifiers are stored as canonical TEXT (`nil_` + 64 lowercase hex) because SQLite has
-- no 256-bit integer type; canonicalization makes hex/decimal encodings of one value collide.
-- Agent Pass leaf tables. They never held a completed authorization.
DROP TABLE world_auth_attempts;
DROP TABLE approver_links;
DROP TABLE sessions;

-- Browser-bound GitHub OAuth `state`, single use.
CREATE TABLE github_oauth_states (
  state_hash TEXT PRIMARY KEY,           -- sha256 of the state value
  browser_hash TEXT NOT NULL,            -- sha256 of the pre-login browser cookie
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

-- Maintainer sessions. Authenticated by GitHub only; World proofs never create a session.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,              -- sha256 of the cookie value
  csrf_token_hash TEXT NOT NULL,
  github_user_id INTEGER NOT NULL,       -- numeric id is the identity; login is display only
  github_login TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user ON sessions (github_user_id);

-- One World ID enrollment <=> one GitHub user. Re-linking is an explicit operator action, never an upsert.
CREATE TABLE world_enrollments (
  id TEXT PRIMARY KEY,
  github_user_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'staging')),
  rp_id TEXT NOT NULL,
  enroll_action TEXT NOT NULL,
  nullifier TEXT NOT NULL CHECK (length(nullifier) = 68 AND substr(nullifier, 1, 4) = 'nil_'),
  session_id TEXT NOT NULL UNIQUE,       -- World session_<hex>; server-only, never exported
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (environment, rp_id, enroll_action, nullifier)
);

-- Rebuild merge_authorizations without the Agent Pass identity column, together with its only
-- child table merge_attempts. Legacy rows are kept but can no longer be approved or executed.
ALTER TABLE merge_attempts RENAME TO merge_attempts_v1;
ALTER TABLE merge_authorizations RENAME TO merge_authorizations_v1;
DROP INDEX merge_authorizations_one_open_per_job;
CREATE TABLE merge_authorizations (
  id TEXT PRIMARY KEY,
  review_job_id TEXT NOT NULL REFERENCES review_jobs (id),
  operation_hash TEXT NOT NULL UNIQUE,
  operation_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'invalidated', 'consumed')),
  status_reason TEXT,
  github_user_id INTEGER,                -- approver; NOT NULL for every authorization created by v2 code
  github_login TEXT,
  world_enrollment_id TEXT REFERENCES world_enrollments (id),
  world_environment TEXT CHECK (world_environment IN ('production', 'staging')),
  session_id_hash TEXT,                  -- browser session that requested it
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO merge_authorizations (id, review_job_id, operation_hash, operation_json, status, status_reason, expires_at, approved_at, consumed_at, created_at, updated_at)
  SELECT id, review_job_id, operation_hash, operation_json,
         CASE WHEN status IN ('pending', 'approved') THEN 'invalidated' ELSE status END,
         CASE WHEN status IN ('pending', 'approved') THEN 'retired by migration 002 (Agent Pass)' ELSE status_reason END,
         expires_at, approved_at, consumed_at, created_at, updated_at
  FROM merge_authorizations_v1;
CREATE UNIQUE INDEX merge_authorizations_one_open_per_job
  ON merge_authorizations (review_job_id) WHERE status IN ('pending', 'approved');

-- One execution per authorization: the UNIQUE constraint is the concurrency guard.
CREATE TABLE merge_attempts (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE REFERENCES merge_authorizations (id),
  review_job_id TEXT NOT NULL REFERENCES review_jobs (id),
  expected_sha TEXT NOT NULL CHECK (length(expected_sha) = 40),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'merged', 'blocked', 'failed', 'uncertain')),
  github_http_status INTEGER,
  merge_commit_sha TEXT,
  merge_url TEXT,
  reason TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
INSERT INTO merge_attempts (id, authorization_id, review_job_id, expected_sha, status, github_http_status, merge_commit_sha, reason, started_at, completed_at)
  SELECT id, authorization_id, review_job_id, expected_sha, status, github_http_status, merge_commit_sha, reason, started_at, completed_at
  FROM merge_attempts_v1;
DROP TABLE merge_attempts_v1;
DROP TABLE merge_authorizations_v1;

DROP TABLE world_identities;

-- Every RP signature ShipLock issues. The nonce is single use and bound to one purpose,
-- one browser session, one GitHub user and (for approvals) one authorization.
CREATE TABLE world_proof_requests (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('enroll', 'approve')),
  rp_nonce TEXT NOT NULL UNIQUE,         -- lowercase 0x-hex as signed
  session_id_hash TEXT NOT NULL,
  github_user_id INTEGER NOT NULL,
  authorization_id TEXT REFERENCES merge_authorizations (id),
  action TEXT,                           -- enrollment action; NULL for session proofs
  expected_signal TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued', 'verified', 'rejected', 'cancelled')),
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK ((purpose = 'approve') = (authorization_id IS NOT NULL))
);

-- Replay protection for session proofs: each accepted session_nullifier[0] is used once.
CREATE TABLE world_session_nullifiers (
  nullifier TEXT PRIMARY KEY CHECK (length(nullifier) = 68 AND substr(nullifier, 1, 4) = 'nil_'),
  world_enrollment_id TEXT NOT NULL REFERENCES world_enrollments (id),
  authorization_id TEXT NOT NULL REFERENCES merge_authorizations (id),
  created_at TEXT NOT NULL
);
