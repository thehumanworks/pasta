import { DurableObject } from "cloudflare:workers";
import type { EncryptedClip, StoredClip } from "../shared/protocol";

export interface Env {
  DB: D1Database;
  CLIPBOARD: DurableObjectNamespace<ClipboardSpace>;
  BLOBS: R2Bucket;
}

export interface Actor {
  accountId: string;
  deviceId: string;
  routingId: string;
}

export interface WrappedKeyGrant {
  deviceId: string;
  keyVersion: number;
  wrappedGroupKey: string;
  createdAt: number;
}

interface ClipRow extends Record<string, SqlStorageValue> {
  seq: number;
  clip_id: string;
  origin_device_id: string;
  created_at: number;
  expires_at: number | null;
  payload_kind: string;
  mime: string;
  byte_len: number;
  key_version: number;
  nonce: string;
  aad_hash: string;
  inline_ciphertext: string;
  storage_kind: string;
  payload_id: string | null;
  r2_key: string | null;
  finalized_at: number | null;
}

export class ClipboardSpace extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initializeSchema();
    });
  }

  initSpace(): { ok: true } {
    this.initializeSchema();
    return { ok: true };
  }

  async publishClip(actor: Actor, clip: EncryptedClip): Promise<StoredClip> {
    this.initializeSchema();
    if (clip.payloadKind !== "text" && clip.payloadKind !== "image") {
      throw new Error("unsupported payload kind");
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO clips (
        clip_id, origin_device_id, created_at, expires_at, payload_kind, mime,
        byte_len, key_version, nonce, aad_hash, inline_ciphertext
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clip.clipId,
      actor.deviceId,
      clip.createdAt,
      clip.expiresAt,
      clip.payloadKind,
      clip.mime,
      clip.byteLen,
      clip.keyVersion,
      clip.nonce,
      clip.aadHash,
      clip.ciphertext
    );
    if (clip.expiresAt !== null) {
      await this.scheduleNextAlarm();
    }
    const row = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE clip_id = ?", clip.clipId)
      .toArray()[0];
    if (!row) throw new Error("clip insert failed");
    return rowToClip(row);
  }

  async publishR2Clip(actor: Actor, clip: EncryptedClip, payloadId: string): Promise<StoredClip> {
    this.initializeSchema();
    if (clip.payloadKind !== "file" && clip.payloadKind !== "image") {
      throw new Error("unsupported R2 payload kind");
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO clips (
        clip_id, origin_device_id, created_at, expires_at, payload_kind, mime,
        byte_len, key_version, nonce, aad_hash, inline_ciphertext, storage_kind,
        payload_id, r2_key, finalized_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'r2', ?, '', ?)`,
      clip.clipId,
      actor.deviceId,
      clip.createdAt,
      clip.expiresAt,
      clip.payloadKind,
      clip.mime,
      clip.byteLen,
      clip.keyVersion,
      clip.nonce,
      clip.aadHash,
      payloadId,
      Date.now()
    );
    const inserted = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE clip_id = ?", clip.clipId)
      .toArray()[0];
    if (!inserted) throw new Error("clip insert failed");
    const r2Key = `spaces/${actor.routingId}/clips/${inserted.seq}/${payloadId}`;
    this.ctx.storage.sql.exec("UPDATE clips SET r2_key = ? WHERE seq = ?", r2Key, inserted.seq);
    const row = this.ctx.storage.sql.exec<ClipRow>("SELECT * FROM clips WHERE seq = ?", inserted.seq).toArray()[0];
    if (!row) throw new Error("clip insert failed");
    return rowToClip(row);
  }

  async scheduleRetention(): Promise<{ ok: true }> {
    this.initializeSchema();
    await this.scheduleNextAlarm();
    return { ok: true };
  }

  deleteClip(actor: Actor, seq: number, clipId: string): { deleted: number } {
    this.initializeSchema();
    const row = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE seq = ? AND clip_id = ? LIMIT 1", seq, clipId)
      .toArray()[0];
    if (!row) return { deleted: 0 };
    if (row.origin_device_id !== actor.deviceId) {
      throw new Error("origin device mismatch");
    }
    this.ctx.storage.sql.exec("DELETE FROM clips WHERE seq = ? AND clip_id = ?", seq, clipId);
    return { deleted: 1 };
  }

  getLatest(_actor: Actor): StoredClip | null {
    this.initializeSchema();
    const row = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE expires_at IS NULL OR expires_at > ? ORDER BY seq DESC LIMIT 1", Date.now())
      .toArray()[0];
    return row ? rowToClip(row) : null;
  }

  listHistory(_actor: Actor, limit: number, beforeSeq: number | null): StoredClip[] {
    this.initializeSchema();
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const rows =
      beforeSeq === null
        ? this.ctx.storage.sql
            .exec<ClipRow>(
              "SELECT * FROM clips WHERE expires_at IS NULL OR expires_at > ? ORDER BY seq DESC LIMIT ?",
              Date.now(),
              boundedLimit
            )
            .toArray()
        : this.ctx.storage.sql
            .exec<ClipRow>(
              "SELECT * FROM clips WHERE seq < ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY seq DESC LIMIT ?",
              beforeSeq,
              Date.now(),
              boundedLimit
            )
            .toArray();
    return rows.map(rowToClip);
  }

  getClip(_actor: Actor, seq: number): StoredClip | null {
    this.initializeSchema();
    const row = this.ctx.storage.sql
      .exec<ClipRow>(
        "SELECT * FROM clips WHERE seq = ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
        seq,
        Date.now()
      )
      .toArray()[0];
    return row ? rowToClip(row) : null;
  }

  storeWrappedKey(_actor: Actor, grant: WrappedKeyGrant): { ok: true } {
    this.initializeSchema();
    this.ctx.storage.sql.exec(
      `INSERT INTO wrapped_keys (device_id, key_version, wrapped_group_key, created_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(device_id) DO UPDATE SET
         key_version = excluded.key_version,
         wrapped_group_key = excluded.wrapped_group_key,
         created_at = excluded.created_at,
         revoked_at = NULL`,
      grant.deviceId,
      grant.keyVersion,
      grant.wrappedGroupKey,
      grant.createdAt
    );
    return { ok: true };
  }

  revokeDevice(_actor: Actor, deviceId: string, revokedAt = Date.now()): { ok: true } {
    this.initializeSchema();
    this.ctx.storage.sql.exec("UPDATE wrapped_keys SET revoked_at = ? WHERE device_id = ?", revokedAt, deviceId);
    return { ok: true };
  }

  async cleanupExpired(now = Date.now()): Promise<{ deletedClips: number; deletedObjects: number }> {
    this.initializeSchema();
    const expiredRows = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE expires_at IS NOT NULL AND expires_at <= ?", now)
      .toArray();
    let deletedObjects = 0;
    for (const row of expiredRows) {
      if (row.r2_key) {
        await this.env.BLOBS.delete(row.r2_key);
        deletedObjects += 1;
      }
    }
    this.ctx.storage.sql.exec("DELETE FROM clips WHERE expires_at IS NOT NULL AND expires_at <= ?", now);
    await this.scheduleNextAlarm();
    return { deletedClips: expiredRows.length, deletedObjects };
  }

  async alarm(): Promise<void> {
    await this.cleanupExpired(Date.now());
  }

  async runRetention(now = Date.now()): Promise<{ deletedClips: number; deletedObjects: number }> {
    return this.cleanupExpired(now);
  }

  debugDump(): { clips: StoredClip[]; wrappedKeys: Array<Record<string, SqlStorageValue>> } {
    this.initializeSchema();
    return {
      clips: this.ctx.storage.sql.exec<ClipRow>("SELECT * FROM clips ORDER BY seq ASC").toArray().map(rowToClip),
      wrappedKeys: this.ctx.storage.sql.exec<Record<string, SqlStorageValue>>("SELECT * FROM wrapped_keys ORDER BY device_id ASC").toArray()
    };
  }

  private initializeSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS clips (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        clip_id TEXT NOT NULL UNIQUE,
        origin_device_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        payload_kind TEXT NOT NULL,
        mime TEXT NOT NULL,
        byte_len INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        nonce TEXT NOT NULL,
        aad_hash TEXT NOT NULL,
        inline_ciphertext TEXT NOT NULL,
        storage_kind TEXT NOT NULL DEFAULT 'inline',
        payload_id TEXT,
        r2_key TEXT,
        finalized_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at);
      CREATE INDEX IF NOT EXISTS idx_clips_expires_at ON clips(expires_at);
      CREATE TABLE IF NOT EXISTS wrapped_keys (
        device_id TEXT PRIMARY KEY,
        key_version INTEGER NOT NULL,
        wrapped_group_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
    `);
    this.addColumnIfMissing("clips", "storage_kind", "TEXT NOT NULL DEFAULT 'inline'");
    this.addColumnIfMissing("clips", "payload_id", "TEXT");
    this.addColumnIfMissing("clips", "r2_key", "TEXT");
    this.addColumnIfMissing("clips", "finalized_at", "INTEGER");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists.
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    const nextExpiry = this.ctx.storage.sql
      .exec<{ expires_at: number }>(
        "SELECT expires_at FROM clips WHERE expires_at IS NOT NULL ORDER BY expires_at ASC LIMIT 1"
      )
      .toArray()[0]?.expires_at;
    if (nextExpiry) {
      const now = Date.now();
      await this.ctx.storage.setAlarm(nextExpiry <= now ? now - 1 : nextExpiry);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }
}

function rowToClip(row: ClipRow): StoredClip {
  const clip: StoredClip = {
    seq: row.seq,
    clipId: row.clip_id,
    originDeviceId: row.origin_device_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    payloadKind: row.payload_kind as StoredClip["payloadKind"],
    mime: row.mime,
    byteLen: row.byte_len,
    keyVersion: row.key_version,
    nonce: row.nonce,
    aadHash: row.aad_hash,
    ciphertext: row.inline_ciphertext,
    storageKind: row.storage_kind === "r2" ? "r2" : "inline"
  };
  if (row.payload_id !== null) clip.payloadId = row.payload_id;
  if (row.r2_key !== null) clip.r2Key = row.r2_key;
  return clip;
}
