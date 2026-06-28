import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Paths } from "./config";

export const SHELL_KINDS = ["zsh", "bash", "fish", "powershell"] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];
export type InstallShellKind = ShellKind | "auto";
export type UninstallShellKind = InstallShellKind | "all";

export function isInstallShellKind(value: string): value is InstallShellKind {
  return value === "auto" || isShellKind(value);
}

export function isUninstallShellKind(value: string): value is UninstallShellKind {
  return value === "all" || isInstallShellKind(value);
}

export function isShellKind(value: string): value is ShellKind {
  return (SHELL_KINDS as readonly string[]).includes(value);
}

export function detectShellKind(
  env: Record<string, string | undefined> = Bun.env,
  platform: NodeJS.Platform = process.platform
): ShellKind {
  const shellName = basename(env.SHELL ?? "").toLowerCase();
  if (shellName.includes("zsh")) return "zsh";
  if (shellName.includes("fish")) return "fish";
  if (shellName.includes("bash")) return "bash";
  if (platform === "win32") return "powershell";
  if (platform === "darwin") return "zsh";
  return "bash";
}

export function resolveShellKind(
  shell: InstallShellKind = "auto",
  env: Record<string, string | undefined> = Bun.env,
  platform: NodeJS.Platform = process.platform
): ShellKind {
  return shell === "auto" ? detectShellKind(env, platform) : shell;
}

export function shellConfigPath(paths: Paths, shell: ShellKind): string {
  switch (shell) {
    case "zsh":
      return paths.shellConfigPath;
    case "bash":
      return join(paths.home, "shell.bash");
    case "fish":
      return join(paths.home, "shell.fish");
    case "powershell":
      return join(paths.home, "shell.ps1");
  }
}

export function shellSnippet(command = "pasta", shell: ShellKind = "zsh"): string {
  switch (shell) {
    case "zsh":
      return zshSnippet(command);
    case "bash":
      return bashSnippet(command);
    case "fish":
      return fishSnippet(command);
    case "powershell":
      return powershellSnippet(command);
  }
}

export async function installShell(
  paths: Paths,
  command = "pasta",
  shell: InstallShellKind = "auto",
  env: Record<string, string | undefined> = Bun.env,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  const resolved = resolveShellKind(shell, env, platform);
  const target = shellConfigPath(paths, resolved);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, `${shellSnippet(command, resolved)}\n`);
  return target;
}

export async function uninstallShell(
  paths: Paths,
  shell: UninstallShellKind = "all",
  env: Record<string, string | undefined> = Bun.env,
  platform: NodeJS.Platform = process.platform
): Promise<string[]> {
  const shells = shell === "all" ? SHELL_KINDS : [resolveShellKind(shell, env, platform)];
  const cleared: string[] = [];
  for (const shellKind of shells) {
    const target = shellConfigPath(paths, shellKind);
    if (await Bun.file(target).exists()) {
      await Bun.write(target, "");
      cleared.push(target);
    }
  }
  if (cleared.length === 0 && shell !== "all") cleared.push(shellConfigPath(paths, resolveShellKind(shell, env, platform)));
  return cleared;
}

function zshSnippet(command: string): string {
  const copy = posixCommand(command, ["copy"]);
  const paste = posixCommand(command, ["paste", "--clipboard"]);
  const history = posixCommand(command, ["history"]);
  return [
    "# Pasta terminal integration (zsh)",
    safeAlias("pc", copy),
    safeAlias("pp", paste),
    safeAlias("ph", history),
    `_pasta_copy_cmd=${posixQuote(copy)}`,
    `_pasta_paste_cmd=${posixQuote(paste)}`,
    "_pasta_bind_if_available() {",
    "  local key=\"$1\" action=\"$2\" default_widget=\"${3:-}\" current",
    "  current=\"$(bindkey \"$key\" 2>/dev/null || true)\"",
    "  case \"$current\" in",
    "    *undefined-key*|\"\") bindkey -s \"$key\" \"$action\" 2>/dev/null ;;",
    "    *)",
    "      if [ -n \"$default_widget\" ] && [[ \"$current\" == *\" $default_widget\" ]]; then",
    "        bindkey -s \"$key\" \"$action\" 2>/dev/null",
    "      else",
    "        return 1",
    "      fi",
    "      ;;",
    "  esac",
    "}",
    "_pasta_bind_first() {",
    "  local action=\"$1\"",
    "  shift",
    "  local spec key default_widget",
    "  for spec in \"$@\"; do",
    "    key=\"${spec%%:*}\"",
    "    default_widget=\"${spec#*:}\"",
    "    [ \"$default_widget\" = \"$spec\" ] && default_widget=\"\"",
    "    _pasta_bind_if_available \"$key\" \"$action\" \"$default_widget\" && return 0",
    "  done",
    "  return 0",
    "}",
    "if [ -n \"${ZSH_VERSION:-}\" ]; then",
    "  _pasta_bind_first \"$_pasta_copy_cmd\"$'\\n' '^[c:capitalize-word' '^Xc'",
    "  _pasta_bind_first \"$_pasta_paste_cmd\"$'\\n' '^[p:history-search-backward' '^Xp'",
    "fi",
    "unset _pasta_copy_cmd _pasta_paste_cmd",
    "unset -f _pasta_bind_if_available _pasta_bind_first 2>/dev/null || true"
  ].join("\n");
}

