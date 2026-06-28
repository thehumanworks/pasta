#!/usr/bin/env bun
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import QRCode from "qrcode";
import {
  decryptClipMetadata,
  decryptBytesClip,
  decryptTextClip,
  encryptBytesClip,
  encryptTextClip,
  createJoinGrantToken,
  generateDeviceKeyMaterial,
  generateGroupKey,
  hashJoinGrantRedeemSecret,
  hashShortCode,
  makeShortCode,
  openJoinGrant,
  parseJoinGrantToken,
  sealJoinGrant,
  unwrapGroupKey,
  wrapGroupKey
} from "./shared/crypto";
import {
  JOIN_GRANT_DEVICE_TTL_MAX_MS,
  JOIN_GRANT_MAX_USES,
  JOIN_GRANT_TOKEN_TTL_MAX_MS,
  JOIN_GRANT_TOKEN_TTL_MS,
  LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES,
  LARGE_PAYLOAD_MAX_BYTES,
  MAX_HISTORY_LIMIT,
  PASTA_VERSION,
  PROTOCOL_ENDPOINTS,
  type BootstrapRequest,
  type ClipMetadata,
  type EncryptedClip,
  type PairingConsumeRequest,
  type PairingGrantCreateRequest,
  type PairingGrantRedeemResponse,
  type PairingOpenRequest,
  sha256Base64Url,
  type StoredClip
} from "./shared/protocol";
import { randomBase64Url } from "./shared/encoding";
import { SystemClipboardAdapter, type ClipboardAdapter } from "./cli/clipboard";
import { DIRECTORY_BUNDLE_MIME, unzipDirectoryBundle, zipDirectory } from "./cli/directory-zip";
import {
  defaultDeviceName,
  newAccountId,
  newDeviceId,
  newRoutingId,
  paths as defaultPaths,
  readConfig,
  updateConfig,
  writeConfig,
  type PastaConfig,
  type Paths
} from "./cli/config";
import { FetchApiClient, type ApiClient } from "./cli/client";
import { runDaemonLoop } from "./cli/daemon";
import { ExitCode, type ExitCodeValue } from "./cli/exit-codes";
import { defaultSecretStoreForHome, requireSecret, SecretName, type SecretStore } from "./cli/secret-store";
import {
  installShell,
  isInstallShellKind,
  isUninstallShellKind,
  normalizeShellKeybindingOptions,
  resolveShellKind,
  shellKeySpecHelp,
  shellSnippet,
  uninstallShell,
  type ShellKeybindingOptions,
  type ShellKind
} from "./cli/shell";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdinText: () => Promise<string>;
}

export interface CliDeps {
  io?: CliIo;
  paths?: Paths;
  secrets?: SecretStore;
  clipboard?: ClipboardAdapter;
  clientFactory?: (config: PastaConfig, secrets: SecretStore) => ApiClient;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdinText: () => Bun.stdin.text()
};

function activationHint(shell: ShellKind, installed: string): string {
  if (shell === "powershell") return `. ${powerShellQuote(installed)}`;
  return `source ${posixShellQuote(installed)}`;
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function posixShellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<ExitCodeValue> {
  const io = deps.io ?? defaultIo;
  const paths = deps.paths ?? defaultPaths();
  const secrets = deps.secrets ?? defaultSecretStoreForHome(paths.home);
  const clipboard = deps.clipboard ?? new SystemClipboardAdapter();

  try {
    const command = argv[0];
    if (!command || command === "--help" || command === "-h") {
      io.stdout(helpText());
      return ExitCode.ok;
    }
    if (command === "--version" || command === "-v") {
      io.stdout(`${PASTA_VERSION}\n`);
      return ExitCode.ok;
    }

    if (command === "bootstrap") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("bootstrap"));
        return ExitCode.ok;
      }
      const endpoint = option(argv, "--endpoint") ?? "http://127.0.0.1:8787";
      const deviceName = option(argv, "--device-name") ?? defaultDeviceName();
      const config = await bootstrap(endpoint, deviceName, paths, secrets, deps.clientFactory);
      io.stdout(`bootstrapped ${config.deviceName} (${config.deviceId})\n`);
      return ExitCode.ok;
    }

    if (command === "doctor") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("doctor"));
        return ExitCode.ok;
      }
      const result = await clipboard.doctor();
      io.stdout(JSON.stringify({ version: PASTA_VERSION, clipboard: result }, null, 2) + "\n");
      return result.available ? ExitCode.ok : ExitCode.unavailable;
    }

    if (command === "copy") {
      return await copyCommand(argv.slice(1), io, paths, secrets, clipboard, deps);
    }

    if (command === "paste") {
      return await pasteCommand(argv.slice(1), io, paths, secrets, clipboard, deps);
    }

    if (command === "history") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("history"));
        return ExitCode.ok;
      }
      return await historyCommand(argv.slice(1), io, paths, secrets, clipboard, deps);
    }

    if (command === "daemon") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("daemon"));
        return ExitCode.ok;
      }
      const once = argv.includes("--once") || argv.includes("--dry-run");
      const dryRun = argv.includes("--dry-run");
      const intervalMs = Number.parseInt(option(argv, "--interval-ms") ?? "750", 10);
      const config = dryRun
        ? await readConfig(paths.configPath).catch(() => null)
        : await readConfig(paths.configPath);
      const result = await runDaemonLoop(
        clipboard,
        async (text) => {
          if (!config) return;
          await publishText(config, secrets, clientFor(config, secrets, deps), text);
        },
        () => config?.lastRemotePasteHash,
        { intervalMs, once, dryRun }
      );
      io.stdout(JSON.stringify(result) + "\n");
      return ExitCode.ok;
    }

    if (command === "pair") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("pair"));
        return ExitCode.ok;
      }
      return await pairCommand(argv.slice(1), io, paths, secrets, deps);
    }

    if (command === "devices") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("devices"));
        return ExitCode.ok;
      }
      return await devicesCommand(argv.slice(1), io, paths, secrets, deps);
    }

    if (command === "reset") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("reset"));
        return ExitCode.ok;
      }
      const config = await readConfig(paths.configPath);
      if (!argv.includes("--yes")) {
        io.stderr("reset requires --yes and makes old encrypted history unrecoverable\n");
        return ExitCode.usage;
      }
      const groupKey = generateGroupKey();
      const freshRoutingId = newRoutingId();
      await clientFor(config, secrets, deps).request("POST", "/v1/reset", { confirm: "RESET", newRoutingId: freshRoutingId });
      await secrets.set(SecretName.groupKey, groupKey);
      await writeConfig({ ...config, routingId: freshRoutingId, keyVersion: config.keyVersion + 1 }, paths.configPath);
      io.stdout(`reset encrypted space ${freshRoutingId}\n`);
      return ExitCode.ok;
    }

    if (command === "install-shell") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("install-shell"));
        return ExitCode.ok;
      }
      const shell = option(argv, "--shell") ?? "auto";
      if (!isInstallShellKind(shell)) {
        io.stderr("--shell must be auto, zsh, bash, fish, or powershell\n");
        return ExitCode.usage;
      }
      let keybindings: ShellKeybindingOptions;
      try {
        keybindings = shellKeybindingOptionsFromArgs(argv);
        normalizeShellKeybindingOptions(keybindings);
      } catch (error) {
        io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return ExitCode.usage;
      }
      const resolvedShell = resolveShellKind(shell);
      const installed = await installShell(paths, option(argv, "--command") ?? "pasta", resolvedShell, Bun.env, process.platform, keybindings);
      io.stdout(`installed ${installed}\n${activationHint(resolvedShell, installed)}\n`);
      return ExitCode.ok;
    }

    if (command === "uninstall-shell") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("uninstall-shell"));
        return ExitCode.ok;
      }
      const shell = option(argv, "--shell") ?? "all";
      if (!isUninstallShellKind(shell)) {
        io.stderr("--shell must be auto, all, zsh, bash, fish, or powershell\n");
        return ExitCode.usage;
      }
      const uninstalled = await uninstallShell(paths, shell);
      io.stdout(`removed Pasta shell snippet from ${uninstalled.length === 0 ? "no files" : uninstalled.join(", ")}\n`);
      return ExitCode.ok;
    }

    if (command === "protocol") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("protocol"));
        return ExitCode.ok;
      }
      io.stdout(JSON.stringify(PROTOCOL_ENDPOINTS, null, 2) + "\n");
      return ExitCode.ok;
    }

    if (command === "payload-plan") {
      if (argv.includes("--help")) {
        io.stdout(commandHelp("payload-plan"));
        return ExitCode.ok;
      }
      io.stdout(
        JSON.stringify(
          {
            inlineThresholdBytes: LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES,
            maxBytes: LARGE_PAYLOAD_MAX_BYTES,
            r2KeyFormat: "spaces/{routing_id}/clips/{clip_id}/{payload_id}",
            finalizeSemantics: "upload encrypted blob first, then signed finalize stores metadata in DO"
          },
          null,
          2
        ) + "\n"
      );
      return ExitCode.ok;
    }

    io.stderr(`unknown command: ${command}\n`);
    return ExitCode.usage;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.internal;
  }
}

