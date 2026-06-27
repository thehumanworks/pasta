ALTER TABLE devices ADD COLUMN device_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_devices_account_expiry
  ON devices(account_id, device_expires_at);

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
