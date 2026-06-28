import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "bun:test";
import { clipboardCandidatesForPlatform, MemoryClipboardAdapter } from "../../src/cli/clipboard";
import { FetchApiClient, MockApiClient } from "../../src/cli/client";
import { DIRECTORY_BUNDLE_MIME } from "../../src/cli/directory-zip";
import { readConfig, type PastaConfig, type Paths, writeConfig } from "../../src/cli/config";
import { authFileForHome, defaultSecretStoreForHome, FileSecretStore, MemorySecretStore, ResilientSecretStore, SecretName, type SecretStore } from "../../src/cli/secret-store";
import { runCli } from "../../src/cli";
import { decryptBytesClip, encryptTextClip, generateDeviceKeyMaterial, generateGroupKey, parseJoinGrantToken } from "../../src/shared/crypto";
import { LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES, LARGE_PAYLOAD_MAX_BYTES, PASTA_VERSION, SIGNATURE_HEADERS, type PairingGrantCreateRequest, type StoredClip } from "../../src/shared/protocol";
import { detectShellKind, shellConfigPath, shellSnippet, type ShellKind } from "../../src/cli/shell";

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
      [["history", "--help"], "pasta history delete 7"],
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
      if (args.join(" ") === "copy --help") expect(output.join("")).toContain("pasta copy ./project-folder");
      if (args.join(" ") === "paste --help") expect(output.join("")).toContain("pasta paste --out ./received-project");
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

  it("bootstraps the default secret store for noninteractive terminals", async () => {
    const output: string[] = [];
    const paths = await tempPaths();
    const client = new MockApiClient(() => ({ ok: true }));
    try {
      expect(await runCli(["bootstrap", "--endpoint", "https://relay.example"], {
        io: capture(output),
        paths,
        clientFactory: () => client
      })).toBe(0);
      const secrets = defaultSecretStoreForHome(paths.home, {});
      expect(await secrets.get(SecretName.groupKey)).toBeTruthy();
      expect(await secrets.get(SecretName.signingPrivateKey)).toBeTruthy();
      expect((await stat(authFileForHome(paths.home))).mode & 0o777).toBe(0o600);
      expect(await Bun.file(join(paths.home, "secrets.json")).exists()).toBe(false);
      const configText = await Bun.file(paths.configPath).text();
      expect(configText).not.toContain("group-key");
      expect(configText).not.toContain("private-key");
    } finally {
      const secrets = defaultSecretStoreForHome(paths.home, {});
      await secrets.delete(SecretName.groupKey);
      await secrets.delete(SecretName.signingPrivateKey);
      await secrets.delete(SecretName.wrappingPrivateKey);
    }
  });

  it("migrates legacy mirror signing keys for signed device commands", async () => {
    const output: string[] = [];
    const paths = await tempPaths();
    const keyMaterial = generateDeviceKeyMaterial();
    const config: PastaConfig = {
      endpoint: "http://127.0.0.1:0",
      accountId: "acct_legacy",
      routingId: "space_legacy",
      deviceId: "dev_legacy",
      deviceName: "legacy",
      verifyPublicKey: keyMaterial.signing.publicKey,
      wrapPublicKey: keyMaterial.wrapping.publicKey,
      keyVersion: 1
    };
    const fileStore = new FileSecretStore(authFileForHome(paths.home));
    const legacyStore: SecretStore = {
      get: async (name) => name === SecretName.signingPrivateKey ? keyMaterial.signing.privateKey : null,
      set: async () => undefined,
      delete: async () => undefined
    };
    const secrets = new ResilientSecretStore(fileStore, [legacyStore]);
    let sawSignature = false;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        sawSignature = Boolean(request.headers.get(SIGNATURE_HEADERS.signature));
        return Response.json({ devices: [{ deviceId: "dev_legacy", deviceName: "legacy", status: "active" }] });
      }
    });
    try {
      await writeConfig({ ...config, endpoint: `http://127.0.0.1:${server.port}` }, paths.configPath);
      expect(await runCli(["devices", "list"], { io: capture(output), paths, secrets })).toBe(0);
      expect(sawSignature).toBe(true);
      expect(output.join("")).toContain("dev_legacy");
      expect(await fileStore.get(SecretName.signingPrivateKey)).toBe(keyMaterial.signing.privateKey);
    } finally {
      server.stop(true);
      await fileStore.delete(SecretName.signingPrivateKey);
    }
  });

  it("creates CI join grants and joins a clean noninteractive profile", async () => {
    const trustedPaths = await tempPaths();
    const trustedSecrets = new MemorySecretStore();
    const groupKey = generateGroupKey();
    await trustedSecrets.set(SecretName.groupKey, groupKey);
    const trustedConfig = sampleConfig();
    await writeConfig(trustedConfig, trustedPaths.configPath);
    const createBodies: PairingGrantCreateRequest[] = [];
    const createClient = new MockApiClient(({ method, path, body, signed }) => {
      expect(method).toBe("POST");
      expect(path).toBe("/v1/pairing/grants");
      expect(signed).toBe(true);
      const createBody = body as PairingGrantCreateRequest;
      createBodies.push(createBody);
      return {
        grantId: createBody.grantId,
        tokenExpiresAt: createBody.tokenExpiresAt,
        deviceTtlMs: createBody.deviceTtlMs,
        maxUses: createBody.maxUses,
        createdAt: 1782475200000
      };
    });
    const output: string[] = [];
    expect(await runCli(["pair", "grant", "create", "--json"], {
      io: capture(output),
      paths: trustedPaths,
      secrets: trustedSecrets,
      clientFactory: () => createClient
    })).toBe(0);
    const defaultCreateBody = createBodies[0]!;
    expect(defaultCreateBody.deviceTtlMs).toBeNull();
    expect(defaultCreateBody.maxUses).toBe(1);
    expect(defaultCreateBody.label).toBeUndefined();
    expect(defaultCreateBody.tokenExpiresAt - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(JSON.stringify(defaultCreateBody)).not.toContain(groupKey);
    const grantOutput = JSON.parse(output.join("")) as { joinToken: string; grantId: string };
    const firstSealedGroupKey = defaultCreateBody.sealedGroupKey;
    const firstTokenExpiresAt = defaultCreateBody.tokenExpiresAt;
    const firstDeviceTtlMs = defaultCreateBody.deviceTtlMs;
    const firstMaxUses = defaultCreateBody.maxUses;
    const parsed = parseJoinGrantToken(grantOutput.joinToken);
    expect(grantOutput.joinToken.startsWith("pasta_join_v1.")).toBe(true);
    expect(parsed.grantId).toBe(grantOutput.grantId);
    expect(JSON.stringify(defaultCreateBody)).not.toContain(parsed.redeemSecret);
    expect(JSON.stringify(defaultCreateBody)).not.toContain(parsed.sealSecret);
    expect(await Bun.file(trustedPaths.configPath).text()).not.toContain(grantOutput.joinToken);

    output.length = 0;
    expect(await runCli(["pair", "grant", "create", "--token-ttl", "1h", "--device-ttl", "24h", "--uses", "2", "--label", "modal-smoke", "--json"], {
      io: capture(output),
      paths: trustedPaths,
      secrets: trustedSecrets,
      clientFactory: () => createClient
    })).toBe(0);
    const leasedCreateBody = createBodies[1]!;
    expect(leasedCreateBody.tokenExpiresAt - Date.now()).toBeGreaterThan(59 * 60 * 1000);
    expect(leasedCreateBody.deviceTtlMs).toBe(24 * 60 * 60 * 1000);
    expect(leasedCreateBody.maxUses).toBe(2);
    expect(leasedCreateBody.label).toBe("modal-smoke");

    const joinPaths = await tempPaths();
    const joinSecrets = new MemorySecretStore();
    const joinClient = new MockApiClient(({ method, path, body, signed }) => {
      expect(method).toBe("POST");
      expect(path).toBe("/v1/pairing/grants/redeem");
      expect(signed).toBe(false);
      expect((body as { grantId: string; redeemSecret: string }).grantId).toBe(parsed.grantId);
      expect((body as { grantId: string; redeemSecret: string }).redeemSecret).toBe(parsed.redeemSecret);
      expect(JSON.stringify(body)).not.toContain(parsed.sealSecret);
      return {
        accountId: trustedConfig.accountId,
        routingId: trustedConfig.routingId,
        deviceId: (body as { newDeviceId: string }).newDeviceId,
        sealedGroupKey: firstSealedGroupKey,
        keyVersion: trustedConfig.keyVersion,
        tokenExpiresAt: firstTokenExpiresAt,
        deviceTtlMs: firstDeviceTtlMs,
        deviceExpiresAt: null,
        maxUses: firstMaxUses,
        redeemedAt: 1782475200000
      };
    });
    output.length = 0;
    expect(await runCli(["pair", "join", "--token", grantOutput.joinToken, "--device-name", "ci"], {
      io: capture(output),
      paths: joinPaths,
      secrets: joinSecrets,
      clientFactory: () => joinClient
    })).toBe(0);
    const joined = await readConfig(joinPaths.configPath);
    expect(joined.accountId).toBe(trustedConfig.accountId);
    expect(joined.routingId).toBe(trustedConfig.routingId);
    expect(joined.deviceName).toBe("ci");
    expect(joined.pendingPairing).toBeUndefined();
    expect(joined.deviceExpiresAt).toBeUndefined();
    expect(await joinSecrets.get(SecretName.groupKey)).toBe(groupKey);
    expect(await joinSecrets.get(SecretName.signingPrivateKey)).toBeTruthy();
    expect(await Bun.file(joinPaths.configPath).text()).not.toContain(grantOutput.joinToken);
    expect(await Bun.file(joinPaths.configPath).text()).not.toContain(parsed.redeemSecret);
    expect(await Bun.file(joinPaths.configPath).text()).not.toContain(parsed.sealSecret);
    expect(output.join("")).not.toContain(grantOutput.joinToken);
  });

  it("lists active devices by default and includes revoked devices only when requested", async () => {
    const paths = await tempPaths();
    const secrets = new MemorySecretStore();
    await writeConfig(sampleConfig(), paths.configPath);
    const client = new MockApiClient(({ method, path }) => {
      expect(method).toBe("GET");
      if (path === "/v1/devices") {
        return { devices: [{ deviceId: "dev_active", deviceName: "active", status: "active" }] };
      }
      if (path === "/v1/devices?includeRevoked=true") {
        return {
          devices: [
            { deviceId: "dev_active", deviceName: "active", status: "active" },
            { deviceId: "dev_revoked", deviceName: "old", status: "revoked" }
          ]
        };
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
    const output: string[] = [];
    const deps = { io: capture(output), paths, secrets, clientFactory: () => client };

    expect(await runCli(["devices", "list"], deps)).toBe(0);
    expect(output.join("")).toContain("dev_active\tactive\tactive");
    expect(output.join("")).not.toContain("dev_revoked");

    output.length = 0;
    expect(await runCli(["devices", "list", "--include-revoked"], deps)).toBe(0);
    expect(output.join("")).toContain("dev_active\tactive\tactive");
    expect(output.join("")).toContain("dev_revoked\trevoked\told");
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
      if (method === "DELETE" && path.startsWith("/v1/clips/")) {
        const clipId = decodeURIComponent(path.split("/").at(-1)!);
        const index = clips.findIndex((clip) => clip.clipId === clipId);
        const deleted = index === -1 ? 0 : clips.splice(index, 1).length;
        for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) clips[clipIndex]!.seq = clipIndex + 1;
        return { deleted, deletedObjects: 0 };
      }
      if (method === "GET" && path.startsWith("/v1/clips/")) {
        const clipId = decodeURIComponent(path.split("/").at(-1)!);
        return { clip: clips.find((clip) => clip.clipId === clipId) };
      }
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
    expect(await runCli(["history"], deps)).toBe(0);
    expect(output.join("")).toContain('"alpha"');
    output.length = 0;
    expect(await runCli(["history", "--show"], deps)).toBe(0);
    expect(output.join("")).toContain("alpha");

    await writeConfig({ ...config, lastRemotePasteHash: await import("../../src/shared/protocol").then((m) => m.sha256Base64Url("alpha")) }, paths.configPath);
    clipboard.value = "alpha";
    output.length = 0;
    expect(await runCli(["daemon", "--once"], deps)).toBe(0);
    expect(JSON.parse(output.join("")).published).toBe(0);
    output.length = 0;
    const deletedClipId = clips[0]!.clipId;
    expect(await runCli(["history", "delete", "1"], deps)).toBe(0);
    expect(output.join("")).toContain("deleted 1");
    expect(client.calls.some((call) => call.method === "DELETE" && call.path === `/v1/clips/${deletedClipId}`)).toBe(true);
    expect(client.calls.some((call) => call.method === "DELETE" && call.path === "/v1/clips/1")).toBe(false);
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
    const storedFiles = new Map<string, { clip: StoredClip; ciphertext: string }>();
    const client = new MockApiClient(({ method, path, body }) => {
      if (method === "POST" && path === "/v1/clips") {
        const clip = { ...(body as StoredClip), seq: nextSeq++ };
        clips.push(clip);
        return { clip };
      }
      if (method === "POST" && path === "/v1/files") {
        const source = body as StoredClip;
        const clip = { ...source, seq: nextSeq++, ciphertext: "", storageKind: "r2" as const, r2Key: `spaces/test/clips/${source.clipId}/payload` };
        clips.push(clip);
        storedFiles.set(clip.clipId, { clip, ciphertext: source.ciphertext });
        return { clip };
      }
      if (path === "/v1/clips/latest") return { clip: clips.at(-1) ?? null };
      if (path.startsWith("/v1/clips/history")) return { clips: [...clips].reverse() };
      if (path.startsWith("/v1/clips/")) return { clip: clips.find((clip) => clip.clipId === decodeURIComponent(path.split("/").at(-1)!)) };
      if (method === "GET" && path.startsWith("/v1/files/")) return storedFiles.get(decodeURIComponent(path.split("/").at(-1)!));
      throw new Error(`unexpected ${method} ${path}`);
    });
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const heic = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99]);
    const largePng = new Uint8Array(LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES + 1).fill(5);
    largePng.set(png.slice(0, 8), 0);
    const pngPath = join(paths.home, "unlimit.png");
    const largePngPath = join(paths.home, "large.png");
    const fakePngPath = join(paths.home, "fake.png");
    const heicPath = join(paths.home, "IMG_3035.heic");
    const filePath = join(paths.home, "notes.bin");
    const dirPath = join(paths.home, "project-folder");
    const imageOut = join(paths.home, "image.png");
    const largeImageOut = join(paths.home, "large-image.png");
    const out = join(paths.home, "received.bin");
    const outSeq = join(paths.home, "received-seq.bin");
    const dirOut = join(paths.home, "received-project");
    const dirOutSeq = join(paths.home, "received-project-seq");
    const pasteDir = join(paths.home, "paste-dir");
    await Bun.write(pngPath, png);
    await Bun.write(largePngPath, largePng);
    await Bun.write(fakePngPath, new Uint8Array([1, 2, 3, 4]));
    await Bun.write(heicPath, heic);
    await Bun.write(filePath, new Uint8Array([9, 8, 7, 6]));
    await mkdir(join(dirPath, "nested"), { recursive: true });
    await mkdir(join(dirPath, "empty"));
    await Bun.write(join(dirPath, "root.txt"), "root file");
    await Bun.write(join(dirPath, "nested", "child.txt"), "nested file");
    await mkdir(pasteDir);
    const clipboard = new MemoryClipboardAdapter();
    const output: string[] = [];
    const deps = { io: capture(output), paths, secrets, clipboard, clientFactory: () => client };
    const previousCwd = process.cwd();
    process.chdir(pasteDir);

    try {
      expect(await runCli(["copy", pngPath], deps)).toBe(0);
      expect(clips.at(-1)?.payloadKind).toBe("file");
      expect(clips.at(-1)?.mime).toBe("image/png");
      expect(JSON.stringify(clips.at(-1))).not.toContain(paths.home);
      expect(clips.at(-1)?.metadata?.ciphertext).not.toContain("unlimit.png");
      expect(output.join("")).toContain("published image");
      output.length = 0;
      expect(await runCli(["paste"], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(join(pasteDir, "unlimit.png")).arrayBuffer())).toEqual(png);
      expect(clipboard.image).toBeNull();
      expect(await runCli(["paste", "--image"], deps)).toBe(0);
      expect(clipboard.image?.bytes).toEqual(png);
      clipboard.image = null;
      expect(await runCli(["paste", "--image", "--out", imageOut], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(imageOut).arrayBuffer())).toEqual(png);

      output.length = 0;
      expect(await runCli(["copy", "--path", pngPath], deps)).toBe(0);
      expect(clips.at(-1)?.payloadKind).toBe("file");
      expect(clips.at(-1)?.mime).toBe("image/png");
      expect(await runCli(["copy", "--image", fakePngPath], deps)).not.toBe(0);
      expect(output.join("")).toContain("requires PNG image bytes");
      output.length = 0;
      expect(await runCli(["copy", fakePngPath], deps)).toBe(0);
      expect(clips.at(-1)?.payloadKind).toBe("file");
      output.length = 0;
      expect(await runCli(["copy", largePngPath], deps)).toBe(0);
      expect(clips.at(-1)?.payloadKind).toBe("file");
      expect(clips.at(-1)?.mime).toBe("image/png");
      expect(clips.at(-1)?.storageKind).toBe("r2");
      expect(await runCli(["paste", "--image", "--out", largeImageOut], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(largeImageOut).arrayBuffer())).toEqual(largePng);
      clipboard.image = null;
      expect(await runCli(["copy", "--file", largePngPath], deps)).toBe(0);
      expect(clips.at(-1)?.payloadKind).toBe("file");
      expect(clips.at(-1)?.mime).toBe("image/png");
      expect(await runCli(["paste"], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(join(pasteDir, "large.png")).arrayBuffer())).toEqual(largePng);
      expect(clipboard.image).toBeNull();

      output.length = 0;
      expect(await runCli(["copy", heicPath], deps)).toBe(0);
      expect(clips.at(-1)?.payloadKind).toBe("file");
      expect(clips.at(-1)?.mime).toBe("image/heic");
      expect(JSON.stringify(clips.at(-1))).not.toContain(paths.home);
      expect(JSON.stringify(clips.at(-1))).not.toContain("IMG_3035.heic");
      expect(output.join("")).toContain("published image");
      output.length = 0;
      expect(await runCli(["history"], deps)).toBe(0);
      expect(output.join("")).toContain('file image/heic 12 bytes encrypted "IMG_3035.heic"');
      expect(output.join("")).not.toContain('"output.bin"');
      output.length = 0;
      expect(await runCli(["paste"], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(join(pasteDir, "IMG_3035.heic")).arrayBuffer())).toEqual(heic);

      output.length = 0;
      expect(await runCli(["copy", filePath], deps)).toBe(0);
      const fileSeq = clips.at(-1)?.seq;
      expect(clips.at(-1)?.payloadKind).toBe("file");
      output.length = 0;
      expect(await runCli(["history"], deps)).toBe(0);
      expect(output.join("")).toContain('"notes.bin"');
      output.length = 0;
      expect(await runCli(["paste"], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(join(pasteDir, "notes.bin")).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
      expect(await runCli(["paste", "--out", out], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(out).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
      expect(await runCli(["paste", "--file", "--seq", String(fileSeq), "--out", outSeq], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(outSeq).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
      expect(await runCli(["paste", "--file", "--seq", String(fileSeq)], deps)).toBe(0);
      expect(new Uint8Array(await Bun.file(join(pasteDir, "notes.bin")).arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));

      output.length = 0;
      expect(await runCli(["copy", dirPath], deps)).toBe(0);
      const dirClip = clips.at(-1)!;
      const dirSeq = dirClip.seq;
      expect(clips.at(-1)?.payloadKind).toBe("file");
      expect(clips.at(-1)?.mime).toBe(DIRECTORY_BUNDLE_MIME);
      expect(JSON.stringify(clips.at(-1))).not.toContain(paths.home);
      expect(JSON.stringify(clips.at(-1))).not.toContain("project-folder");
      expect(JSON.stringify(clips.at(-1))).not.toContain("child.txt");
      expect(output.join("")).toContain("published directory");
      const encryptedDirectory = storedFiles.get(dirClip.clipId)!;
      const zipBytes = decryptBytesClip(groupKey, config.accountId, config.routingId, { ...encryptedDirectory.clip, ciphertext: encryptedDirectory.ciphertext });
      expect(Array.from(zipBytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
      expect(await runCli(["paste"], deps)).toBe(0);
      expect(await Bun.file(join(pasteDir, "project-folder", "root.txt")).text()).toBe("root file");
      expect(await Bun.file(join(pasteDir, "project-folder", "nested", "child.txt")).text()).toBe("nested file");
      expect((await stat(join(pasteDir, "project-folder", "empty"))).isDirectory()).toBe(true);
      expect(await runCli(["paste", "--out", dirOut], deps)).toBe(0);
      expect(await Bun.file(join(dirOut, "nested", "child.txt")).text()).toBe("nested file");
      expect(await runCli(["paste", "--file", "--seq", String(dirSeq), "--out", dirOutSeq], deps)).toBe(0);
      expect(await Bun.file(join(dirOutSeq, "root.txt")).text()).toBe("root file");
    } finally {
      process.chdir(previousCwd);
    }
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
        const stored = { ...source, seq: storedFiles.length + 1, ciphertext: "", storageKind: "r2" as const, r2Key: `spaces/test/clips/${source.clipId}/payload` };
        storedFiles.push({ clip: stored, ciphertext: source.ciphertext });
        return { clip: stored };
      }
      if (path === "/v1/clips/latest") return { clip: storedFiles.at(-1)?.clip ?? null };
      if (path.startsWith("/v1/clips/history")) return { clips: storedFiles.map((entry) => entry.clip).reverse() };
      if (method === "GET" && path.startsWith("/v1/files/")) {
        const clipId = decodeURIComponent(path.split("/").at(-1)!);
        return storedFiles.find((entry) => entry.clip.clipId === clipId);
      }
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

  it("supports cross-platform non-overriding shell integration snippets", async () => {
    const paths = await tempPaths();
    const output: string[] = [];
    const snippets = new Map<ShellKind, string>([
      ["zsh", shellSnippet("pasta", "zsh")],
      ["bash", shellSnippet("pasta", "bash")],
      ["fish", shellSnippet("pasta", "fish")],
      ["powershell", shellSnippet("pasta", "powershell")]
    ]);
    expect(snippets.get("zsh")).toContain("bindkey");
    expect(snippets.get("zsh")).toContain("undefined-key");
    expect(snippets.get("zsh")).toContain("'^[[99;16u' '^Xc'");
    expect(snippets.get("zsh")).toContain("'^[[112;16u' '^Xp'");
    expect(snippets.get("zsh")).not.toContain("^P");
    expect(snippets.get("bash")).toContain("bind -p");
    expect(snippets.get("bash")).toContain("bind -X");
    expect(snippets.get("bash")).toContain("bind -x");
    expect(snippets.get("bash")).toContain("'\\e[99;16u' '\\C-xc'");
    expect(snippets.get("fish")).toContain("type -q pc");
    expect(snippets.get("fish")).toContain("bind --query");
    expect(snippets.get("fish")).toContain("\\e\\[99\\;16u \\cxc");
    expect(snippets.get("powershell")).toContain("Get-PSReadLineKeyHandler -Chord");
    expect(snippets.get("powershell")).toContain("Set-PSReadLineKeyHandler");
    expect(snippets.get("powershell")).toContain("'Ctrl+Alt+Shift+c', 'Ctrl+x,c'");
    for (const snippet of snippets.values()) {
      expect(snippet).toContain("pasta");
      expect(snippet).toContain("copy");
      expect(snippet).toContain("paste");
      expect(snippet).toContain("history");
    }

    const quoted = shellSnippet("/tmp/pasta dev/bin/pasta", "bash");
    expect(quoted).toContain("/tmp/pasta dev/bin/pasta");
    expect(quoted).not.toContain("_pasta_copy_cmd=/tmp/pasta dev/bin/pasta copy");
    expect(quoted).toContain("command -v pc");
    const trickyCommand = "/tmp/pasta dev/bin/pa'sta;touch";
    expect(shellSnippet(trickyCommand, "zsh")).toContain("'\\''sta;touch");
    expect(shellSnippet(trickyCommand, "bash")).toContain("'\\''sta;touch");
    expect(shellSnippet(trickyCommand, "fish")).toContain("pa\\'sta;touch");
    expect(shellSnippet(trickyCommand, "powershell")).toContain("pa''sta;touch");

    expect(detectShellKind({ SHELL: "/opt/homebrew/bin/fish" }, "darwin")).toBe("fish");
    expect(detectShellKind({ SHELL: "/bin/bash" }, "linux")).toBe("bash");
    expect(detectShellKind({}, "win32")).toBe("powershell");

    expect(await runCli(["install-shell", "--shell", "bash"], { io: capture(output), paths })).toBe(0);
    expect(await Bun.file(shellConfigPath(paths, "bash")).text()).toContain("Pasta terminal integration (bash)");
    output.length = 0;
    expect(await runCli(["install-shell", "--shell", "powershell", "--command", "/tmp/pasta dev/bin/pasta"], { io: capture(output), paths })).toBe(0);
    expect(await Bun.file(shellConfigPath(paths, "powershell")).text()).toContain("& '/tmp/pasta dev/bin/pasta' 'copy'");
    expect(output.join("")).toContain(". ");
    expect(output.join("")).not.toContain("source ");
    output.length = 0;
    expect(await runCli(["install-shell", "--shell", "bash", "--copy-key", "alt+c", "--paste-key", "none"], { io: capture(output), paths })).toBe(0);
    const customBash = await Bun.file(shellConfigPath(paths, "bash")).text();
    expect(customBash).toContain("'\\ec'");
    expect(customBash).not.toContain("\\e[99;16u");
    expect(customBash).toContain("Pasta paste keybindings disabled");
    output.length = 0;
    expect(await runCli(["install-shell", "--shell", "zsh", "--copy-key", "hyper+c", "--copy-key", "alt+c", "--paste-key", "none"], { io: capture(output), paths })).toBe(0);
    const repeatedZsh = await Bun.file(shellConfigPath(paths, "zsh")).text();
    expect(repeatedZsh).toContain("'^[[99;16u' '^[c:capitalize-word'");
    expect(repeatedZsh).toContain("Pasta paste keybindings disabled");
    output.length = 0;
    expect(await runCli(["install-shell", "--shell", "zsh", "--copy-key", "cmd+c"], { io: capture(output), paths })).toBe(2);
    expect(output.join("")).toContain("supported key specs");
    output.length = 0;
    const previousCopyKey = Bun.env.PASTA_COPY_KEY;
    const previousPasteKey = Bun.env.PASTA_PASTE_KEY;
    try {
      Bun.env.PASTA_COPY_KEY = "alt+c";
      Bun.env.PASTA_PASTE_KEY = "alt+p";
      expect(await runCli(["install-shell", "--shell", "zsh"], { io: capture(output), paths })).toBe(0);
      const envZsh = await Bun.file(shellConfigPath(paths, "zsh")).text();
      expect(envZsh).toContain("'^[c:capitalize-word'");
      expect(envZsh).toContain("'^[p:history-search-backward'");
      expect(envZsh).not.toContain("^[[99;16u");
    } finally {
      if (previousCopyKey === undefined) delete Bun.env.PASTA_COPY_KEY;
      else Bun.env.PASTA_COPY_KEY = previousCopyKey;
      if (previousPasteKey === undefined) delete Bun.env.PASTA_PASTE_KEY;
      else Bun.env.PASTA_PASTE_KEY = previousPasteKey;
    }
    output.length = 0;
    expect(await runCli(["install-shell", "--shell", "nope"], { io: capture(output), paths })).toBe(2);
    expect(output.join("")).toContain("--shell must be auto");

    output.length = 0;
    expect(await runCli(["uninstall-shell", "--shell", "bash"], { io: capture(output), paths })).toBe(0);
    expect(await Bun.file(shellConfigPath(paths, "bash")).text()).toBe("");
    output.length = 0;
    expect(await runCli(["install-shell", "--shell", "zsh"], { io: capture(output), paths })).toBe(0);
    expect(await runCli(["install-shell", "--shell", "fish"], { io: capture(output), paths })).toBe(0);
    expect(await runCli(["uninstall-shell"], { io: capture(output), paths })).toBe(0);
    expect(await Bun.file(shellConfigPath(paths, "zsh")).text()).toBe("");
    expect(await Bun.file(shellConfigPath(paths, "fish")).text()).toBe("");
  });

  it("uses zsh hyper chords and fallback keybindings when zsh is available", async () => {
    if (!(await commandExists("zsh"))) return;
    const paths = await tempPaths();
    const snippetPath = join(paths.home, "pasta.zsh");
    await Bun.write(snippetPath, shellSnippet("pasta", "zsh"));
    const script = [
      `source ${posixPath(snippetPath)}`,
      "bindkey '^[[99;16u'",
      "bindkey '^Xc'",
      "bindkey '^[[112;16u'",
      "bindkey '^Xp'"
    ].join("; ");
    const proc = Bun.spawn(["zsh", "-f", "-c", script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("pasta copy");
    expect(stdout).toContain("pasta paste --clipboard");
  });

  it("uses explicit zsh option chords over default widgets when zsh is available", async () => {
    if (!(await commandExists("zsh"))) return;
    const paths = await tempPaths();
    const snippetPath = join(paths.home, "pasta.zsh");
    await Bun.write(snippetPath, shellSnippet("pasta", "zsh", { copyKeys: ["alt+c"], pasteKeys: ["alt+p"] }));
    const script = [
      `source ${posixPath(snippetPath)}`,
      "bindkey '^[c'",
      "bindkey '^[p'"
    ].join("; ");
    const proc = Bun.spawn(["zsh", "-f", "-c", script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("pasta copy");
    expect(stdout).toContain("pasta paste --clipboard");
    expect(stdout).not.toContain("capitalize-word");
    expect(stdout).not.toContain("history-search-backward");
  });

  it("preserves custom zsh option chords and uses fallback keybindings when zsh is available", async () => {
    if (!(await commandExists("zsh"))) return;
    const paths = await tempPaths();
    const snippetPath = join(paths.home, "pasta.zsh");
    await Bun.write(snippetPath, shellSnippet("pasta", "zsh", { copyKeys: ["alt+c", "ctrl+x,c"], pasteKeys: ["alt+p", "ctrl+x,p"] }));
    const script = [
      "bindkey -s '^[c' 'existing-copy'",
      "bindkey -s '^[p' 'existing-paste'",
      `source ${posixPath(snippetPath)}`,
      "bindkey '^[c'",
      "bindkey '^Xc'",
      "bindkey '^[p'",
      "bindkey '^Xp'"
    ].join("; ");
    const proc = Bun.spawn(["zsh", "-f", "-c", script], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("existing-copy");
    expect(stdout).toContain("pasta copy");
    expect(stdout).toContain("existing-paste");
    expect(stdout).toContain("pasta paste --clipboard");
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
    expect(plan.r2KeyFormat).toBe("spaces/{routing_id}/clips/{clip_id}/{payload_id}");
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

async function commandExists(command: string): Promise<boolean> {
  return (await Bun.spawn(["/bin/sh", "-c", `command -v ${command} >/dev/null 2>&1`]).exited) === 0;
}

function posixPath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}