type CopyMode = "auto" | "image" | "file";
type PasteMode = "auto" | "image" | "file";

async function copyCommand(
  argv: string[],
  io: CliIo,
  paths: Paths,
  secrets: SecretStore,
  clipboard: ClipboardAdapter,
  deps: CliDeps
): Promise<ExitCodeValue> {
  if (argv.includes("--help")) {
    io.stdout(commandHelp("copy"));
    return ExitCode.ok;
  }
  const forceImage = argv.includes("--image");
  const forceFile = argv.includes("--file");
  if (forceImage && forceFile) {
    io.stderr("copy accepts only one of --image or --file\n");
    return ExitCode.usage;
  }
  const mode: CopyMode = forceImage ? "image" : forceFile ? "file" : "auto";
  const filePath = option(argv, "--path") ?? firstPositional(argv);
  const config = await readConfig(paths.configPath);
  const client = clientFor(config, secrets, deps);

  if (filePath) {
    const published = await publishPath(config, secrets, client, filePath, mode, option(argv, "--mime"));
    io.stdout(clipIsImageLike(published) ? "published image\n" : clipIsDirectoryBundle(published) ? `published directory ${published.seq}\n` : `published file ${published.seq}\n`);
    return ExitCode.ok;
  }

  if (mode === "file") {
    io.stderr("copy --file requires a path\n");
    return ExitCode.usage;
  }

  if (mode === "image") {
    const image = await clipboard.readImage();
    await publishImagePayload(config, secrets, client, image.bytes, image.mime);
    io.stdout("published image\n");
    return ExitCode.ok;
  }

  if (process.stdin.isTTY) {
    const image = await clipboard.readImage().catch(() => null);
    if (image) {
      await publishImagePayload(config, secrets, client, image.bytes, image.mime);
      io.stdout("published image\n");
      return ExitCode.ok;
    }
  }

  const text = process.stdin.isTTY ? await clipboard.readText() : await deps.io?.stdinText?.() ?? await defaultIo.stdinText();
  await publishText(config, secrets, client, text);
  io.stdout("published\n");
  return ExitCode.ok;
}