function bashSnippet(command: string): string {
  const copy = posixCommand(command, ["copy"]);
  const paste = posixCommand(command, ["paste", "--clipboard"]);
  const history = posixCommand(command, ["history"]);
  return [
    "# Pasta terminal integration (bash)",
    safeAlias("pc", copy),
    safeAlias("pp", paste),
    safeAlias("ph", history),
    `_pasta_copy_cmd=${posixQuote(copy)}`,
    `_pasta_paste_cmd=${posixQuote(paste)}`,
    "_pasta_can_inspect_shell_bindings() {",
    "  bind -X >/dev/null 2>&1",
    "}",
    "_pasta_readline_key_bound() {",
    "  { bind -p 2>/dev/null; bind -X 2>/dev/null; } | grep -F \"\\\"$1\\\":\" >/dev/null",
    "}",
    "_pasta_bind_if_unbound() {",
    "  local key=\"$1\" action=\"$2\"",
    "  if ! _pasta_readline_key_bound \"$key\"; then",
    "    bind -x \"\\\"$key\\\":\\\"$action\\\"\" 2>/dev/null",
    "  else",
    "    return 1",
    "  fi",
    "}",
    "_pasta_bind_first() {",
    "  local action=\"$1\"",
    "  shift",
    "  local key",
    "  for key in \"$@\"; do",
    "    _pasta_bind_if_unbound \"$key\" \"$action\" && return 0",
    "  done",
    "  return 0",
    "}",
    "if [ -n \"${BASH_VERSION:-}\" ] && _pasta_can_inspect_shell_bindings; then",
    "  _pasta_bind_first \"$_pasta_copy_cmd\" '\\ec' '\\C-xc'",
    "  _pasta_bind_first \"$_pasta_paste_cmd\" '\\ep' '\\C-xp'",
    "fi",
    "unset _pasta_copy_cmd _pasta_paste_cmd",
    "unset -f _pasta_can_inspect_shell_bindings _pasta_readline_key_bound _pasta_bind_if_unbound _pasta_bind_first 2>/dev/null || true"
  ].join("\n");
}

function fishSnippet(command: string): string {
  const copy = fishCommand(command, ["copy"]);
  const paste = fishCommand(command, ["paste", "--clipboard"]);
  const history = fishCommand(command, ["history"]);
  return [
    "# Pasta terminal integration (fish)",
    "if not type -q pc",
    `  function pc --wraps ${fishQuote(copy)}`,
    `    ${copy} $argv`,
    "  end",
    "end",
    "if not type -q pp",
    `  function pp --wraps ${fishQuote(paste)}`,
    `    ${paste} $argv`,
    "  end",
    "end",
    "if not type -q ph",
    `  function ph --wraps ${fishQuote(history)}`,
    `    ${history} $argv`,
    "  end",
    "end",
    "function __pasta_bind_if_unbound",
    "  set -l seq $argv[1]",
    "  set -l action $argv[2]",
    "  bind --query $seq >/dev/null 2>/dev/null",
    "  if test $status -ne 0",
    "    bind $seq $action",
    "    return 0",
    "  end",
    "  return 1",
    "end",
    "function __pasta_bind_first",
    "  set -l action $argv[1]",
    "  for seq in $argv[2..-1]",
    "    __pasta_bind_if_unbound $seq $action; and return 0",
    "  end",
    "end",
    `__pasta_bind_first ${fishQuote(`${copy}; commandline -f repaint`)} \\ec \\cxc`,
    `__pasta_bind_first ${fishQuote(`${paste}; commandline -f repaint`)} \\ep \\cxp`,
    "functions -e __pasta_bind_if_unbound __pasta_bind_first"
  ].join("\n");
}

function powershellSnippet(command: string): string {
  const copy = powershellCommand(command, ["copy"]);
  const paste = powershellCommand(command, ["paste", "--clipboard"]);
  const history = powershellCommand(command, ["history"]);
  return [
    "# Pasta terminal integration (PowerShell)",
    "if (-not (Get-Command pc -ErrorAction SilentlyContinue)) {",
    `  function global:pc { ${copy} @args }`,
    "}",
    "if (-not (Get-Command pp -ErrorAction SilentlyContinue)) {",
    `  function global:pp { ${paste} @args }`,
    "}",
    "if (-not (Get-Command ph -ErrorAction SilentlyContinue)) {",
    `  function global:ph { ${history} @args }`,
    "}",
    "function Set-PastaKeyHandlerIfFree {",
    "  param([string[]] $Chords, [scriptblock] $ScriptBlock, [string] $Description)",
    "  foreach ($Chord in $Chords) {",
    "    $Existing = Get-PSReadLineKeyHandler -Chord $Chord -ErrorAction SilentlyContinue",
    "    if (-not $Existing) {",
    "      try {",
    "        Set-PSReadLineKeyHandler -Chord $Chord -ScriptBlock $ScriptBlock -Description $Description -ErrorAction Stop",
    "        return",
    "      } catch {",
    "      }",
    "    }",
    "  }",
    "}",
    "if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) {",
    `  Set-PastaKeyHandlerIfFree -Chords @("Alt+c", "Ctrl+x,c") -ScriptBlock { ${copy} } -Description "Pasta copy"`,
    `  Set-PastaKeyHandlerIfFree -Chords @("Alt+p", "Ctrl+x,p") -ScriptBlock { ${paste} } -Description "Pasta paste"`,
    "}",
    "Remove-Item function:Set-PastaKeyHandlerIfFree -ErrorAction SilentlyContinue"
  ].join("\n");
}

function safeAlias(name: string, commandLine: string): string {
  return `if ! command -v ${name} >/dev/null 2>&1; then alias ${name}=${posixQuote(commandLine)}; fi`;
}

function posixCommand(command: string, args: string[]): string {
  return [command, ...args].map(posixQuote).join(" ");
}

function fishCommand(command: string, args: string[]): string {
  return [command, ...args].map(fishQuote).join(" ");
}

function powershellCommand(command: string, args: string[]): string {
  return ["&", command, ...args].map((part, index) => index === 0 ? part : powershellQuote(part)).join(" ");
}

function posixQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function fishQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
