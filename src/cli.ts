#!/usr/bin/env bun
import QRCode from "qrcode";
import {
  decryptTextClip,
  encryptTextClip,
  generateDeviceKeyMaterial,
  generateGroupKey,
  hashShortCode,
  makeShortCode,
  unwrapGroupKey,
  wrapGroupKey
} from "./shared/crypto";
import {
  LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES,
  LARGE_PAYLOAD_MAX_BYTES,
  PASTA_VERSION,
  PROTOCOL_ENDPOINTS,
  type BootstrapRequest,
  type EncryptedClip,
  type PairingConsumeRequest,
  type PairingOpenRequest,
  sha256Base64Url,
  type StoredClip
} from "./shared/protocol";
import { randomBase64Url } from "./shared/encoding";
import { SystemClipboardAdapter, type ClipboardAdapter } from "./cli/clipboard";
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
import { BunSecretStore, requireSecret, secretServiceForHome, SecretName, type SecretStore } from "./cli/secret-store";
import { installShell, shellSnippet, uninstallShell } from "./cli/shell";

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

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<ExitCodeValue> {
  const io = deps.io ?? defaultIo;
  const paths = deps.paths ?? defaultPaths();
  const secrets = deps.secrets ?? new BunSecretStore(secretServiceForHome(paths.home));
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
      const endpoint = option(argv, "--endpoint") ?? "http://127.0.0.1:8787";
      const deviceName = option(argv, "--device-name") ?? defaultDeviceName();
      const config = await bootstrap(endpoint, deviceName, paths, secrets, deps.clientFactory);
      io.stdout(`bootstrapped ${config.deviceName} (${config.deviceId})\n`);
      return ExitCode.ok;
    }

    if (command === "doctor") {
      const result = await clipboard.doctor();
      io.stdout(JSON.stringify({ version: PASTA_VERSION, clipboard: result }, null, 2) + "\n");
      return result.available ? ExitCode.ok : ExitCode.unavailable;
    }

    if (command === "copy") {
      if (argv.includes("--help")) {
        io.stdout("usage: pasta copy\n\nReads text from stdin when piped, otherwise from the OS clipboard, then encrypts and publishes it.\n");
        return ExitCode.ok;
      }
      const config = await readConfig(paths.configPath);
      const text = process.stdin.isTTY ? await clipboard.readText() : await deps.io?.stdinText?.() ?? await defaultIo.stdinText();
      await publishText(config, secrets, clientFor(config, secrets, deps), text);
      io.stdout("published\n");
      return ExitCode.ok;
    }

    if (command === "paste") {
      if (argv.includes("--help")) {
        io.stdout("usage: pasta paste [--clipboard] [--seq <n>]\n\nPulls latest or selected encrypted text, decrypts locally, and writes stdout or clipboard.\n");
        return ExitCode.ok;
      }
      const config = await readConfig(paths.configPath);
      const seq = option(argv, "--seq");
      const response = seq
        ? await clientFor(config, secrets, deps).request<{ clip: StoredClip }>("GET", `/v1/clips/${Number.parseInt(seq, 10)}`)
        : await clientFor(config, secrets, deps).request<{ clip: StoredClip | null }>("GET", "/v1/clips/latest");
      if (!response.clip) {
        io.stderr("no remote clip\n");
        return ExitCode.unavailable;
      }
      const plaintext = await decryptStored(config, secrets, response.clip);
      if (argv.includes("--clipboard")) {
        await clipboard.writeText(plaintext);
        await updateConfig((current) => ({ ...current, lastRemotePasteHash: sha256Base64Url(plaintext) }), paths.configPath);
      } else {
        io.stdout(plaintext);
        if (!plaintext.endsWith("\n")) io.stdout("\n");
      }
      return ExitCode.ok;
    }

    if (command === "history") {
      if (argv.includes("--help")) {
        io.stdout("usage: pasta history [--show] | pasta history paste <seq> [--clipboard]\n\nLists encrypted history metadata or pastes a selected entry.\n");
        return ExitCode.ok;
      }
      return historyCommand(argv.slice(1), io, paths, secrets, clipboard, deps);
    }

    if (command === "daemon") {
      if (argv.includes("--help")) {
        io.stdout("usage: pasta daemon [--once] [--dry-run] [--interval-ms <n>]\n\nPolls the clipboard and auto-publishes local text changes.\n");
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
      return pairCommand(argv.slice(1), io, paths, secrets, deps);
    }

    if (command === "devices") {
      return devicesCommand(argv.slice(1), io, paths, secrets, deps);
    }

    if (command === "reset") {
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
      const installed = await installShell(paths, option(argv, "--command") ?? "pasta");
      io.stdout(`installed ${installed}\nsource ${installed}\n`);
      return ExitCode.ok;
    }

    if (command === "uninstall-shell") {
      const uninstalled = await uninstallShell(paths);
      io.stdout(`removed Pasta shell snippet from ${uninstalled}\n`);
      return ExitCode.ok;
    }

    if (command === "protocol") {
      io.stdout(JSON.stringify(PROTOCOL_ENDPOINTS, null, 2) + "\n");
      return ExitCode.ok;
    }

    if (command === "payload-plan") {
      io.stdout(
        JSON.stringify(
          {
            inlineThresholdBytes: LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES,
            maxBytes: LARGE_PAYLOAD_MAX_BYTES,
            r2KeyFormat: "spaces/{routing_id}/clips/{seq}/{payload_id}",
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

async function decryptStored(config: PastaConfig, secrets: SecretStore, clip: EncryptedClip): Promise<string> {
  return decryptTextClip(await requireSecret(secrets, SecretName.groupKey), config.accountId, config.routingId, clip);
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
    const seq = argv[1];
    if (!seq) return ExitCode.usage;
    const response = await client.request<{ clip: StoredClip }>("GET", `/v1/clips/${Number.parseInt(seq, 10)}`);
    const plaintext = await decryptStored(config, secrets, response.clip);
    if (argv.includes("--clipboard")) {
      await clipboard.writeText(plaintext);
    } else {
      io.stdout(plaintext + (plaintext.endsWith("\n") ? "" : "\n"));
    }
    return ExitCode.ok;
  }
  const response = await client.request<{ clips: StoredClip[] }>("GET", "/v1/clips/history?limit=50");
  const showPlaintext = argv.includes("--show");
  for (const clip of response.clips) {
    const rendered = showPlaintext ? await decryptStored(config, secrets, clip) : `${clip.byteLen} bytes encrypted`;
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
  io.stdout("pair commands: ticket, request, consume\n");
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
    const response = await client.request<{ devices: Array<{ deviceId: string; deviceName: string; status: string }> }>("GET", "/v1/devices");
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

function parsePairTicket(ticket: string): { endpoint: string; accountId: string; routingId: string } {
  const url = new URL(ticket);
  return {
    endpoint: url.searchParams.get("endpoint") ?? "",
    accountId: url.searchParams.get("account") ?? "",
    routingId: url.searchParams.get("routing") ?? ""
  };
}

function helpText(): string {
  return `${[
    "pasta 0.1.0",
    "",
    "Commands:",
    "  bootstrap --endpoint <url> [--device-name <name>]",
    "  pair ticket | pair request --ticket <payload> | pair consume",
    "  devices list | devices approve <code> | devices revoke <device>",
    "  copy",
    "  paste [--clipboard] [--seq <n>]",
    "  history [--show] | history paste <seq>",
    "  daemon [--once] [--dry-run] [--interval-ms <n>]",
    "  doctor",
    "  reset --yes",
    "  install-shell | uninstall-shell",
    "",
    "Shell snippet:",
    shellSnippet("pasta")
  ].join("\n")}\n`;
}

if (import.meta.main) {
  const code = await runCli(Bun.argv.slice(2));
  process.exit(code);
}