async function publishPath(
  config: PastaConfig,
  secrets: SecretStore,
  client: ApiClient,
  filePath: string,
  mode: CopyMode,
  explicitMime?: string
): Promise<StoredClip> {
  const pathStat = await stat(filePath).catch(() => null);
  if (!pathStat) throw new Error(`file not found: ${filePath}`);
  if (pathStat.isDirectory()) {
    if (mode === "image") throw new Error("copy --image requires PNG image bytes");
    const bytes = await zipDirectory(filePath, LARGE_PAYLOAD_MAX_BYTES);
    return publishFilePayload(config, secrets, client, bytes, DIRECTORY_BUNDLE_MIME, "file", metadataForPath(filePath));
  }
  const file = Bun.file(filePath);
  if (!(await file.exists())) throw new Error(`file not found: ${filePath}`);
  const mime = mimeForPath(filePath, explicitMime ?? file.type);
  if (file.size > LARGE_PAYLOAD_MAX_BYTES) throw new Error(`file exceeds max size ${LARGE_PAYLOAD_MAX_BYTES}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = isPngBytes(bytes);
  if (mode === "image") {
    if (!isPng) throw new Error("copy --image requires PNG image bytes");
    return publishFilePayload(config, secrets, client, bytes, explicitMime ?? "image/png", "file", metadataForPath(filePath));
  }
  if (mode === "auto" && isPng) {
    return publishFilePayload(config, secrets, client, bytes, explicitMime ?? "image/png", "file", metadataForPath(filePath));
  }
  return publishFilePayload(config, secrets, client, bytes, mime, "file", metadataForPath(filePath));
}

async function pasteCommand(
  argv: string[],
  io: CliIo,
  paths: Paths,
  secrets: SecretStore,
  clipboard: ClipboardAdapter,
  deps: CliDeps
): Promise<ExitCodeValue> {
  if (argv.includes("--help")) {
    io.stdout(commandHelp("paste"));
    return ExitCode.ok;
  }
  const forceImage = argv.includes("--image");
  const forceFile = argv.includes("--file");
  if (forceImage && forceFile) {
    io.stderr("paste accepts only one of --image or --file\n");
    return ExitCode.usage;
  }
  const mode: PasteMode = forceImage ? "image" : forceFile ? "file" : "auto";
  const out = option(argv, "--out");
  const config = await readConfig(paths.configPath);
  const client = clientFor(config, secrets, deps);
  const seqArg = option(argv, "--seq");
  const selectedSeq = seqArg ? parseSeq(seqArg) : null;
  if (seqArg && selectedSeq === null) {
    io.stderr("--seq must be a positive integer\n");
    return ExitCode.usage;
  }
  if (mode === "file" && selectedSeq !== null) {
    const selected = await resolveClipBySeq(client, selectedSeq);
    if (!selected) {
      io.stderr(`no history entry ${selectedSeq}\n`);
      return ExitCode.unavailable;
    }
    const payload = await fetchFilePayload(config, secrets, client, selected.clipId);
    if (payload.clip.payloadKind !== "file") {
      io.stderr(`history entry ${selectedSeq} is ${payload.clip.payloadKind}, not file\n`);
      return ExitCode.unavailable;
    }
    if (clipIsDirectoryBundle(payload.clip)) {
      await unzipDirectoryBundle(payload.bytes, out ?? await defaultOutputPath(config, secrets, payload.clip));
    } else {
      await Bun.write(out ?? await defaultOutputPath(config, secrets, payload.clip), payload.bytes);
    }
    return ExitCode.ok;
  }
  const clip = await fetchClip(client, selectedSeq);
  if (!clip) {
    io.stderr(selectedSeq === null ? `no remote ${mode === "auto" ? "clip" : `${mode} clip`}\n` : `no history entry ${selectedSeq}\n`);
    return ExitCode.unavailable;
  }
  if (mode === "image" && !clipIsImageLike(clip)) {
    io.stderr(`latest clip is ${clip.payloadKind}, not image\n`);
    return ExitCode.unavailable;
  }
  if (mode === "file" && clip.payloadKind !== "file") {
    io.stderr(`latest clip is ${clip.payloadKind}, not file\n`);
    return ExitCode.unavailable;
  }
  if (clip.payloadKind === "text") {
    const plaintext = await decryptStored(config, secrets, clip);
    if (out) {
      await Bun.write(out, plaintext);
    } else if (argv.includes("--clipboard")) {
      await clipboard.writeText(plaintext);
      await updateConfig((current) => ({ ...current, lastRemotePasteHash: sha256Base64Url(plaintext) }), paths.configPath);
    } else {
      io.stdout(plaintext);
      if (!plaintext.endsWith("\n")) io.stdout("\n");
    }
    return ExitCode.ok;
  }

  const bytes = clip.storageKind === "r2" || !clip.ciphertext
    ? (await fetchFilePayload(config, secrets, client, clip.clipId)).bytes
    : await decryptStoredBytes(config, secrets, clip);
  if (clipIsDirectoryBundle(clip)) {
    await unzipDirectoryBundle(bytes, out ?? await defaultOutputPath(config, secrets, clip));
    return ExitCode.ok;
  }
  if (out) {
    await Bun.write(out, bytes);
    return ExitCode.ok;
  }
  if ((mode === "image" || (mode === "auto" && clip.payloadKind === "image")) && isClipboardPng(clip.mime)) {
    await clipboard.writeImage({ mime: "image/png", bytes });
    return ExitCode.ok;
  }
  await Bun.write(await defaultOutputPath(config, secrets, clip), bytes);
  return ExitCode.ok;
}

async function fetchClip(client: ApiClient, seq: number | null): Promise<StoredClip | null> {
  if (seq !== null) {
    const selected = await resolveClipBySeq(client, seq);
    return selected ? fetchClipById(client, selected.clipId) : null;
  }
  const response = await client.request<{ clip: StoredClip | null }>("GET", "/v1/clips/latest");
  return response.clip;
}

async function fetchClipById(client: ApiClient, clipId: string): Promise<StoredClip> {
  const response = await client.request<{ clip: StoredClip }>("GET", `/v1/clips/${encodeURIComponent(clipId)}`);
  return response.clip;
}

async function fetchFilePayload(
  config: PastaConfig,
  secrets: SecretStore,
  client: ApiClient,
  clipId: string
): Promise<{ clip: StoredClip; bytes: Uint8Array }> {
  const response = await client.request<{ clip: StoredClip; ciphertext: string }>("GET", `/v1/files/${encodeURIComponent(clipId)}`);
  return {
    clip: response.clip,
    bytes: await decryptStoredBytes(config, secrets, { ...response.clip, ciphertext: response.ciphertext })
  };
}

async function resolveClipBySeq(client: ApiClient, seq: number): Promise<StoredClip | null> {
  let beforeClipId: string | null = null;
  for (let page = 0; page < 1_000; page += 1) {
    const clips = await fetchHistoryPage(client, beforeClipId);
    if (clips.length === 0) return null;
    const found = clips.find((clip) => clip.seq === seq);
    if (found) return found;
    const newest = clips[0]!.seq;
    const oldest = clips[clips.length - 1]!.seq;
    if (seq > newest || seq > oldest) return null;
    beforeClipId = clips[clips.length - 1]!.clipId;
  }
  throw new Error("history resolution exceeded page limit");
}

async function fetchHistoryPage(client: ApiClient, beforeClipId: string | null): Promise<StoredClip[]> {
  const before = beforeClipId ? `&before=${encodeURIComponent(beforeClipId)}` : "";
  const response = await client.request<{ clips: StoredClip[] }>("GET", `/v1/clips/history?limit=${MAX_HISTORY_LIMIT}${before}`);
  return response.clips;
}

async function bootstrap(
  endpoint: string,
  deviceName: string,
  paths: Paths,
  secrets: SecretStore,
  clientFactory?: CliDeps["clientFactory"]
): Promise<PastaConfig> {
  const accountId = newAccountId();
  const routingId = newRoutingId();
  const deviceId = newDeviceId();
  const keyMaterial = generateDeviceKeyMaterial();
  const groupKey = generateGroupKey();
  const config: PastaConfig = {
    endpoint,
    accountId,
    routingId,
    deviceId,
    deviceName,
    verifyPublicKey: keyMaterial.signing.publicKey,
    wrapPublicKey: keyMaterial.wrapping.publicKey,
    keyVersion: 1
  };
  const body: BootstrapRequest = {
    accountId,
    routingId,
    deviceId,
    deviceName,
    verifyPublicKey: config.verifyPublicKey,
    wrapPublicKey: config.wrapPublicKey
  };
  const deps = clientFactory ? { clientFactory } : {};
  await clientFor(config, secrets, deps).request("POST", "/v1/accounts/bootstrap", body, false);
  await secrets.set(SecretName.groupKey, groupKey);
  await secrets.set(SecretName.signingPrivateKey, keyMaterial.signing.privateKey);
  await secrets.set(SecretName.wrappingPrivateKey, keyMaterial.wrapping.privateKey);
  await writeConfig(config, paths.configPath);
  return config;
}

async function publishText(config: PastaConfig, secrets: SecretStore, client: ApiClient, text: string): Promise<StoredClip> {
  const groupKey = await requireSecret(secrets, SecretName.groupKey);
  const clip = encryptTextClip({
    accountId: config.accountId,
    routingId: config.routingId,
    originDeviceId: config.deviceId,
    plaintext: text,
    groupKey,
    keyVersion: config.keyVersion
  });
  const response = await client.request<{ clip: StoredClip }>("POST", "/v1/clips", clip);
  return response.clip;
}

async function publishImage(config: PastaConfig, secrets: SecretStore, client: ApiClient, bytes: Uint8Array, mime: string): Promise<StoredClip> {
  const groupKey = await requireSecret(secrets, SecretName.groupKey);
  const clip = encryptBytesClip({
    accountId: config.accountId,
    routingId: config.routingId,
    originDeviceId: config.deviceId,
    bytes,
    payloadKind: "image",
    mime,
    groupKey,
    keyVersion: config.keyVersion
  });
  const response = await client.request<{ clip: StoredClip }>("POST", "/v1/clips", clip);
  return response.clip;
}

async function publishImagePayload(config: PastaConfig, secrets: SecretStore, client: ApiClient, bytes: Uint8Array, mime: string): Promise<StoredClip> {
  if (bytes.length <= LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES) {
    return publishImage(config, secrets, client, bytes, mime);
  }
  return publishFilePayload(config, secrets, client, bytes, mime, "image");
}

async function publishFilePayload(
  config: PastaConfig,
  secrets: SecretStore,
  client: ApiClient,
  bytes: Uint8Array,
  mime: string,
  payloadKind: "file" | "image" = "file",
  metadata?: ClipMetadata
): Promise<StoredClip> {
  const groupKey = await requireSecret(secrets, SecretName.groupKey);
  const input = {
    accountId: config.accountId,
    routingId: config.routingId,
    originDeviceId: config.deviceId,
    bytes,
    payloadKind,
    mime,
    groupKey,
    keyVersion: config.keyVersion
  };
  const clip = encryptBytesClip(metadata ? { ...input, metadata } : input);
  const response = await client.request<{ clip: StoredClip }>("POST", "/v1/files", clip);
  return response.clip;
}

async function decryptStored(config: PastaConfig, secrets: SecretStore, clip: EncryptedClip): Promise<string> {
  return decryptTextClip(await requireSecret(secrets, SecretName.groupKey), config.accountId, config.routingId, clip);
}

async function decryptStoredBytes(config: PastaConfig, secrets: SecretStore, clip: EncryptedClip): Promise<Uint8Array> {
  return decryptBytesClip(await requireSecret(secrets, SecretName.groupKey), config.accountId, config.routingId, clip);
}

async function decryptStoredMetadata(config: PastaConfig, secrets: SecretStore, clip: EncryptedClip): Promise<ClipMetadata | null> {
  return decryptClipMetadata(await requireSecret(secrets, SecretName.groupKey), config.accountId, config.routingId, clip);
}

async function historyCommand(
  argv: string[],
  io: CliIo,
  paths: Paths,
  secrets: SecretStore,
  clipboard: ClipboardAdapter,
  deps: CliDeps
): Promise<ExitCodeValue> {
  const config = await readConfig(paths.configPath);
  const client = clientFor(config, secrets, deps);
  if (argv[0] === "paste") {
    const seq = parseSeq(argv[1]);
    if (seq === null) return ExitCode.usage;
    const selected = await resolveClipBySeq(client, seq);
    if (!selected) {
      io.stderr(`no history entry ${seq}\n`);
      return ExitCode.unavailable;
    }
    const clip = await fetchClipById(client, selected.clipId);
    if (clip.payloadKind !== "text") {
      io.stderr(`history paste only supports text clips; use pasta paste --seq ${seq} --out <path>\n`);
      return ExitCode.usage;
    }
    const plaintext = await decryptStored(config, secrets, clip);
    if (argv.includes("--clipboard")) {
      await clipboard.writeText(plaintext);
    } else {
      io.stdout(plaintext + (plaintext.endsWith("\n") ? "" : "\n"));
    }
    return ExitCode.ok;
  }
  if (argv[0] === "delete") {
    const seq = parseSeq(argv[1]);
    if (seq === null) return ExitCode.usage;
    const selected = await resolveClipBySeq(client, seq);
    if (!selected) {
      io.stderr(`no history entry ${seq}\n`);
      return ExitCode.unavailable;
    }
    const response = await client.request<{ deleted: number; deletedObjects: number }>("DELETE", `/v1/clips/${encodeURIComponent(selected.clipId)}`);
    if (response.deleted === 0) {
      io.stderr(`no history entry ${seq}\n`);
      return ExitCode.unavailable;
    }
    io.stdout(`deleted ${seq}\n`);
    return ExitCode.ok;
  }
  const response = await client.request<{ clips: StoredClip[] }>("GET", "/v1/clips/history?limit=50");
  const showPlaintext = argv.includes("--show");
  for (const clip of response.clips) {
    const rendered = showPlaintext && clip.payloadKind === "text"
      ? await decryptStored(config, secrets, clip)
      : await renderHistoryClip(config, secrets, clip);
    io.stdout(`${clip.seq}\t${new Date(clip.createdAt).toISOString()}\t${rendered}\n`);
  }
  return ExitCode.ok;
}

async function pairCommand(
  argv: string[],
  io: CliIo,
  paths: Paths,
  secrets: SecretStore,
  deps: CliDeps
): Promise<ExitCodeValue> {
  const subcommand = argv[0] ?? "help";
  if (subcommand === "ticket") {
    const config = await readConfig(paths.configPath);
    const payload = `pasta://pair?endpoint=${encodeURIComponent(config.endpoint)}&account=${encodeURIComponent(config.accountId)}&routing=${encodeURIComponent(config.routingId)}`;
    io.stdout(`${payload}\n`);
    io.stdout(await QRCode.toString(payload, { type: "terminal" }));
    return ExitCode.ok;
  }
  if (subcommand === "request") {
    const ticket = option(argv, "--ticket");
    const endpoint = option(argv, "--endpoint");
    const account = option(argv, "--account-id");
    const parsed = ticket ? parsePairTicket(ticket) : null;
    const accountId = parsed?.accountId ?? account;
    const routingId = parsed?.routingId ?? option(argv, "--routing-id") ?? "";
    const resolvedEndpoint = parsed?.endpoint ?? endpoint;
    if (!accountId || !resolvedEndpoint) {
      io.stderr("pair request needs --ticket or --endpoint plus --account-id\n");
      return ExitCode.usage;
    }
    const deviceName = option(argv, "--device-name") ?? defaultDeviceName();
    const deviceId = newDeviceId();
    const keyMaterial = generateDeviceKeyMaterial();
    const shortCode = makeShortCode();
    const shortCodeHash = hashShortCode(shortCode, accountId);
    const sessionId = `pair_${randomBase64Url(16)}`;
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const pending = {
      sessionId,
      accountId,
      routingId,
      endpoint: resolvedEndpoint,
      shortCodeHash,
      deviceId,
      deviceName,
      verifyPublicKey: keyMaterial.signing.publicKey,
      wrapPublicKey: keyMaterial.wrapping.publicKey,
      expiresAt
    };
    const config: PastaConfig = {
      endpoint: resolvedEndpoint,
      accountId,
      routingId,
      deviceId,
      deviceName,
      verifyPublicKey: keyMaterial.signing.publicKey,
      wrapPublicKey: keyMaterial.wrapping.publicKey,
      keyVersion: 1,
      pendingPairing: pending
    };
    const body: PairingOpenRequest = {
      sessionId,
      accountId,
      shortCodeHash,
      newDeviceId: deviceId,
      newDeviceName: deviceName,
      verifyPublicKey: keyMaterial.signing.publicKey,
      wrapPublicKey: keyMaterial.wrapping.publicKey,
      expiresAt
    };
    await clientFor(config, secrets, deps).request("POST", "/v1/pairing/open", body, false);
    await secrets.set(SecretName.signingPrivateKey, keyMaterial.signing.privateKey);
    await secrets.set(SecretName.wrappingPrivateKey, keyMaterial.wrapping.privateKey);
    await writeConfig(config, paths.configPath);
    const qrPayload = `pasta://approve?code=${encodeURIComponent(shortCode)}&session=${encodeURIComponent(sessionId)}`;
    io.stdout(`code ${shortCode}\n`);
    io.stdout(await QRCode.toString(qrPayload, { type: "terminal" }));
    return ExitCode.ok;
  }
  if (subcommand === "consume") {
    const config = await readConfig(paths.configPath);
    if (!config.pendingPairing) {
      io.stderr("no pending pairing request\n");
      return ExitCode.unavailable;
    }
    const body: PairingConsumeRequest = {
      sessionId: config.pendingPairing.sessionId,
      shortCodeHash: config.pendingPairing.shortCodeHash
    };
    const response = await clientFor(config, secrets, deps).request<{
      accountId: string;
      routingId: string;
      deviceId: string;
      wrappedGroupKey: string;
      keyVersion: number;
    }>("POST", "/v1/pairing/consume", body, false);
    const groupKey = unwrapGroupKey({
      wrappedGroupKey: response.wrappedGroupKey,
      recipientPrivateKey: await requireSecret(secrets, SecretName.wrappingPrivateKey),
      recipientPublicKey: config.wrapPublicKey
    });
    await secrets.set(SecretName.groupKey, groupKey);
    const next = { ...config, accountId: response.accountId, routingId: response.routingId, keyVersion: response.keyVersion };
    delete next.pendingPairing;
    await writeConfig(next, paths.configPath);
    io.stdout(`paired ${response.deviceId}\n`);
    return ExitCode.ok;
  }
  if (subcommand === "grant") {
    const action = argv[1] ?? "";
    if (action === "create") {
      const config = await readConfig(paths.configPath);
      const tokenTtlOption = option(argv, "--token-ttl");
      const deviceTtlOption = option(argv, "--device-ttl");
      const tokenTtlMs = tokenTtlOption ? parseDurationMs(tokenTtlOption, "--token-ttl") : JOIN_GRANT_TOKEN_TTL_MS;
      const deviceTtlMs = deviceTtlOption ? parseDurationMs(deviceTtlOption, "--device-ttl") : null;
      const maxUses = parseUses(option(argv, "--uses") ?? "1");
      validateGrantOptions(tokenTtlMs, deviceTtlMs, maxUses);
      const grantId = `grant_${randomBase64Url(16)}`;
      const redeemSecret = randomBase64Url(32);
      const sealSecret = randomBase64Url(32);
      const tokenExpiresAt = Date.now() + tokenTtlMs;
      const sealedGroupKey = sealJoinGrant({
        groupKey: await requireSecret(secrets, SecretName.groupKey),
        accountId: config.accountId,
        grantId,
        sealSecret,
        keyVersion: config.keyVersion,
        tokenExpiresAt,
        maxUses,
        deviceTtlMs
      });
      const joinToken = createJoinGrantToken({ endpoint: config.endpoint, accountId: config.accountId, grantId, redeemSecret, sealSecret });
      const label = option(argv, "--label");
      const bodyBase = {
        grantId,
        redeemSecretHash: hashJoinGrantRedeemSecret(config.accountId, grantId, redeemSecret),
        sealedGroupKey,
        keyVersion: config.keyVersion,
        tokenExpiresAt,
        deviceTtlMs,
        maxUses
      };
      const body: PairingGrantCreateRequest = label ? { ...bodyBase, label } : bodyBase;
      const response = await clientFor(config, secrets, deps).request<{
        grantId: string;
        tokenExpiresAt: number;
        deviceTtlMs: number | null;
        maxUses: number;
        createdAt: number;
      }>("POST", "/v1/pairing/grants", body);
      if (argv.includes("--json")) {
        io.stdout(JSON.stringify({ ...response, joinToken }, null, 2) + "\n");
      } else {
        io.stdout(`grant ${response.grantId}\n`);
        io.stdout(`token expires ${new Date(response.tokenExpiresAt).toISOString()}\n`);
        if (response.deviceTtlMs !== null) io.stdout(`device ttl ${response.deviceTtlMs}ms\n`);
        io.stdout(`join token ${joinToken}\n`);
      }
      return ExitCode.ok;
    }
    if (action === "revoke") {
      const grantId = argv[2];
      if (!grantId) return ExitCode.usage;
      const config = await readConfig(paths.configPath);
      await clientFor(config, secrets, deps).request("POST", `/v1/pairing/grants/${encodeURIComponent(grantId)}/revoke`, {});
      io.stdout(`revoked ${grantId}\n`);
      return ExitCode.ok;
    }
  }
  if (subcommand === "join") {
    const token = option(argv, "--token") ?? Bun.env.PASTA_JOIN_TOKEN;
    if (!token) {
      io.stderr("pair join needs --token or PASTA_JOIN_TOKEN\n");
      return ExitCode.usage;
    }
    const parsed = parseJoinGrantToken(token);
    const deviceName = option(argv, "--device-name") ?? defaultDeviceName();
    const deviceId = newDeviceId();
    const keyMaterial = generateDeviceKeyMaterial();
    const joinConfig: PastaConfig = {
      endpoint: parsed.endpoint,
      accountId: parsed.accountId,
      routingId: "",
      deviceId,
      deviceName,
      verifyPublicKey: keyMaterial.signing.publicKey,
      wrapPublicKey: keyMaterial.wrapping.publicKey,
      keyVersion: 1
    };
    const response = await clientFor(joinConfig, secrets, deps).request<PairingGrantRedeemResponse>(
      "POST",
      "/v1/pairing/grants/redeem",
      {
        grantId: parsed.grantId,
        redeemSecret: parsed.redeemSecret,
        newDeviceId: deviceId,
        newDeviceName: deviceName,
        verifyPublicKey: keyMaterial.signing.publicKey,
        wrapPublicKey: keyMaterial.wrapping.publicKey
      },
      false
    );
    if (response.accountId !== parsed.accountId || response.deviceId !== deviceId) {
      throw new Error("join response mismatch");
    }
    const groupKey = openJoinGrant({
      sealedGroupKey: response.sealedGroupKey,
      accountId: response.accountId,
      grantId: parsed.grantId,
      sealSecret: parsed.sealSecret
    });
    await secrets.set(SecretName.groupKey, groupKey);
    await secrets.set(SecretName.signingPrivateKey, keyMaterial.signing.privateKey);
    await secrets.set(SecretName.wrappingPrivateKey, keyMaterial.wrapping.privateKey);
    const next: PastaConfig = {
      endpoint: parsed.endpoint,
      accountId: response.accountId,
      routingId: response.routingId,
      deviceId: response.deviceId,
      deviceName,
      verifyPublicKey: keyMaterial.signing.publicKey,
      wrapPublicKey: keyMaterial.wrapping.publicKey,
      keyVersion: response.keyVersion
    };
    if (response.deviceExpiresAt !== null) next.deviceExpiresAt = response.deviceExpiresAt;
    await writeConfig(next, paths.configPath);
    io.stdout(`joined ${response.deviceId}\n`);
    if (response.deviceExpiresAt !== null) io.stdout(`expires ${new Date(response.deviceExpiresAt).toISOString()}\n`);
    return ExitCode.ok;
  }
  io.stdout("pair commands: ticket, request, consume, grant create, grant revoke, join\n");
  return ExitCode.usage;
}

