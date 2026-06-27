import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBase64Url } from "../shared/encoding";

export interface PendingPairing {
  sessionId: string;
  accountId: string;
  routingId: string;
  endpoint: string;
  shortCodeHash: string;
  deviceId: string;
  deviceName: string;
  verifyPublicKey: string;
  wrapPublicKey: string;
  expiresAt: number;
}

export interface PastaConfig {
  endpoint: string;
  accountId: string;
  routingId: string;
  deviceId: string;
  deviceName: string;
  verifyPublicKey: string;
  wrapPublicKey: string;
  keyVersion: number;
  deviceExpiresAt?: number | null;
  lastRemotePasteHash?: string;
  pendingPairing?: PendingPairing;
}

export interface Paths {
  home: string;
  configPath: string;
  shellConfigPath: string;
}

export function pastaHome(env: Record<string, string | undefined> = Bun.env): string {
  return env.PASTA_HOME ?? join(env.HOME ?? ".", ".config", "pasta");
}

export function paths(home = pastaHome()): Paths {
  return {
    home,
    configPath: join(home, "config.json"),
    shellConfigPath: join(home, "shell.zsh")
  };
}

export async function readConfig(configPath = paths().configPath): Promise<PastaConfig> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new Error(`Pasta is not configured. Run pasta bootstrap or pasta pair request first.`);
  }
  return (await file.json()) as PastaConfig;
}

export async function writeConfig(config: PastaConfig, configPath = paths().configPath): Promise<void> {
  await mkdir(dirname(configPath), { recursive: true });
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export async function updateConfig(
  updater: (config: PastaConfig) => PastaConfig | Promise<PastaConfig>,
  configPath = paths().configPath
): Promise<PastaConfig> {
  const next = await updater(await readConfig(configPath));
  await writeConfig(next, configPath);
  return next;
}

export function newAccountId(): string {
  return `acct_${randomBase64Url(16)}`;
}

export function newRoutingId(): string {
  return `space_${randomBase64Url(16)}`;
}

export function newDeviceId(): string {
  return `dev_${randomBase64Url(12)}`;
}

export function defaultDeviceName(): string {
  return `${process.platform}-${process.env.USER ?? "desktop"}`;
}
