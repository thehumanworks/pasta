export const SecretName = {
  groupKey: "group-key",
  signingPrivateKey: "signing-private-key",
  wrappingPrivateKey: "wrapping-private-key"
} as const;

export type SecretNameValue = (typeof SecretName)[keyof typeof SecretName];

export interface SecretStore {
  get(name: SecretNameValue): Promise<string | null>;
  set(name: SecretNameValue, value: string): Promise<void>;
  delete(name: SecretNameValue): Promise<void>;
}

export class BunSecretStore implements SecretStore {
  constructor(private readonly service = "pasta") {}

  async get(name: SecretNameValue): Promise<string | null> {
    const secrets = bunSecrets();
    const value = await secrets.get({ service: this.service, name });
    return value ?? null;
  }

  async set(name: SecretNameValue, value: string): Promise<void> {
    const secrets = bunSecrets();
    await secrets.set({ service: this.service, name, value });
  }

  async delete(name: SecretNameValue): Promise<void> {
    const secrets = bunSecrets();
    await secrets.delete({ service: this.service, name });
  }
}

export function secretServiceForHome(home: string): string {
  return `pasta:${sha256Base64Url(home).slice(0, 16)}`;
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<SecretNameValue, string>();

  async get(name: SecretNameValue): Promise<string | null> {
    return this.values.get(name) ?? null;
  }

  async set(name: SecretNameValue, value: string): Promise<void> {
    this.values.set(name, value);
  }

  async delete(name: SecretNameValue): Promise<void> {
    this.values.delete(name);
  }
}

export async function requireSecret(store: SecretStore, name: SecretNameValue): Promise<string> {
  const value = await store.get(name);
  if (!value) {
    throw new Error(`missing ${name}; OS secret storage is required and plaintext fallback is disabled`);
  }
  return value;
}

function bunSecrets(): {
  get(input: { service: string; name: string }): Promise<string | null>;
  set(input: { service: string; name: string; value: string }): Promise<void>;
  delete(input: { service: string; name: string }): Promise<void>;
} {
  const secrets = (Bun as unknown as { secrets?: unknown }).secrets;
  if (!secrets || typeof secrets !== "object") {
    throw new Error("Bun.secrets is unavailable; plaintext fallback is disabled");
  }
  return secrets as ReturnType<typeof bunSecrets>;
}
import { sha256Base64Url } from "../shared/protocol";