async function devicesCommand(
  argv: string[],
  io: CliIo,
  paths: Paths,
  secrets: SecretStore,
  deps: CliDeps
): Promise<ExitCodeValue> {
  const config = await readConfig(paths.configPath);
  const client = clientFor(config, secrets, deps);
  if (argv[0] === "list" || !argv[0]) {
    const path = argv.includes("--include-revoked") ? "/v1/devices?includeRevoked=true" : "/v1/devices";
    const response = await client.request<{ devices: Array<{ deviceId: string; deviceName: string; status: string }> }>("GET", path);
    for (const device of response.devices) {
      io.stdout(`${device.deviceId}\t${device.status}\t${device.deviceName}\n`);
    }
    return ExitCode.ok;
  }
  if (argv[0] === "approve") {
    const code = argv[1];
    if (!code) return ExitCode.usage;
    const shortCodeHash = hashShortCode(code, config.accountId);
    const pending = await client.request<{ session: { new_device_id: string; new_device_pubkeys_json: string } }>(
      "GET",
      `/v1/pairing/pending?shortCodeHash=${encodeURIComponent(shortCodeHash)}`
    );
    const pubkeys = JSON.parse(pending.session.new_device_pubkeys_json) as { wrapPublicKey: string };
    const wrappedGroupKey = wrapGroupKey({
      groupKey: await requireSecret(secrets, SecretName.groupKey),
      senderPrivateKey: await requireSecret(secrets, SecretName.wrappingPrivateKey),
      senderPublicKey: config.wrapPublicKey,
      recipientPublicKey: pubkeys.wrapPublicKey
    });
    await client.request("POST", "/v1/pairing/approve", {
      shortCodeHash,
      wrappedGroupKey,
      keyVersion: config.keyVersion
    });
    io.stdout(`approved ${pending.session.new_device_id}\n`);
    return ExitCode.ok;
  }
  if (argv[0] === "revoke") {
    const target = argv[1];
    if (!target) return ExitCode.usage;
    await client.request("POST", `/v1/devices/${encodeURIComponent(target)}/revoke`, {});
    io.stdout(`revoked ${target}\n`);
    return ExitCode.ok;
  }
  return ExitCode.usage;
}

