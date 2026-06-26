import { describe, expect, it } from "bun:test";
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  authFileForHome,
  BunSecretStore,
  defaultSecretStoreForHome,
  FileSecretStore,
  legacySecretFileForHome,
  MacosKeychainSecretStore,
  osCredentialStoreEnabledForHome,
  ResilientSecretStore,
  SecretName,
  secretServiceForHome,
  settingsFileForHome,
  TimedSecretStore,
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
    const filePath = join(await mkdtemp(join(tmpdir(), "pasta-secrets-")), "auth.json");
    const store = new FileSecretStore(filePath);
    await store.set(SecretName.groupKey, "local-secret");
    expect(await store.get(SecretName.groupKey)).toBe("local-secret");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await store.delete(SecretName.groupKey);
    expect(await store.get(SecretName.groupKey)).toBeNull();
  });

  it("uses the local fallback when OS credential storage is noninteractive", async () => {
    const fileStore = new FileSecretStore(join(await mkdtemp(join(tmpdir(), "pasta-secrets-")), "auth.json"));
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

  it("migrates existing read-store secrets into auth.json", async () => {
    const fileStore = new FileSecretStore(join(await mkdtemp(join(tmpdir(), "pasta-secrets-")), "auth.json"));
    const mirrorStore: SecretStore = {
      get: async () => "mirrored-secret",
      set: async () => undefined,
      delete: async () => undefined
    };
    const store = new ResilientSecretStore(fileStore, [mirrorStore]);
    expect(await store.get(SecretName.groupKey)).toBe("mirrored-secret");
    expect(await fileStore.get(SecretName.groupKey)).toBe("mirrored-secret");
  });

  it("migrates old secrets.json entries into auth.json by default", async () => {
    const home = await mkdtemp(join(tmpdir(), "pasta-secrets-"));
    const legacyStore = new FileSecretStore(legacySecretFileForHome(home));
    await legacyStore.set(SecretName.signingPrivateKey, "legacy-signing-key");
    const store = defaultSecretStoreForHome(home, {});
    expect(await store.get(SecretName.signingPrivateKey)).toBe("legacy-signing-key");
    expect(await new FileSecretStore(authFileForHome(home)).get(SecretName.signingPrivateKey)).toBe("legacy-signing-key");
    await store.delete(SecretName.signingPrivateKey);
    expect(await store.get(SecretName.signingPrivateKey)).toBeNull();
    expect(await legacyStore.get(SecretName.signingPrivateKey)).toBeNull();
  });

  it("does not use OS credential stores unless settings or env opt in", async () => {
    const home = await mkdtemp(join(tmpdir(), "pasta-secrets-"));
    expect(osCredentialStoreEnabledForHome(home, {})).toBe(false);
    expect(osCredentialStoreEnabledForHome(home, { PASTA_AUTH_STORE: "keychain" })).toBe(true);
    expect(osCredentialStoreEnabledForHome(home, { PASTA_AUTH_STORE: "file" })).toBe(false);
    await Bun.write(settingsFileForHome(home), `${JSON.stringify({ authStore: "keychain" })}\n`);
    expect(osCredentialStoreEnabledForHome(home, {})).toBe(true);
  });

  it("migrates existing Bun.secrets entries into auth.json only when OS storage is enabled", async () => {
    const home = await mkdtemp(join(tmpdir(), "pasta-secrets-"));
    const service = secretServiceForHome(home);
    const legacyStore = new BunSecretStore(service);
    await legacyStore.set(SecretName.signingPrivateKey, "legacy-signing-key");
    try {
      expect(await defaultSecretStoreForHome(home, {}).get(SecretName.signingPrivateKey)).toBeNull();
      const store = defaultSecretStoreForHome(home, { PASTA_AUTH_STORE: "keychain" });
      expect(await store.get(SecretName.signingPrivateKey)).toBe("legacy-signing-key");
      expect(await new FileSecretStore(authFileForHome(home)).get(SecretName.signingPrivateKey)).toBe("legacy-signing-key");
    } finally {
      await legacyStore.delete(SecretName.signingPrivateKey);
      await new FileSecretStore(authFileForHome(home)).delete(SecretName.signingPrivateKey);
    }
  });

  it("does not let slow mirror stores block local secret writes", async () => {
    const fileStore = new FileSecretStore(join(await mkdtemp(join(tmpdir(), "pasta-secrets-")), "auth.json"));
    const slowStore: SecretStore = {
      get: async () => new Promise<string | null>(() => undefined),
      set: async () => new Promise<void>(() => undefined),
      delete: async () => new Promise<void>(() => undefined)
    };
    const store = new ResilientSecretStore(fileStore, [new TimedSecretStore(slowStore, "slow", 10)]);
    await store.set(SecretName.groupKey, "local-secret");
    expect(await fileStore.get(SecretName.groupKey)).toBe("local-secret");
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
