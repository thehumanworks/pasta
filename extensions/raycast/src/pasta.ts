import { getPreferenceValues } from "@raycast/api";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface PastaPreferences {
  pastaCliPath?: string;
}

export const PASTA_NOT_FOUND_ERROR =
  "Could not find the pasta CLI. Install pasta or set the Pasta CLI Path in extension preferences.";

function pathEntries(): string[] {
  const separator = process.platform === "win32" ? ";" : ":";
  return (process.env.PATH ?? "").split(separator).filter(Boolean);
}

function executableNames(): string[] {
  return process.platform === "win32" ? ["pasta.exe", "pasta"] : ["pasta"];
}

function findOnPath(): string | undefined {
  for (const dir of pathEntries()) {
    for (const name of executableNames()) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function wellKnownPaths(): string[] {
  const home = homedir();
  if (process.platform === "win32") {
    return [join(home, ".bun", "bin", "pasta.exe")];
  }
  return [join(home, ".bun", "bin", "pasta"), "/opt/homebrew/bin/pasta", "/usr/local/bin/pasta"];
}

export function resolvePastaPath(): string {
  const { pastaCliPath } = getPreferenceValues<PastaPreferences>();

  const configured = pastaCliPath?.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`Pasta CLI not found at "${configured}". Check the Pasta CLI Path in extension preferences.`);
    }
    return configured;
  }

  const onPath = findOnPath();
  if (onPath) {
    return onPath;
  }

  for (const candidate of wellKnownPaths()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(PASTA_NOT_FOUND_ERROR);
}

function spawnEnv(): NodeJS.ProcessEnv {
  const separator = process.platform === "win32" ? ";" : ":";
  const home = homedir();
  const extraDirs =
    process.platform === "win32"
      ? [join(home, ".bun", "bin")]
      : [join(home, ".bun", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  const existingPath = process.env.PATH ?? "";
  const PATH = existingPath ? `${extraDirs.join(separator)}${separator}${existingPath}` : extraDirs.join(separator);
  return { ...process.env, PATH };
}

export function runPasta(args: string[], options: { input?: string } = {}): Promise<string> {
  const pastaPath = resolvePastaPath();
  const hasInput = options.input !== undefined;

  return new Promise((resolve, reject) => {
    const child = spawn(pastaPath, args, {
      stdio: [hasInput ? "pipe" : "ignore", "pipe", "pipe"],
      env: spawnEnv(),
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new Error(PASTA_NOT_FOUND_ERROR) : error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr.trim() || `pasta ${args.join(" ")} exited with code ${code}`));
      }
    });

    if (hasInput) {
      child.stdin?.write(options.input!);
      child.stdin?.end();
    }
  });
}
