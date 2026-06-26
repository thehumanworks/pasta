import { chmod, mkdir, rm } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { sha256Base64Url } from "../shared/protocol";

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

export function secretFileForHome(home: string): string {
  return join(home, "secrets.json");
}

export function defaultSecretStoreForHome(home: string): SecretStore {
  const service = secretServiceForHome(home);
  const mirrors: SecretStore[] = [new TimedSecretStore(new BunSecretStore(service), "Bun.secrets")];
  if (process.platform === "darwin") {
    mirrors.push(new TimedSecretStore(new MacosKeychainSecretStore(service), "macOS Keychain"));
  }
  return new ResilientSecretStore(new FileSecretStore(secretFileForHome(home)), mirrors);
}

export class TimedSecretStore implements SecretStore {
  constructor(
    private readonly store: SecretStore,
    private readonly label: string,
    private readonly timeoutMs = 1000
  ) {}

  async get(name: SecretNameValue): Promise<string | null> {
    return this.withTimeout(this.store.get(name), "get", name);
  }

  async set(name: SecretNameValue, value: string): Promise<void> {
    await this.withTimeout(this.store.set(name, value), "set", name);
  }

  async delete(name: SecretNameValue): Promise<void> {
    await this.withTimeout(this.store.delete(name), "delete", name);
  }

  private async withTimeout<T>(operation: Promise<T>, action: string, name: SecretNameValue): Promise<T> {
    let timer: Timer | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${this.label} ${action} ${name} timed out`)), this.timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export class ResilientSecretStore implements SecretStore {
  constructor(
    private readonly fileStore: SecretStore,
    private readonly mirrorStores: SecretStore[]
  ) {}

  async get(name: SecretNameValue): Promise<string | null> {
    const local = await this.fileStore.get(name);
    if (local) return local;

    const errors: unknown[] = [];
    for (const store of [...this.mirrorStores].reverse()) {
      try {
        const value = await store.get(name);
        if (value) {
          await this.fileStore.set(name, value);
          return value;
        }
      } catch (error) {
        errors.push(error);
      }
    }

    const accessError = errors.find(isSecretAccessError);
    if (accessError) {
      throw new Error(
        `secret ${name} is unavailable in this terminal session; OS credential storage requires interactive access and no local Pasta secret file exists`
      );
    }
    return null;
  }

  async set(name: SecretNameValue, value: string): Promise<void> {
    await this.fileStore.set(name, value);
    await Promise.all(this.mirrorStores.map((store) => store.set(name, value).catch(() => undefined)));
  }

  async delete(name: SecretNameValue): Promise<void> {
    await this.fileStore.delete(name);
    await Promise.all(this.mirrorStores.map((store) => store.delete(name).catch(() => undefined)));
  }
}

export class FileSecretStore implements SecretStore {
  constructor(private readonly filePath: string) {}

  async get(name: SecretNameValue): Promise<string | null> {
    return (await this.read())[name] ?? null;
  }

  async set(name: SecretNameValue, value: string): Promise<void> {
    const values = await this.read();
    values[name] = value;
    await this.write(values);
  }

  async delete(name: SecretNameValue): Promise<void> {
    const values = await this.read();
    delete values[name];
    if (Object.keys(values).length === 0) {
      await rm(this.filePath, { force: true });
      return;
    }
    await this.write(values);
  }

  private async read(): Promise<Partial<Record<SecretNameValue, string>>> {
    const file = Bun.file(this.filePath);
    if (!(await file.exists())) return {};
    const parsed = await file.json() as Record<string, unknown>;
    const values: Partial<Record<SecretNameValue, string>> = {};
    for (const name of Object.values(SecretName)) {
      const value = parsed[name];
      if (typeof value === "string") values[name] = value;
    }
    return values;
  }

  private async write(values: Partial<Record<SecretNameValue, string>>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await Bun.write(this.filePath, `${JSON.stringify(values, null, 2)}\n`);
    await chmod(this.filePath, 0o600);
  }
}

export class MacosKeychainSecretStore implements SecretStore {
  constructor(private readonly service = "pasta") {}

  async get(name: SecretNameValue): Promise<string | null> {
    const result = await runSecurity(["find-generic-password", "-s", this.service, "-a", name, "-w"]);
    if (result.code === 44) return null;
    if (result.code !== 0) throw new Error(result.stderr || `security find-generic-password failed (${result.code})`);
    return result.stdout.replace(/\n$/u, "") || null;
  }

  async set(name: SecretNameValue, value: string): Promise<void> {
    const hexValue = Buffer.from(value, "utf8").toString("hex");
    const result = await runSecurity(["add-generic-password", "-U", "-A", "-s", this.service, "-a", name, "-X", hexValue]);
    if (result.code !== 0) throw new Error(result.stderr || `security add-generic-password failed (${result.code})`);
  }

  async delete(name: SecretNameValue): Promise<void> {
    const result = await runSecurity(["delete-generic-password", "-s", this.service, "-a", name]);
    if (result.code !== 0 && result.code !== 44) {
      throw new Error(result.stderr || `security delete-generic-password failed (${result.code})`);
    }
  }
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
    throw new Error(`missing ${name}; run pasta bootstrap or pair consume to create $PASTA_HOME/secrets.json`);
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

function isSecretAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("-25308")
    || message.includes("User interaction is not allowed")
    || message.includes("ERR_SECRETS_PLATFORM_ERROR")
    || message.includes("Bun.secrets is unavailable")
    || message.includes("timed out");
}

async function runSecurity(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["/usr/bin/security", ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, 1500);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]).finally(() => clearTimeout(timeout));
  if (timedOut) return { code: 124, stdout, stderr: "security command timed out" };
  return { code, stdout, stderr: stderr.trim() };
}
