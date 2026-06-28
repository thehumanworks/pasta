import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { Paths } from "../../src/cli/config";
import {
  GlobalHotkeyInstallError,
  GlobalHotkeyUsageError,
  MACOS_HOTKEY_LABEL,
  installGlobalHotkeys,
  macosHotkeyPaths,
  macosHotkeySource,
  normalizeGlobalHotkeys,
  uninstallGlobalHotkeys,
  type HotkeyCommandRunner
} from "../../src/cli/global-hotkeys";

describe("global macOS hotkeys", () => {
  it("normalizes safe macOS hotkey specs and generated helper commands", () => {
    const defaults = normalizeGlobalHotkeys();
    expect(defaults.map((hotkey) => hotkey.spec)).toEqual(["hyper+c", "hyper+p"]);
    expect(defaults.map((hotkey) => hotkey.keyCode)).toEqual([8, 35]);

    const custom = normalizeGlobalHotkeys({
      command: "mise exec -- bun run src/cli.ts",
      copyKey: "cmd+shift+b",
      pasteKey: "alt+p"
    });
    expect(custom.map((hotkey) => hotkey.spec)).toEqual(["shift+cmd+b", "opt+p"]);

    const source = macosHotkeySource(custom);
    expect(source).toContain("RegisterEventHotKey");
    expect(source).toContain("kEventHotKeyExclusive");
    expect(source).toContain("Carbon status");
    expect(source).toContain("process.standardError = FileHandle.standardError");
    expect(source).toContain("exited with status");
    expect(source).toContain("mise exec -- bun run src/cli.ts 'copy' '--clipboard'");
    expect(source).toContain("mise exec -- bun run src/cli.ts 'paste' '--clipboard'");
    expect(source).toContain("UInt32(shiftKey | cmdKey)");
    expect(source).toContain("UInt32(optionKey)");
  });

  it("rejects reserved, duplicate, and disabled global hotkey specs", () => {
    expect(() => normalizeGlobalHotkeys({ copyKey: "cmd+c" })).toThrow(GlobalHotkeyUsageError);
    expect(() => normalizeGlobalHotkeys({ copyKey: "ctrl+c" })).toThrow(GlobalHotkeyUsageError);
    expect(() => normalizeGlobalHotkeys({ copyKey: "cmd+v" })).toThrow(GlobalHotkeyUsageError);
    expect(() => normalizeGlobalHotkeys({ copyKey: "hyper+x", pasteKey: "ctrl+opt+shift+cmd+x" })).toThrow(GlobalHotkeyUsageError);
    expect(() => normalizeGlobalHotkeys({ copyKey: "none", pasteKey: "none" })).toThrow(GlobalHotkeyUsageError);
    expect(() => normalizeGlobalHotkeys({ copyKey: "space" })).toThrow("supported macOS key specs");
  });

  it("writes generated helper files and loads the user LaunchAgent after conflict check", async () => {
    const paths = await tempPaths();
    const userHome = await mkdtemp(join(tmpdir(), "pasta-user-"));
    const commands: string[][] = [];
    const runner: HotkeyCommandRunner = async (command) => {
      commands.push([...command]);
      return { code: 0, stdout: "", stderr: "" };
    };

    const installed = await installGlobalHotkeys(paths, {
      command: "mise exec -- bun run src/cli.ts",
      copyKey: "hyper+c",
      pasteKey: "hyper+p",
      env: { HOME: userHome },
      platform: "darwin",
      runner,
      uid: "501"
    });

    const generated = macosHotkeyPaths(paths, { HOME: userHome });
    expect(installed.paths).toEqual(generated);
    expect(await Bun.file(generated.sourcePath).text()).toContain("mise exec -- bun run src/cli.ts 'copy' '--clipboard'");
    expect(await Bun.file(generated.launchAgentPath).text()).toContain(MACOS_HOTKEY_LABEL);
    expect(await Bun.file(generated.launchAgentPath).text()).toContain("<key>PASTA_HOME</key>");
    expect(await Bun.file(generated.launchAgentPath).text()).toContain(paths.home);
    expect(await Bun.file(generated.launchAgentPath).text()).toContain(generated.binaryPath);
    expect(commands).toEqual([
      ["/usr/bin/swiftc", generated.sourcePath, "-o", generated.binaryPath, "-framework", "Carbon"],
      ["/bin/launchctl", "bootout", `gui/501/${MACOS_HOTKEY_LABEL}`],
      [generated.binaryPath, "--check-conflicts"],
      ["/bin/launchctl", "bootstrap", "gui/501", generated.launchAgentPath],
      ["/bin/launchctl", "kickstart", "-k", `gui/501/${MACOS_HOTKEY_LABEL}`]
    ]);
  });

  it("resolves the default hotkey command to an absolute pasta executable when available", async () => {
    const paths = await tempPaths();
    const userHome = await mkdtemp(join(tmpdir(), "pasta-user-"));
    const runner: HotkeyCommandRunner = async () => ({ code: 0, stdout: "", stderr: "" });

    await installGlobalHotkeys(paths, {
      env: { HOME: userHome },
      platform: "darwin",
      runner,
      commandResolver: () => "/Users/example/.bun/bin/pasta",
      uid: "501"
    });

    const generated = macosHotkeyPaths(paths, { HOME: userHome });
    const source = await Bun.file(generated.sourcePath).text();
    expect(source).toContain("'/Users/example/.bun/bin/pasta' 'copy' '--clipboard'");
    expect(source).toContain("'/Users/example/.bun/bin/pasta' 'paste' '--clipboard'");
  });

  it("wraps Bun shebang installs with an absolute bun executable", async () => {
    const paths = await tempPaths();
    const userHome = await mkdtemp(join(tmpdir(), "pasta-user-"));
    const binDir = await mkdtemp(join(tmpdir(), "pasta-bin-"));
    const pastaPath = join(binDir, "pasta");
    const bunPath = join(binDir, "bun");
    await Bun.write(pastaPath, "#!/usr/bin/env bun\nconsole.log('pasta');\n");
    await Bun.write(bunPath, "bun");
    const runner: HotkeyCommandRunner = async () => ({ code: 0, stdout: "", stderr: "" });

    await installGlobalHotkeys(paths, {
      env: { HOME: userHome },
      platform: "darwin",
      runner,
      commandResolver: (command) => command === "pasta" ? pastaPath : bunPath,
      uid: "501"
    });

    const source = await Bun.file(macosHotkeyPaths(paths, { HOME: userHome }).sourcePath).text();
    expect(source).toContain(`'${bunPath}' '${pastaPath}' 'copy' '--clipboard'`);
    expect(source).toContain(`'${bunPath}' '${pastaPath}' 'paste' '--clipboard'`);
  });

  it("fails install when the Carbon conflict check fails", async () => {
    const paths = await tempPaths();
    const userHome = await mkdtemp(join(tmpdir(), "pasta-user-"));
    const runner: HotkeyCommandRunner = async (command) => {
      if (command.at(-1) === "--check-conflicts") {
        return { code: 2, stdout: "", stderr: "Pasta hotkey conflict for copy hyper+c" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    await expect(installGlobalHotkeys(paths, {
      env: { HOME: userHome },
      platform: "darwin",
      runner,
      uid: "501"
    })).rejects.toThrow(GlobalHotkeyInstallError);
    expect(await Bun.file(macosHotkeyPaths(paths, { HOME: userHome }).launchAgentPath).exists()).toBe(false);
  });

  it("unloads LaunchAgent and removes generated hotkey files", async () => {
    const paths = await tempPaths();
    const userHome = await mkdtemp(join(tmpdir(), "pasta-user-"));
    const generated = macosHotkeyPaths(paths, { HOME: userHome });
    await mkdir(generated.directory, { recursive: true });
    await mkdir(join(userHome, "Library", "LaunchAgents"), { recursive: true });
    for (const file of [generated.sourcePath, generated.binaryPath, generated.stdoutLogPath, generated.stderrLogPath, generated.launchAgentPath]) {
      await Bun.write(file, "generated");
    }
    const commands: string[][] = [];
    const runner: HotkeyCommandRunner = async (command) => {
      commands.push([...command]);
      return { code: 0, stdout: "", stderr: "" };
    };

    await uninstallGlobalHotkeys(paths, { env: { HOME: userHome }, platform: "darwin", runner, uid: "501" });

    expect(commands).toEqual([["/bin/launchctl", "bootout", `gui/501/${MACOS_HOTKEY_LABEL}`]]);
    expect(await Bun.file(generated.sourcePath).exists()).toBe(false);
    expect(await Bun.file(generated.binaryPath).exists()).toBe(false);
    expect(await Bun.file(generated.launchAgentPath).exists()).toBe(false);
  });
});

async function tempPaths(): Promise<Paths> {
  const home = await mkdtemp(join(tmpdir(), "pasta-hotkeys-"));
  return {
    home,
    configPath: join(home, "config.json"),
    shellConfigPath: join(home, "shell.zsh")
  };
}