function clientFor(config: PastaConfig, secrets: SecretStore, deps: Pick<CliDeps, "clientFactory">): ApiClient {
  return deps.clientFactory?.(config, secrets) ?? new FetchApiClient(config, secrets);
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

function repeatedOption(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value; ${shellKeySpecHelp()}`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

function shellKeybindingOptionsFromArgs(argv: string[]): ShellKeybindingOptions {
  const copyKeys = repeatedOption(argv, "--copy-key");
  const pasteKeys = repeatedOption(argv, "--paste-key");
  const options: ShellKeybindingOptions = {};
  const envCopyKeys = envKeySpec(Bun.env.PASTA_COPY_KEY);
  const envPasteKeys = envKeySpec(Bun.env.PASTA_PASTE_KEY);
  if (copyKeys.length > 0) options.copyKeys = copyKeys;
  else if (envCopyKeys) options.copyKeys = envCopyKeys;
  if (pasteKeys.length > 0) options.pasteKeys = pasteKeys;
  else if (envPasteKeys) options.pasteKeys = envPasteKeys;
  return options;
}

function envKeySpec(value: string | undefined): string[] | undefined {
  const trimmed = value?.trim();
  return trimmed ? [trimmed] : undefined;
}

function firstPositional(argv: string[]): string | undefined {
  const valueOptions = new Set([
    "--endpoint",
    "--device-name",
    "--ticket",
    "--account-id",
    "--routing-id",
    "--seq",
    "--out",
    "--mime",
    "--path",
    "--command",
    "--interval-ms",
    "--token",
    "--token-ttl",
    "--device-ttl",
    "--uses",
    "--label",
    "--copy-key",
    "--paste-key"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === "--") return argv[index + 1];
    if (valueOptions.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

function parseDurationMs(value: string | undefined, label: string): number {
  if (!value) throw new Error(`${label} requires a duration`);
  const match = value.match(/^([1-9][0-9]*)([smhd])$/u);
  if (!match?.[1] || !match[2]) {
    throw new Error(`${label} must use s, m, h, or d`);
  }
  const count = Number.parseInt(match[1], 10);
  const unitMs: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };
  const factor = unitMs[match[2]];
  if (factor === undefined) throw new Error(`${label} must use s, m, h, or d`);
  const ms = count * factor;
  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw new Error(`${label} is too large`);
  }
  return ms;
}

function parseUses(value: string): number {
  const uses = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(uses) || String(uses) !== value || uses < 1) {
    throw new Error("--uses must be a positive integer");
  }
  return uses;
}

function validateGrantOptions(tokenTtlMs: number, deviceTtlMs: number | null, maxUses: number): void {
  if (tokenTtlMs > JOIN_GRANT_TOKEN_TTL_MAX_MS) {
    throw new Error("--token-ttl must be no greater than 24h");
  }
  if (deviceTtlMs !== null && deviceTtlMs > JOIN_GRANT_DEVICE_TTL_MAX_MS) {
    throw new Error("--device-ttl must be no greater than 30d");
  }
  if (maxUses > JOIN_GRANT_MAX_USES) {
    throw new Error(`--uses must be no greater than ${JOIN_GRANT_MAX_USES}`);
  }
}

function parsePairTicket(ticket: string): { endpoint: string; accountId: string; routingId: string } {
  const url = new URL(ticket);
  return {
    endpoint: url.searchParams.get("endpoint") ?? "",
    accountId: url.searchParams.get("account") ?? "",
    routingId: url.searchParams.get("routing") ?? ""
  };
}

function mimeForPath(filePath: string, detected: string | undefined): string {
  if (detected) return detected;
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".tar")) return "application/x-tar";
  if (lower.endsWith(".gz")) return "application/gzip";
  return "application/octet-stream";
}

function isClipboardPng(mime: string): boolean {
  return mime === "image/png";
}

function clipIsImageLike(clip: StoredClip): boolean {
  return clip.payloadKind === "image" || clip.mime.startsWith("image/");
}

function clipIsDirectoryBundle(clip: EncryptedClip): boolean {
  return clip.payloadKind === "file" && clip.mime === DIRECTORY_BUNDLE_MIME;
}

async function renderHistoryClip(config: PastaConfig, secrets: SecretStore, clip: StoredClip): Promise<string> {
  const base = `${clip.payloadKind} ${clip.mime} ${clip.byteLen} bytes encrypted`;
  if (clip.payloadKind === "text") {
    return `${base} ${JSON.stringify(previewText(await decryptStored(config, secrets, clip)))}`;
  }
  if (clip.payloadKind === "file") {
    return `${base} ${JSON.stringify(await displayFileName(config, secrets, clip))}`;
  }
  return base;
}

async function displayFileName(config: PastaConfig, secrets: SecretStore, clip: EncryptedClip): Promise<string> {
  const metadata = await decryptStoredMetadata(config, secrets, clip);
  return safeFileName(metadata?.name) ?? defaultOutputName(clip);
}

async function defaultOutputPath(config: PastaConfig, secrets: SecretStore, clip: EncryptedClip): Promise<string> {
  return displayFileName(config, secrets, clip);
}

function metadataForPath(filePath: string): ClipMetadata | undefined {
  const name = safeFileName(basename(trimPathTrailingSeparators(filePath)));
  return name ? { name } : undefined;
}

function safeFileName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const withoutNulls = name.replace(/\0/gu, "");
  const base = basename(trimPathTrailingSeparators(withoutNulls));
  if (!base || base === "." || base === "..") return undefined;
  return base;
}

function trimPathTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, "") || value;
}

function defaultOutputName(clip: EncryptedClip): string {
  if (clipIsDirectoryBundle(clip)) return "output-directory";
  return `output.${extensionForMime(clip.mime)}`;
}

function extensionForMime(mime: string): string {
  const normalized = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const byMime: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "application/x-tar": "tar",
    "application/gzip": "gz",
    "text/plain": "txt",
    "application/json": "json"
  };
  return byMime[normalized] ?? "bin";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 48)}...${normalized.slice(-16)}`;
}

function parseSeq(value: string | undefined): number | null {
  if (!value) return null;
  const seq = Number.parseInt(value, 10);
  return Number.isSafeInteger(seq) && seq > 0 && String(seq) === value ? seq : null;
}

function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function commandHelp(command: string): string {
  const blocks: Record<string, string> = {
    bootstrap: `usage: pasta bootstrap --endpoint <url> [--device-name <name>]

Creates the first trusted device and stores auth in the local Pasta auth cache.

Examples:
  pasta bootstrap --endpoint https://pasta.nothuman.work --device-name "$(hostname)"
  pasta bootstrap --endpoint http://127.0.0.1:8787 --device-name test-mac
`,
    doctor: `usage: pasta doctor

Checks local clipboard adapter availability.

Examples:
  pasta doctor
`,
    copy: `usage: pasta copy [path] [--path <path>] [--image|--file] [--mime <type>]

Copies text, image, file, or directory data. Piped stdin is text. A path is detected as an image when possible, as a directory when it is one, otherwise as a file.
Directory paths are bundled locally as zip bytes before encryption.
--mime is optional; Pasta infers a MIME type from the file and extension, then falls back to application/octet-stream.

Examples:
  echo "hello" | pasta copy
  pasta copy
  pasta copy ./Downloads/unlimit.png
  pasta copy ./project-folder
  pasta copy --path ./archive.zip --mime application/zip
  pasta copy --image
  pasta copy --file ./notes.txt --mime text/plain
`,
    paste: `usage: pasta paste [--clipboard] [--seq <n>] [--out <path>] [--image|--file]

Pulls the latest or selected encrypted clip, decrypts locally, and routes by payload kind.
File clips save to the original basename, or output.<ext> when no basename exists; use --out to choose a path.
Directory bundles extract to the original basename, or use --out to choose a directory that does not already exist.

Examples:
  pasta paste
  pasta paste --clipboard
  pasta paste --seq 12
  pasta paste --out ./received.bin
  pasta paste --out ./received-project
  pasta paste --image --out ./screenshot.png
  pasta paste --file --seq 21 --out ./received.zip
`,
    history: `usage: pasta history [--show] | pasta history paste <seq> [--clipboard] | pasta history delete <seq>

Lists history with local text previews and file names, pastes a selected text entry, or deletes a selected history entry.

Examples:
  pasta history
  pasta history --show
  pasta history paste 7
  pasta history paste 7 --clipboard
  pasta history delete 7
`,
    daemon: `usage: pasta daemon [--once] [--dry-run] [--interval-ms <n>]

Polls the clipboard and auto-publishes local text changes.

Examples:
  pasta daemon
  pasta daemon --once
  pasta daemon --dry-run
  pasta daemon --interval-ms 2000
`,
    pair: `usage: pasta pair ticket | pasta pair request --ticket <payload> | pasta pair consume
       pasta pair grant create [--token-ttl <duration>] [--device-ttl <duration>] [--uses <n>] [--label <text>] [--json]
       pasta pair grant revoke <grantId>
       pasta pair join --token <joinToken> [--device-name <name>]

Creates, requests, consumes, or grants a trusted-device pairing flow.
Grant tokens default to a 10 minute redemption TTL, no device auto-revocation, and one use.

Examples:
  pasta pair ticket
  pasta pair request --ticket 'pasta://pair?...' --device-name "$(hostname)"
  pasta pair consume
  pasta pair grant create --token-ttl 10m --json
  pasta pair grant create --device-ttl 24h --label modal-smoke --json
  pasta pair join --token "$PASTA_JOIN_TOKEN" --device-name modal-sandbox
  PASTA_JOIN_TOKEN="$token" pasta pair join --device-name modal-sandbox
  pasta pair grant revoke grant_example
`,
    devices: `usage: pasta devices list [--include-revoked] | pasta devices approve <code> | pasta devices revoke <device>

Lists active devices by default, approves pair requests, or revokes trusted devices.
Use --include-revoked to show revoked device rows for governance/history.

Examples:
  pasta devices list
  pasta devices list --include-revoked
  pasta devices approve 123456
  pasta devices revoke dev_example
`,
    reset: `usage: pasta reset --yes

Resets the encrypted clipboard space from a trusted device.

Examples:
  pasta reset --yes
`,
    "install-shell": `usage: pasta install-shell [--command <command>] [--shell auto|zsh|bash|fish|powershell] [--copy-key <key>]... [--paste-key <key>]...

Installs a reversible shell snippet with non-overriding aliases and configurable keybindings.

Supported key specs: hyper+<letter>, alt+<letter>, ctrl+x,<letter>, none.
Defaults: copy hyper+c and ctrl+x,c; paste hyper+p and ctrl+x,p.

Examples:
  pasta install-shell
  pasta install-shell --shell powershell
  pasta install-shell --copy-key alt+c --paste-key alt+p
  pasta install-shell --command "$PWD/src/cli.ts"
`,
    "uninstall-shell": `usage: pasta uninstall-shell [--shell all|auto|zsh|bash|fish|powershell]

Clears Pasta-generated shell snippets.

Examples:
  pasta uninstall-shell
  pasta uninstall-shell --shell fish
`,
    protocol: `usage: pasta protocol

Prints protocol endpoint metadata.

Examples:
  pasta protocol
`,
    "payload-plan": `usage: pasta payload-plan

Prints binary payload limits and storage design metadata.

Examples:
  pasta payload-plan
`
  };
  return blocks[command] ?? helpText();
}

function helpText(): string {
  return `${[
    `pasta ${PASTA_VERSION}`,
    "",
    "Commands:",
    "  bootstrap --endpoint <url> [--device-name <name>]",
    "  pair ticket | pair request --ticket <payload> | pair consume",
    "  pair grant create [--json] | pair grant revoke <grantId> | pair join --token <token>",
    "  devices list [--include-revoked] | devices approve <code> | devices revoke <device>",
    "  copy [path] [--image|--file] [--mime <type>]",
    "  paste [--clipboard] [--seq <n>] [--out <path>]",
    "  history [--show] | history paste <seq>",
    "  daemon [--once] [--dry-run] [--interval-ms <n>]",
    "  doctor",
    "  reset --yes",
    "  install-shell | uninstall-shell",
    "",
    "Examples:",
    "  echo hello | pasta copy",
    "  pasta copy ./Downloads/unlimit.png",
    "  pasta copy ./project-folder",
    "  pasta paste --clipboard",
    "  pasta paste --out ./received.bin",
    "",
    "Shell snippet:",
    shellSnippet("pasta")
  ].join("\n")}\n`;
}

if (import.meta.main) {
  const code = await runCli(Bun.argv.slice(2));
  process.exit(code);
}
