#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PASTA_VERSION } from "../src/shared/protocol";

type ReleaseTarget = {
  readonly bunTarget: string;
  readonly assetPlatform: string;
  readonly assetArch: string;
  readonly assetLibc?: string;
  readonly executableName: "pasta" | "pasta.exe";
  readonly archiveType: "tar.gz" | "zip";
};

const targets: ReleaseTarget[] = [
  {
    bunTarget: "bun-darwin-arm64",
    assetPlatform: "macos",
    assetArch: "arm64",
    executableName: "pasta",
    archiveType: "tar.gz"
  },
  {
    bunTarget: "bun-darwin-x64",
    assetPlatform: "macos",
    assetArch: "x64",
    executableName: "pasta",
    archiveType: "tar.gz"
  },
  {
    bunTarget: "bun-linux-x64-baseline",
    assetPlatform: "linux",
    assetArch: "x64",
    assetLibc: "gnu",
    executableName: "pasta",
    archiveType: "tar.gz"
  },
  {
    bunTarget: "bun-linux-arm64",
    assetPlatform: "linux",
    assetArch: "arm64",
    assetLibc: "gnu",
    executableName: "pasta",
    archiveType: "tar.gz"
  },
  {
    bunTarget: "bun-linux-x64-musl-baseline",
    assetPlatform: "linux",
    assetArch: "x64",
    assetLibc: "musl",
    executableName: "pasta",
    archiveType: "tar.gz"
  },
  {
    bunTarget: "bun-linux-arm64-musl",
    assetPlatform: "linux",
    assetArch: "arm64",
    assetLibc: "musl",
    executableName: "pasta",
    archiveType: "tar.gz"
  },
  {
    bunTarget: "bun-windows-x64-baseline",
    assetPlatform: "windows",
    assetArch: "x64",
    executableName: "pasta.exe",
    archiveType: "zip"
  },
  {
    bunTarget: "bun-windows-arm64",
    assetPlatform: "windows",
    assetArch: "arm64",
    executableName: "pasta.exe",
    archiveType: "zip"
  }
];

const root = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(root, "dist", "release");
const packageJson = await Bun.file(join(root, "package.json")).json() as { version?: string };
const packageVersion = requireString(packageJson.version, "package.json version");
const releaseVersion = versionFromEnv(process.env.PASTA_RELEASE_VERSION ?? process.env.GITHUB_REF_NAME) ?? packageVersion;

if (releaseVersion !== packageVersion || releaseVersion !== PASTA_VERSION) {
  throw new Error(
    `release version mismatch: release=${releaseVersion}, package=${packageVersion}, cli=${PASTA_VERSION}`
  );
}

await rm(distDir, { force: true, recursive: true });
await mkdir(distDir, { recursive: true });

const checksums: Array<{ file: string; sha256: string }> = [];

for (const target of targets) {
  const stagingDir = join(distDir, `staging-${target.assetPlatform}-${target.assetArch}${target.assetLibc ? `-${target.assetLibc}` : ""}`);
  await mkdir(stagingDir, { recursive: true });
  const executablePath = join(stagingDir, target.executableName);

  await run([
    "bun",
    "build",
    "--compile",
    `--target=${target.bunTarget}`,
    join(root, "src", "cli.ts"),
    "--outfile",
    executablePath
  ]);

  if (target.executableName === "pasta") {
    await chmod(executablePath, 0o755);
  }

  const archiveName = archiveFileName(releaseVersion, target);
  const archivePath = join(distDir, archiveName);
  if (target.archiveType === "tar.gz") {
    await run(["tar", "-czf", archivePath, "-C", stagingDir, target.executableName]);
  } else {
    await run(["zip", "-j", "-q", archivePath, executablePath]);
  }

  checksums.push({ file: archiveName, sha256: await sha256File(archivePath) });
  await rm(stagingDir, { force: true, recursive: true });
}

checksums.sort((left, right) => left.file.localeCompare(right.file));
await writeFile(
  join(distDir, "checksums.txt"),
  checksums.map((entry) => `${entry.sha256}  ${entry.file}`).join("\n") + "\n"
);
await writeFile(
  join(distDir, "RELEASE_NOTES.md"),
  [
    `Pasta ${releaseVersion}`,
    "",
    "Standalone CLI binaries for mise's GitHub backend.",
    "",
    "Install with:",
    "",
    "```bash",
    "mise use -g github:thehumanworks/pasta",
    "```",
    "",
    "Assets are built with Bun standalone executables for macOS, Linux, and Windows."
  ].join("\n") + "\n"
);

const files = await readdir(distDir);
console.log(files.filter((file) => !file.startsWith("staging-")).sort().join("\n"));

function archiveFileName(version: string, target: ReleaseTarget): string {
  const libc = target.assetLibc ? `-${target.assetLibc}` : "";
  return `pasta-v${version}-${target.assetPlatform}-${target.assetArch}${libc}.${target.archiveType}`;
}

function versionFromEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.startsWith("v") ? value.slice(1) : value;
}

function requireString(value: string | undefined, label: string): string {
  if (!value) throw new Error(`missing ${label}`);
  return value;
}

async function sha256File(path: string): Promise<string> {
  const bytes = await Bun.file(path).arrayBuffer();
  return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
}

async function run(args: string[]): Promise<void> {
  const proc = Bun.spawn(args, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit"
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`command failed (${code}): ${args.map((arg) => (arg === "" ? "''" : arg)).join(" ")}`);
  }
}
