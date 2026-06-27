export const REGISTRY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  routing_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  reset_at INTEGER
);

CREATE TABLE IF NOT EXISTS devices (
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  verify_public_key TEXT NOT NULL,
  wrap_public_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  device_expires_at INTEGER,
  PRIMARY KEY (account_id, device_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_devices_account_status
  ON devices(account_id, status);

CREATE INDEX IF NOT EXISTS idx_devices_account_expiry
  ON devices(account_id, device_expires_at);

CREATE TABLE IF NOT EXISTS pairing_sessions (
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  short_code_hash TEXT NOT NULL UNIQUE,
  new_device_id TEXT NOT NULL,
  new_device_name TEXT NOT NULL,
  new_device_pubkeys_json TEXT NOT NULL,
  wrapped_group_key TEXT,
  key_version INTEGER,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER,
  approver_device_id TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pairing_account_expiry
  ON pairing_sessions(account_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_pairing_short_code_hash
  ON pairing_sessions(short_code_hash);

CREATE TABLE IF NOT EXISTS pairing_grants (
  grant_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  label TEXT,
  redeem_secret_hash TEXT NOT NULL UNIQUE,
  sealed_group_key TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  token_expires_at INTEGER NOT NULL,
  device_ttl_ms INTEGER,
  max_uses INTEGER NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_by_device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_redeemed_at INTEGER,
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pairing_grants_account_expiry
  ON pairing_grants(account_id, token_expires_at);

CREATE TABLE IF NOT EXISTS request_nonces (
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, device_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_request_nonces_expiry
  ON request_nonces(expires_at);
`;
