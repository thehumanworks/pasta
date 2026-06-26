import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { clipboardCandidatesForPlatform, MemoryClipboardAdapter } from "../../src/cli/clipboard";
import { MockApiClient } from "../../src/cli/client";
import { readConfig, type PastaConfig, type Paths, writeConfig } from "../../src/cli/config";
import { MemorySecretStore, SecretName } from "../../src/cli/secret-store";
import { runCli } from "../../src/cli";
import { encryptTextClip, generateDeviceKeyMaterial, generateGroupKey } from "../../src/shared/crypto";
import type { StoredClip } from "../../src/shared/protocol";
import { shellSnippet } from "../../src/cli/shell";

describe("CLI", () => {
  it("prints version and help", async () => {
    const output: string[] = [];
    expect(await runCli(["--version"], { io: capture(output) })).toBe(0);
    expect(output.join("")).toContain("0.1.0");
    output.length = 0;
    expect(await runCli(["--help"], { io: capture(output) })).toBe(0);
    expect(output.join("")).toContain("bootstrap");
  });

  it("bootstraps config with Bun.secrets-compatible secret store and no raw secret config fields", async () => {
    const output: string[] = [];
    const secrets = new MemorySecretStore();
    const paths = await tempPaths();
    const client = new MockApiClient(() => ({ ok: true }));
    const code = await runCli(["bootstrap", "--endpoint", "https://relay.example", "--device-name", "desk"], {
      io: capture(output),
      paths,
      secrets,
      clientFactory: () => client
    });
    expect(code).toBe(0);
    const config = await readConfig(paths.configPath);
    expect(config.endpoint).toBe("https://relay.example");
    expect(config.deviceName).toBe("desk");
    expect(await secrets.get(SecretName.groupKey)).toBeTruthy();
    const configText = await Bun.file(paths.configPath).text();
    expect(configText).not.toContain("group-key");
    expect(configText).not.toContain("private-key");
  });

  it("copies, pastes, lists history, and avoids daemon publish loops", async () => {
    const paths = await tempPaths();
    const secrets = new MemorySecretStore();
    const groupKey = generateGroupKey();
    await secrets.set(SecretName.groupKey, groupKey);
    await secrets.set(SecretName.signingPrivateKey, generateDeviceKeyMaterial().signing.privateKey);
    await secrets.set(SecretName.wrappingPrivateKey, generateDeviceKeyMaterial().wrapping.privateKey);
    const config = sampleConfig();
    await writeConfig(config, paths.configPath);
    const clips: StoredClip[] = [];
    const client = new MockApiClient(({ method, path, body }) => {
      if (method === "POST" && path === "/v1/clips") {
        const clip = { ...(body as StoredClip), seq: clips.length + 1 };
        clips.push(clip);
        return { clip };
      }
      if (path === "/v1/clips/latest") return { clip: clips.at(-1) ?? null };
      if (path.startsWith("/v1/clips/history")) return { clips: [...clips].reverse() };
      if (path === "/v1/clips/1") return { clip: clips[0] };
      throw new Error(`unexpected ${method} ${path}`);
    });
    const clipboard = new MemoryClipboardAdapter("alpha");
    const output: string[] = [];
    const deps = { io: capture(output, "alpha"), paths, secrets, clipboard, clientFactory: () => client };

    expect(await runCli(["copy"], deps)).toBe(0);
    expect(clips[0]?.ciphertext).not.toContain("alpha");
    output.length = 0;
    expect(await runCli(["paste"], deps)).toBe(0);
    expect(output.join("")).toContain("alpha");
    output.length = 0;
    expect(await runCli(["history", "--show"], deps)).toBe(0);
    expect(output.join("")).toContain("alpha");

    await writeConfig({ ...config, lastRemotePasteHash: await import("../../src/shared/protocol").then((m) => m.sha256Base64Url("alpha")) }, paths.configPath);
    clipboard.value = "alpha";
    output.length = 0;
    expect(await runCli(["daemon", "--once"], deps)).toBe(0);
    expect(JSON.parse(output.join("")).published).toBe(0);
  });

  it("supports reversible shell integration snippets", async () => {
    const paths = await tempPaths();
    const output: string[] = [];
    expect(shellSnippet("pasta")).toContain("alias pc=");
    expect(await runCli(["install-shell"], { io: capture(output), paths })).toBe(0);
    expect(await Bun.file(paths.shellConfigPath).text()).toContain("pasta copy");
    expect(await runCli(["uninstall-shell"], { io: capture(output), paths })).toBe(0);
    expect(await Bun.file(paths.shellConfigPath).text()).toBe("");
  });

  it("discovers clipboard adapter commands for macOS, Linux, and Windows", () => {
    expect(clipboardCandidatesForPlatform("darwin").map((candidate) => candidate.name)).toEqual(["macos-pbcopy"]);
    expect(clipboardCandidatesForPlatform("linux").map((candidate) => candidate.name)).toEqual([
      "wayland-wl-clipboard",
      "x11-xclip",
      "x11-xsel"
    ]);
    expect(clipboardCandidatesForPlatform("win32").map((candidate) => candidate.name)).toEqual([
      "windows-powershell",
      "windows-pwsh"
    ]);
  });

  it("runs distribution smoke commands without onboarding config", async () => {
    const paths = await tempPaths();
    const output: string[] = [];
    const deps = { io: capture(output), paths, clipboard: new MemoryClipboardAdapter("") };
    expect(await runCli(["paste", "--help"], deps)).toBe(0);
    expect(output.join("")).toContain("usage: pasta paste");
    output.length = 0;
    expect(await runCli(["daemon", "--dry-run"], deps)).toBe(0);
    expect(JSON.parse(output.join("")).published).toBe(0);
  });
});

function sampleConfig(): PastaConfig {
  const keys = generateDeviceKeyMaterial();
  return {
    endpoint: "https://relay.example",
    accountId: "acct_test",
    routingId: "space_test",
    deviceId: "dev_test",
    deviceName: "test",
    verifyPublicKey: keys.signing.publicKey,
    wrapPublicKey: keys.wrapping.publicKey,
    keyVersion: 1
  };
}

async function tempPaths(): Promise<Paths> {
  const home = await mkdtemp(join(tmpdir(), "pasta-test-"));
  return {
    home,
    configPath: join(home, "config.json"),
    shellConfigPath: join(home, "shell.zsh")
  };
}

function capture(output: string[], stdin = "") {
  return {
    stdout: (text: string) => output.push(text),
    stderr: (text: string) => output.push(text),
    stdinText: async () => stdin
  };
}
