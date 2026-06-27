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
  metadata_nonce: string | null;
  metadata_ciphertext: string | null;
}

const CLIPS_SCHEMA_VERSION = "2";

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
    const seq = this.nextSeq();
    this.ctx.storage.sql.exec(
      `INSERT INTO clips (
        clip_id, seq, origin_device_id, created_at, expires_at, payload_kind, mime,
        byte_len, key_version, nonce, aad_hash, inline_ciphertext,
        metadata_nonce, metadata_ciphertext
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clip.clipId,
      seq,
      actor.deviceId,
      clip.createdAt,
      clip.expiresAt,
      clip.payloadKind,
      clip.mime,
      clip.byteLen,
      clip.keyVersion,
      clip.nonce,
      clip.aadHash,
      clip.ciphertext,
      clip.metadata?.nonce ?? null,
      clip.metadata?.ciphertext ?? null
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
    const seq = this.nextSeq();
    const r2Key = `spaces/${actor.routingId}/clips/${clip.clipId}/${payloadId}`;
    this.ctx.storage.sql.exec(
      `INSERT INTO clips (
        clip_id, seq, origin_device_id, created_at, expires_at, payload_kind, mime,
        byte_len, key_version, nonce, aad_hash, inline_ciphertext, storage_kind,
        payload_id, r2_key, finalized_at, metadata_nonce, metadata_ciphertext
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'r2', ?, ?, ?, ?, ?)`,
      clip.clipId,
      seq,
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
      r2Key,
      Date.now(),
      clip.metadata?.nonce ?? null,
      clip.metadata?.ciphertext ?? null
    );
    const row = this.ctx.storage.sql.exec<ClipRow>("SELECT * FROM clips WHERE clip_id = ?", clip.clipId).toArray()[0];
    if (!row) throw new Error("clip insert failed");
    return rowToClip(row);
  }

  async scheduleRetention(): Promise<{ ok: true }> {
    this.initializeSchema();
    await this.scheduleNextAlarm();
    return { ok: true };
  }

  deleteClip(actor: Actor, clipId: string): { deleted: number } {
    this.initializeSchema();
    const row = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE clip_id = ? LIMIT 1", clipId)
      .toArray()[0];
    if (!row) return { deleted: 0 };
    if (row.origin_device_id !== actor.deviceId) {
      throw new Error("origin device mismatch");
    }
    this.ctx.storage.sql.exec("DELETE FROM clips WHERE clip_id = ?", clipId);
    this.renumberClips();
    return { deleted: 1 };
  }

  async deleteHistoryClip(_actor: Actor, clipId: string): Promise<{ deleted: number; deletedObjects: number }> {
    this.initializeSchema();
    const row = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE clip_id = ? LIMIT 1", clipId)
      .toArray()[0];
    if (!row) return { deleted: 0, deletedObjects: 0 };
    let deletedObjects = 0;
    if (row.r2_key) {
      await this.env.BLOBS.delete(row.r2_key);
      deletedObjects = 1;
    }
    this.ctx.storage.sql.exec("DELETE FROM clips WHERE clip_id = ?", clipId);
    this.renumberClips();
    await this.scheduleNextAlarm();
    return { deleted: 1, deletedObjects };
  }

  async getLatest(_actor: Actor): Promise<StoredClip | null> {
    this.initializeSchema();
    await this.cleanupExpired(Date.now());
    const row = this.ctx.storage.sql
      .exec<ClipRow>("SELECT * FROM clips WHERE expires_at IS NULL OR expires_at > ? ORDER BY seq DESC LIMIT 1", Date.now())
      .toArray()[0];
    return row ? rowToClip(row) : null;
  }

  async listHistory(_actor: Actor, limit: number, beforeClipId: string | null): Promise<StoredClip[]> {
    this.initializeSchema();
    await this.cleanupExpired(Date.now());
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const beforeSeq = beforeClipId
      ? this.ctx.storage.sql
          .exec<Pick<ClipRow, "seq">>("SELECT seq FROM clips WHERE clip_id = ? LIMIT 1", beforeClipId)
          .toArray()[0]?.seq ?? null
      : null;
    if (beforeClipId && beforeSeq === null) return [];
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

  async getClip(_actor: Actor, clipId: string): Promise<StoredClip | null> {
    this.initializeSchema();
    await this.cleanupExpired(Date.now());
    const row = this.ctx.storage.sql
      .exec<ClipRow>(
        "SELECT * FROM clips WHERE clip_id = ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1",
        clipId,
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
    if (expiredRows.length > 0) {
      this.renumberClips();
    }
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
    `);
    const schemaVersion = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version' LIMIT 1")
      .toArray()[0]?.value ?? null;
    if (schemaVersion !== CLIPS_SCHEMA_VERSION) {
      this.ctx.storage.sql.exec("DROP TABLE IF EXISTS clips");
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", CLIPS_SCHEMA_VERSION);
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS clips (
        clip_id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL UNIQUE,
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
        finalized_at INTEGER,
        metadata_nonce TEXT,
        metadata_ciphertext TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_clips_seq ON clips(seq);
      CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at);
      CREATE INDEX IF NOT EXISTS idx_clips_expires_at ON clips(expires_at);
      CREATE TABLE IF NOT EXISTS wrapped_keys (
        device_id TEXT PRIMARY KEY,
        key_version INTEGER NOT NULL,
        wrapped_group_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
    `);
  }

  private nextSeq(): number {
    return this.ctx.storage.sql
      .exec<{ next_seq: number }>("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM clips")
      .toArray()[0]?.next_seq ?? 1;
  }

  private renumberClips(): void {
    const rows = this.ctx.storage.sql
      .exec<Pick<ClipRow, "clip_id">>("SELECT clip_id FROM clips ORDER BY seq ASC")
      .toArray();
    for (let index = 0; index < rows.length; index += 1) {
      this.ctx.storage.sql.exec("UPDATE clips SET seq = ? WHERE clip_id = ?", index + 1, rows[index]!.clip_id);
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
  if (row.metadata_nonce !== null && row.metadata_ciphertext !== null) {
    clip.metadata = {
      nonce: row.metadata_nonce,
      ciphertext: row.metadata_ciphertext
    };
  }
  return clip;
}
