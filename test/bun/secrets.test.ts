import { describe, expect, it } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BunSecretStore,
  FileSecretStore,
  MacosKeychainSecretStore,
  ResilientSecretStore,
  SecretName,
  type SecretStore
} from "../../src/cli/secret-store";

describe("BunSecretStore", () => {
  it("writes, reads, and deletes through Bun.secrets", async () => {
    const store = new BunSecretStore("pasta-test");
    const value = `secret-${Date.now()}`;
    await store.set(SecretName.groupKey, value);
    expect(await store.get(SecretName.groupKey)).toBe(value);
    await store.delete(SecretName.groupKey);
    expect(await store.get(SecretName.groupKey)).toBeNull();
  });

  it("writes local fallback secrets with owner-only permissions", async () => {
    const filePath = join(await mkdtemp(join(tmpdir(), "pasta-secrets-")), "secrets.json");
    const store = new FileSecretStore(filePath);
    await store.set(SecretName.groupKey, "local-secret");
    expect(await store.get(SecretName.groupKey)).toBe("local-secret");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await store.delete(SecretName.groupKey);
    expect(await store.get(SecretName.groupKey)).toBeNull();
  });

  it("uses the local fallback when OS credential storage is noninteractive", async () => {
    const fileStore = new FileSecretStore(join(await mkdtemp(join(tmpdir(), "pasta-secrets-")), "secrets.json"));
    const blockedStore: SecretStore = {
      get: async () => {
        throw new Error("User interaction is not allowed. (code: -25308)");
      },
      set: async () => {
        throw new Error("User interaction is not allowed. (code: -25308)");
      },
      delete: async () => undefined
    };
    const store = new ResilientSecretStore(fileStore, [blockedStore]);
    await expect(store.get(SecretName.groupKey)).rejects.toThrow("secret group-key is unavailable");
    await store.set(SecretName.groupKey, "local-secret");
    expect(await store.get(SecretName.groupKey)).toBe("local-secret");
  });

  it("mirrors existing OS-store secrets into the local fallback", async () => {
    const fileStore = new FileSecretStore(join(await mkdtemp(join(tmpdir(), "pasta-secrets-")), "secrets.json"));
    const mirrorStore: SecretStore = {
      get: async () => "mirrored-secret",
      set: async () => undefined,
      delete: async () => undefined
    };
    const store = new ResilientSecretStore(fileStore, [mirrorStore]);
    expect(await store.get(SecretName.groupKey)).toBe("mirrored-secret");
    expect(await fileStore.get(SecretName.groupKey)).toBe("mirrored-secret");
  });

  it("writes macOS Keychain items that security can read without a Bun.secrets call", async () => {
    if (process.platform !== "darwin") return;
    const store = new MacosKeychainSecretStore(`pasta-test-${Date.now()}`);
    await store.set(SecretName.groupKey, "macos-secret");
    try {
      expect(await store.get(SecretName.groupKey)).toBe("macos-secret");
    } finally {
      await store.delete(SecretName.groupKey);
    }
  });
});
