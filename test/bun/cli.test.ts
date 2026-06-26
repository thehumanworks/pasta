import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { clipboardCandidatesForPlatform, MemoryClipboardAdapter } from "../../src/cli/clipboard";
import { FetchApiClient, MockApiClient } from "../../src/cli/client";
import { readConfig, type PastaConfig, type Paths, writeConfig } from "../../src/cli/config";
import { MemorySecretStore, SecretName } from "../../src/cli/secret-store";
import { runCli } from "../../src/cli";
import { encryptTextClip, generateDeviceKeyMaterial, generateGroupKey } from "../../src/shared/crypto";
import { LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES, LARGE_PAYLOAD_MAX_BYTES, PASTA_VERSION, type StoredClip } from "../../src/shared/protocol";
import { shellSnippet } from "../../src/cli/shell";

describe("CLI", () => {
  it("prints version and help", async () => {
    const output: string[] = [];
    expect(await runCli(["--version"], { io: capture(output) })).toBe(0);
    expect(output.join("")).toContain(PASTA_VERSION);
    output.length = 0;
    expect(await runCli(["--help"], { io: capture(output) })).toBe(0);
    expect(output.join("")).toContain("bootstrap");
    expect(output.join("")).toContain("Examples:");
    for (const [args, expected] of [
      [["bootstrap", "--help"], "pasta bootstrap --endpoint https://pasta.nothuman.work"],
      [["copy", "--help"], "pasta copy ./Downloads/unlimit.png"],
      [["paste", "--help"], "pasta paste --out ./received.bin"],
      [["history", "--help"], "pasta history paste 7 --clipboard"],
      [["daemon", "--help"], "pasta daemon --interval-ms 2000"],
      [["pair", "--help"], "pasta pair consume"],
      [["devices", "--help"], "pasta devices revoke dev_example"],
      [["doctor", "--help"], "pasta doctor"],
      [["reset", "--help"], "pasta reset --yes"],
      [["install-shell", "--help"], "pasta install-shell --command"],
      [["uninstall-shell", "--help"], "pasta uninstall-shell"],
      [["protocol", "--help"], "pasta protocol"],
      [["payload-plan", "--help"], "pasta payload-plan"]
    ] as Array<[string[], string]>) {
      output.length = 0;
      expect(await runCli(args, { io: capture(output) }), args.join(" ")).toBe(0);
      expect(output.join(""), args.join(" ")).toContain("Examples:");
      expect(output.join(""), args.join(" ")).toContain(expected);
    }
    for (const removed of ["copy-image", "paste-image", "send-file", "paste-file"]) {
      output.length = 0;
      expect(await runCli([removed, "--help"], { io: capture(output) }), removed).toBe(2);
      expect(output.join(""), removed).toContain(`unknown command: ${removed}`);
    }
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
    clipboard.value = "";
    expect(await runCli(["paste", "--clipboard"], deps)).toBe(0);
    expect(clipboard.value).toBe("alpha");
    output.length = 0;
    expect(await runCli(["history", "--show"], deps)).toBe(0);
    expect(output.join("")).toContain("alpha");

    await writeConfig({ ...config, lastRemotePasteHash: await import("../../src/shared/protocol").then((m) => m.sha256Base64Url("alpha")) }, paths.configPath);
    clipboard.value = "alpha";
    output.length = 0;
    expect(await runCli(["daemon", "--once"], deps)).toBe(0);
    expect(JSON.parse(output.join("")).published).toBe(0);
  });

  it("copies and pastes inline image clipboard bytes", async () => {
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
      throw new Error(`unexpected ${method} ${path}`);
    });
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const clipboard = new MemoryClipboardAdapter("", { mime: "image/png", bytes: png });
    const output: string[] = [];
    const deps = { io: capture(output), paths, secrets, clipboard, clientFactory: () => client };

    expect(await runCli(["copy", "--image"], deps)).toBe(0);
    expect(clips[0]?.payloadKind).toBe("image");
    expect(clips[0]?.ciphertext).not.toContain("PNG");
    clipboard.image = null;
    expect(await runCli(["paste", "--image"], deps)).toBe(0);
    const pasted = clipboard.image as { mime: "image/png"; bytes: Uint8Array } | null;
    expect(pasted?.mime).toBe("image/png");
    expect(pasted?.bytes).toEqual(png);
  });

  it("routes unified copy and paste for image paths and file paths", async () => {
    const paths = await tempPaths();
    const secrets = new MemorySecretStore();
    const groupKey = generateGroupKey();
    await secrets.set(SecretName.groupKey, groupKey);
    await secrets.set(SecretName.signingPrivateKey, generateDeviceKeyMaterial().signing.privateKey);
    await secrets.set(SecretName.wrappingPrivateKey, generateDeviceKeyMaterial().wrapping.privateKey);
    const config = sampleConfig();
    await writeConfig(config, paths.configPath);
    let nextSeq = 1;
    const clips: StoredClip[] = [];
    const storedFiles = new Map<number, { clip: StoredClip; ciphertext: string }>();
    const client = new MockApiClient(({ method, path, body }) => {
      if (method === "POST" && path === "/v1/clips") {
        const clip = { ...(body as StoredClip), seq: nextSeq++ };
        clips.push(clip);
        return { clip };
      }
      if (method === "POST" && path === "/v1/files") {
        const source = body as StoredClip;
        const clip = { ...source, seq: nextSeq++, ciphertext: "", storageKind: "r2" as const, r2Key: `spaces/test/${nextSeq}/payload` };
        clips.push(clip);
        storedFiles.set(clip.seq, { clip, ciphertext: source.ciphertext });
        return { clip };
      }
      if (path === "/v1/clips/latest") return { clip: clips.at(-1) ?? null };
      if (path.startsWith("/v1/clips/")) return { clip: clips.find((clip) => clip.seq === Number(path.split("/").at(-1))) };
      if (method === "GET" && path.startsWith("/v1/files/")) return storedFiles.get(Number(path.split("/").at(-1)));
      throw new Error(`unexpected ${method} ${path}`);
    });
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const largePng = new Uint8Array(LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES + 1).fill(5);
    largePng.set(png.slice(0, 8), 0);
    const pngPath = join(paths.home, "unlimit.png");
    const largePngPath = join(paths.home, "large.png");
    const fakePngPath = join(paths.home, "fake.png");
    const filePath = join(paths.home, "notes.bin");
    const imageOut = join(paths.home, "image.png");
    const largeImageOut = join(paths.home, "large-image.png");
    const out = join(paths.home, "received.bin");
    const outSeq = join(paths.home, "received-seq.bin");
    await Bun.write(pngPath, png);
    await Bun.write(largePngPath, largePng);
    await Bun.write(fakePngPath, new Uint8Array([1, 2, 3, 4]));
    await Bun.write(filePath, new Uint8Array([9, 8, 7, 6]));
    const clipboard = new MemoryClipboardAdapter();
    const output: string[] = [];
    const deps = { io: capture(output), paths, secrets, clipboard, clientFactory: () => client };

    expect(await runCli(["copy", pngPath], deps)).toBe(0);
    expect(clips.at(-1)?.payloadKind).toBe("image");
    expect(await runCli(["paste"], deps)).toBe(0);
    expect(clipboard.image?.bytes).toEqual(png);
    expect(await runCli(["paste", "--image", "--out", imageOut], deps)).toBe(0);
    expect(new Uint8Array(await Bun.file(imageOut).arrayBuffer())).toEqual(png);

    output.length = 0;
    expect(await runCli(["copy", "--path", pngPath], deps)).toBe(0);
    expect(clips.at(-1)?.payloadKind).toBe("image");
    expect(await runCli(["copy", "--image", fakePngPath], deps)).not.toBe(0);
    expect(output.join("")).toContain("requires PNG image bytes");
    output.length = 0;
    expect(await runCli(["copy", fakePngPath], deps)).toBe(0);
    expect(clips.at(-1)?.payloadKind).toBe("file");
    output.length = 0;
    expect(await runCli(["copy", largePngPath], deps)).toBe(0);
    expect(clips.at(-1)?.payloadKind).toBe("image");
    expect(clips.at(-1)?.storageKind).toBe("r2");
    expect(await runCli(["paste", "--image", "--out", largeImageOut], deps)).toBe(0);
    expect(new Uint8Array(await Bun.file(largeImageOut).arrayBuffer())).toEqual(largePng);

    output.length = 0;
    expect(await runCli(["copy", filePath], deps)).toBe(0);
    const fileSeq = clips.at(-1)?.seq;
    expect(clips.at(-1)?.payloadKind).toBe("file");
    output.length = 0;
    expect(await runCli(["paste"], deps)).toBe(2);
    expect(output.join("")).toContain("file clip needs --out");
    expect(await runCli(["paste", "--out", out], deps)).toBe(0);
    expect(new Uint8Array(await Bun.file(out).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(await runCli(["paste", "--file", "--seq", String(fileSeq), "--out", outSeq], deps)).toBe(0);
    expect(new Uint8Array(await Bun.file(outSeq).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
    output.length = 0;
    expect(await runCli(["paste", "--file", "--seq", String(fileSeq)], deps)).toBe(2);
    expect(output.join("")).toContain("file clip needs --out");
  });

  it("sends and pastes bounded file payloads through the R2-backed API path", async () => {
    const paths = await tempPaths();
    const secrets = new MemorySecretStore();
    const groupKey = generateGroupKey();
    await secrets.set(SecretName.groupKey, groupKey);
    await secrets.set(SecretName.signingPrivateKey, generateDeviceKeyMaterial().signing.privateKey);
    await secrets.set(SecretName.wrappingPrivateKey, generateDeviceKeyMaterial().wrapping.privateKey);
    const config = sampleConfig();
    await writeConfig(config, paths.configPath);
    const storedFiles: Array<{ clip: StoredClip; ciphertext: string }> = [];
    const client = new MockApiClient(({ method, path, body }) => {
      if (method === "POST" && path === "/v1/files") {
        const source = body as StoredClip;
        const stored = { ...source, seq: storedFiles.length + 1, ciphertext: "", storageKind: "r2" as const, r2Key: `spaces/test/${storedFiles.length + 1}/payload` };
        storedFiles.push({ clip: stored, ciphertext: source.ciphertext });
        return { clip: stored };
      }
      if (path === "/v1/clips/latest") return { clip: storedFiles.at(-1)?.clip ?? null };
      if (method === "GET" && path.startsWith("/v1/files/")) return storedFiles[Number(path.split("/").at(-1)) - 1];
      throw new Error(`unexpected ${method} ${path}`);
    });
    const small = join(paths.home, "small.bin");
    const medium = join(paths.home, "medium.bin");
    const out = join(paths.home, "out.bin");
    await Bun.write(small, new Uint8Array([1, 2, 3, 4]));
    await Bun.write(medium, new Uint8Array(64 * 1024).fill(7));
    const output: string[] = [];
    const deps = { io: capture(output), paths, secrets, clientFactory: () => client };

    expect(await runCli(["copy", "--file", small], deps)).toBe(0);
    expect(await runCli(["copy", "--file", medium, "--mime", "application/octet-stream"], deps)).toBe(0);
    expect(storedFiles).toHaveLength(2);
    expect(storedFiles[1]?.clip.storageKind).toBe("r2");
    expect(storedFiles[1]?.clip.r2Key).toContain("spaces/");
    expect(await runCli(["paste", "--file", "--seq", "2", "--out", out], deps)).toBe(0);
    expect(new Uint8Array(await Bun.file(out).arrayBuffer())).toEqual(new Uint8Array(64 * 1024).fill(7));

    const tooLarge = join(paths.home, "too-large.bin");
    await Bun.spawn(["truncate", "-s", String(LARGE_PAYLOAD_MAX_BYTES + 1), tooLarge]).exited;
    output.length = 0;
    expect(await runCli(["copy", "--file", tooLarge], deps)).not.toBe(0);
    expect(output.join("")).toContain("exceeds max size");
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

  it("reports the binary payload design boundaries", async () => {
    const output: string[] = [];
    expect(await runCli(["payload-plan"], { io: capture(output) })).toBe(0);
    const plan = JSON.parse(output.join("")) as {
      inlineThresholdBytes: number;
      maxBytes: number;
      r2KeyFormat: string;
      finalizeSemantics: string;
    };
    expect(plan.inlineThresholdBytes).toBe(512 * 1024);
    expect(plan.maxBytes).toBe(50 * 1024 * 1024);
    expect(plan.r2KeyFormat).toBe("spaces/{routing_id}/clips/{seq}/{payload_id}");
    expect(plan.finalizeSemantics).toContain("signed finalize");
  });

  it("reports non-JSON HTTP responses without a parser stack", async () => {
    const fetchImpl = (async () => new Response("<html>not a worker</html>", { status: 404 })) as unknown as typeof fetch;
    const client = new FetchApiClient(sampleConfig(), new MemorySecretStore(), fetchImpl);
    await expect(client.request("GET", "/v1/devices", undefined, false)).rejects.toThrow("http_404: <html>not a worker</html>");
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
