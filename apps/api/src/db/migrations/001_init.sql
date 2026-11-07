-- ShipLock schema v1. Timestamps are ISO-8601 UTC strings.

CREATE TABLE repositories (
  id INTEGER PRIMARY KEY,                -- GitHub numeric repository id (immutable)
  full_name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);
CREATE UNIQUE INDEX repositories_full_name ON repositories (full_name COLLATE NOCASE);

CREATE TABLE pull_requests (
  id TEXT PRIMARY KEY,
  repository_id INTEGER NOT NULL REFERENCES repositories (id),
  number INTEGER NOT NULL CHECK (number > 0),
  title TEXT NOT NULL,                   -- untrusted; display only
  html_url TEXT NOT NULL,
  author_login TEXT,
  base_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  merged INTEGER NOT NULL CHECK (merged IN (0, 1)),
  latest_head_sha TEXT NOT NULL CHECK (length(latest_head_sha) = 40),
  last_synced_at TEXT NOT NULL,
  UNIQUE (repository_id, number)
);

-- One review job per exact (repository, PR, head SHA, scanner version). Carries the release state.
CREATE TABLE review_jobs (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests (id),
  repository_id INTEGER NOT NULL REFERENCES repositories (id),
  repository TEXT NOT NULL,
  pull_number INTEGER NOT NULL,
  head_sha TEXT NOT NULL CHECK (length(head_sha) = 40),
  base_sha TEXT NOT NULL CHECK (length(base_sha) = 40),
  base_ref TEXT NOT NULL,
  scanner_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'discovered', 'review_pending', 'paid_review_confirmed', 'approval_pending', 'approved',
    'merge_in_progress', 'merged', 'review_blocked', 'denied', 'expired', 'stale', 'invalid',
    'failed', 'reconcile_required')),
  state_reason TEXT,
  diff_sha256 TEXT,
  local_report_sha256 TEXT,              -- ShipLock's own analysis of the same SHA-pinned diff
  local_report_json TEXT,
  local_conclusion TEXT CHECK (local_conclusion IN ('pass', 'block', 'inconclusive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (repository_id, pull_number, head_sha, scanner_version)
);
CREATE INDEX review_jobs_pr ON review_jobs (pull_request_id);

CREATE TABLE review_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_job_id TEXT NOT NULL REFERENCES review_jobs (id),
  source TEXT NOT NULL CHECK (source IN ('local', 'paid')),
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  file TEXT NOT NULL,
  line INTEGER,
  description TEXT NOT NULL,
  evidence TEXT
);
CREATE INDEX review_findings_job ON review_findings (review_job_id, source);

-- At most one accepted paid review per job; a transaction can never back two jobs.
CREATE TABLE payment_receipts (
  id TEXT PRIMARY KEY,
  review_job_id TEXT NOT NULL UNIQUE REFERENCES review_jobs (id),
  hedera_transaction_id TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  payer_account_id TEXT NOT NULL,
  merchant_account_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('live', 'test', 'simulated')),
  report_sha256 TEXT NOT NULL,
  report_json TEXT NOT NULL,
  ledger_verified_at TEXT,               -- independent mirror-node confirmation
  created_at TEXT NOT NULL
);

CREATE TABLE world_identities (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,                 -- server-only; never exported to HCS or logs
  environment TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  created_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);

-- Explicit link between a World identity and a GitHub account allowed to approve for a repo.
CREATE TABLE approver_links (
  id TEXT PRIMARY KEY,
  world_identity_id TEXT NOT NULL REFERENCES world_identities (id),
  repository_id INTEGER NOT NULL REFERENCES repositories (id),
  github_login TEXT NOT NULL,
  github_user_id INTEGER NOT NULL,
  github_permission TEXT NOT NULL,       -- observed at link time; rechecked before merge
  linked_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (world_identity_id, repository_id)
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,              -- sha256 of the cookie value
  csrf_token_hash TEXT NOT NULL,
  world_identity_id TEXT REFERENCES world_identities (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE merge_authorizations (
  id TEXT PRIMARY KEY,
  review_job_id TEXT NOT NULL REFERENCES review_jobs (id),
  operation_hash TEXT NOT NULL UNIQUE,
  operation_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'invalidated', 'consumed')),
  status_reason TEXT,
  world_identity_id TEXT REFERENCES world_identities (id),
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX merge_authorizations_one_open_per_job
  ON merge_authorizations (review_job_id) WHERE status IN ('pending', 'approved');

CREATE TABLE world_auth_attempts (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL REFERENCES merge_authorizations (id),
  session_id_hash TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL,
  pkce_verifier TEXT,                    -- server-only; cleared once the code is redeemed
  issuer TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'started', 'validated', 'denied', 'cancelled', 'expired', 'failed', 'identity_mismatch')),
  failure_reason TEXT,
  subject TEXT,
  acr TEXT,
  amr TEXT,
  auth_time INTEGER,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT
);

-- One execution per authorization: the UNIQUE constraint is the concurrency guard.
CREATE TABLE merge_attempts (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL UNIQUE REFERENCES merge_authorizations (id),
  review_job_id TEXT NOT NULL REFERENCES review_jobs (id),
  expected_sha TEXT NOT NULL CHECK (length(expected_sha) = 40),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'merged', 'blocked', 'failed', 'uncertain')),
  github_http_status INTEGER,
  merge_commit_sha TEXT,
  reason TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

-- Append-only. No tokens, identities or repository content in detail_json.
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  review_job_id TEXT,
  correlation_id TEXT,
  detail_json TEXT NOT NULL
);
CREATE INDEX audit_events_job ON audit_events (review_job_id, id);
