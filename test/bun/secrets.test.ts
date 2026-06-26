import { describe, expect, it } from "bun:test";
import { BunSecretStore, SecretName } from "../../src/cli/secret-store";

describe("BunSecretStore", () => {
  it("writes, reads, and deletes through Bun.secrets", async () => {
    const store = new BunSecretStore("pasta-test");
    const value = `secret-${Date.now()}`;
    await store.set(SecretName.groupKey, value);
    expect(await store.get(SecretName.groupKey)).toBe(value);
    await store.delete(SecretName.groupKey);
    expect(await store.get(SecretName.groupKey)).toBeNull();
  });
});

