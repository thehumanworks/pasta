import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Paths } from "./config";

export function shellSnippet(command = "pasta"): string {
  return [
    "# Pasta terminal integration",
    `alias pc="${command} copy"`,
    `alias pp="${command} paste --clipboard"`,
    `alias ph="${command} history"`,
    "pasta_bindings() {",
    "  bindkey -s '^P' 'pasta paste --clipboard\\n'",
    "}",
    "zle -N pasta_bindings 2>/dev/null || true"
  ].join("\n");
}

export async function installShell(paths: Paths, command = "pasta"): Promise<string> {
  await mkdir(dirname(paths.shellConfigPath), { recursive: true });
  const snippet = `${shellSnippet(command)}\n`;
  await Bun.write(paths.shellConfigPath, snippet);
  return paths.shellConfigPath;
}

export async function uninstallShell(paths: Paths): Promise<string> {
  await Bun.write(paths.shellConfigPath, "");
  return paths.shellConfigPath;
}

