import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Paths } from "./config";

export const SHELL_KINDS = ["zsh", "bash", "fish", "powershell"] as const;
export type ShellKind = (typeof SHELL_KINDS)[number];
export type InstallShellKind = ShellKind | "auto";
export type UninstallShellKind = InstallShellKind | "all";

export const DEFAULT_COPY_KEYS = ["hyper+c", "ctrl+x,c"] as const;
export const DEFAULT_PASTE_KEYS = ["hyper+p", "ctrl+x,p"] as const;

export interface ShellKeybindingOptions {
  copyKeys?: readonly string[];
  pasteKeys?: readonly string[];
}

interface ResolvedShellKeybindingOptions {
  copyKeys: string[];
  pasteKeys: string[];
}

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

export function shellSnippet(command = "pasta", shell: ShellKind = "zsh", options: ShellKeybindingOptions = {}): string {
  switch (shell) {
    case "zsh":
      return zshSnippet(command, options);
    case "bash":
      return bashSnippet(command, options);
    case "fish":
      return fishSnippet(command, options);
    case "powershell":
      return powershellSnippet(command, options);
  }
}

export async function installShell(
  paths: Paths,
  command = "pasta",
  shell: InstallShellKind = "auto",
  env: Record<string, string | undefined> = Bun.env,
  platform: NodeJS.Platform = process.platform,
  options: ShellKeybindingOptions = {}
): Promise<string> {
  const resolved = resolveShellKind(shell, env, platform);
  const target = shellConfigPath(paths, resolved);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, `${shellSnippet(command, resolved, options)}\n`);
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

export function normalizeShellKeybindingOptions(options: ShellKeybindingOptions = {}): ResolvedShellKeybindingOptions {
  return {
    copyKeys: normalizeShellKeySpecs(options.copyKeys, DEFAULT_COPY_KEYS, "--copy-key"),
    pasteKeys: normalizeShellKeySpecs(options.pasteKeys, DEFAULT_PASTE_KEYS, "--paste-key")
  };
}

export function shellKeySpecHelp(): string {
  return "supported key specs: hyper+<letter>, alt+<letter>, ctrl+x,<letter>, none";
}

function normalizeShellKeySpecs(values: readonly string[] | undefined, defaults: readonly string[], label: string): string[] {
  const raw = values && values.length > 0 ? values : defaults;
  const specs = raw.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (specs.length === 0) return [...defaults];
  if (specs.includes("none")) {
    if (specs.length > 1) throw new Error(`${label} cannot combine none with other key specs`);
    return [];
  }
  for (const spec of specs) {
    if (!isSupportedShellKeySpec(spec)) {
      throw new Error(`${label} has unsupported key spec ${JSON.stringify(spec)}; ${shellKeySpecHelp()}`);
    }
  }
  return [...new Set(specs)];
}

function isSupportedShellKeySpec(spec: string): boolean {
  return /^hyper\+[a-z]$/u.test(spec) || /^alt\+[a-z]$/u.test(spec) || /^ctrl\+x,[a-z]$/u.test(spec) || spec === "none";
}

function zshKeySpec(spec: string): string {
  const parsed = parseShellKeySpec(spec);
  switch (parsed.kind) {
    case "hyper":
      return `^[[${parsed.codePoint};16u`;
    case "alt": {
      const defaults: Record<string, string | undefined> = {
        c: "capitalize-word",
        p: "history-search-backward"
      };
      const key = `^[${parsed.letter}`;
      const defaultWidget = defaults[parsed.letter];
      return defaultWidget ? `${key}:${defaultWidget}` : key;
    }
    case "ctrl-x":
      return `^X${parsed.letter}`;
  }
}

function bashKeySpec(spec: string): string {
  const parsed = parseShellKeySpec(spec);
  switch (parsed.kind) {
    case "hyper":
      return `\\e[${parsed.codePoint};16u`;
    case "alt":
      return `\\e${parsed.letter}`;
    case "ctrl-x":
      return `\\C-x${parsed.letter}`;
  }
}

function fishKeySpec(spec: string): string {
  const parsed = parseShellKeySpec(spec);
  switch (parsed.kind) {
    case "hyper":
      return `\\e\\[${parsed.codePoint}\\;16u`;
    case "alt":
      return `\\e${parsed.letter}`;
    case "ctrl-x":
      return `\\cx${parsed.letter}`;
  }
}

function powershellKeySpec(spec: string): string {
  const parsed = parseShellKeySpec(spec);
  switch (parsed.kind) {
    case "hyper":
      return `Ctrl+Alt+Shift+${parsed.letter}`;
    case "alt":
      return `Alt+${parsed.letter}`;
    case "ctrl-x":
      return `Ctrl+x,${parsed.letter}`;
  }
}

function parseShellKeySpec(spec: string): { kind: "hyper" | "alt" | "ctrl-x"; letter: string; codePoint: number } {
  const hyper = spec.match(/^hyper\+([a-z])$/u);
  if (hyper?.[1]) return { kind: "hyper", letter: hyper[1], codePoint: hyper[1].codePointAt(0)! };
  const alt = spec.match(/^alt\+([a-z])$/u);
  if (alt?.[1]) return { kind: "alt", letter: alt[1], codePoint: alt[1].codePointAt(0)! };
  const ctrlX = spec.match(/^ctrl\+x,([a-z])$/u);
  if (ctrlX?.[1]) return { kind: "ctrl-x", letter: ctrlX[1], codePoint: ctrlX[1].codePointAt(0)! };
  throw new Error(`unsupported key spec ${JSON.stringify(spec)}; ${shellKeySpecHelp()}`);
}

function zshBindLine(action: "copy" | "paste", keys: string[]): string {
  if (keys.length === 0) return `  : # Pasta ${action} keybindings disabled`;
  return `  _pasta_bind_available "$_pasta_${action}_cmd"$'\\n' ${keys.map((key) => posixQuote(zshKeySpec(key))).join(" ")}`;
}

function bashBindLine(action: "copy" | "paste", keys: string[]): string {
  if (keys.length === 0) return `  : # Pasta ${action} keybindings disabled`;
  return `  _pasta_bind_available "$_pasta_${action}_cmd" ${keys.map((key) => posixQuote(bashKeySpec(key))).join(" ")}`;
}

function fishBindLine(command: string, keys: string[]): string {
  if (keys.length === 0) return `# Pasta keybindings disabled for ${command}`;
  return `__pasta_bind_available ${fishQuote(`${command}; commandline -f repaint`)} ${keys.map(fishKeySpec).join(" ")}`;
}

function powershellArray(values: string[]): string {
  return `@(${values.map((value) => powershellQuote(value)).join(", ")})`;
}

function zshSnippet(command: string, options: ShellKeybindingOptions): string {
  const keybindings = normalizeShellKeybindingOptions(options);
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
    "_pasta_bind_available() {",
    "  local action=\"$1\"",
    "  shift",
    "  local spec key default_widget",
    "  for spec in \"$@\"; do",
    "    key=\"${spec%%:*}\"",
    "    default_widget=\"${spec#*:}\"",
    "    [ \"$default_widget\" = \"$spec\" ] && default_widget=\"\"",
    "    _pasta_bind_if_available \"$key\" \"$action\" \"$default_widget\" || true",
    "  done",
    "  return 0",
    "}",
    "if [ -n \"${ZSH_VERSION:-}\" ]; then",
    zshBindLine("copy", keybindings.copyKeys),
    zshBindLine("paste", keybindings.pasteKeys),
    "fi",
    "unset _pasta_copy_cmd _pasta_paste_cmd",
    "unset -f _pasta_bind_if_available _pasta_bind_available 2>/dev/null || true"
  ].join("\n");
}

function bashSnippet(command: string, options: ShellKeybindingOptions): string {
  const keybindings = normalizeShellKeybindingOptions(options);
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
    "_pasta_bind_available() {",
    "  local action=\"$1\"",
    "  shift",
    "  local key",
    "  for key in \"$@\"; do",
    "    _pasta_bind_if_unbound \"$key\" \"$action\" || true",
    "  done",
    "  return 0",
    "}",
    "if [ -n \"${BASH_VERSION:-}\" ] && _pasta_can_inspect_shell_bindings; then",
    bashBindLine("copy", keybindings.copyKeys),
    bashBindLine("paste", keybindings.pasteKeys),
    "fi",
    "unset _pasta_copy_cmd _pasta_paste_cmd",
    "unset -f _pasta_can_inspect_shell_bindings _pasta_readline_key_bound _pasta_bind_if_unbound _pasta_bind_available 2>/dev/null || true"
  ].join("\n");
}

function fishSnippet(command: string, options: ShellKeybindingOptions): string {
  const keybindings = normalizeShellKeybindingOptions(options);
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
    "function __pasta_bind_available",
    "  set -l action $argv[1]",
    "  for seq in $argv[2..-1]",
    "    __pasta_bind_if_unbound $seq $action",
    "  end",
    "end",
    fishBindLine(copy, keybindings.copyKeys),
    fishBindLine(paste, keybindings.pasteKeys),
    "functions -e __pasta_bind_if_unbound __pasta_bind_available"
  ].join("\n");
}

function powershellSnippet(command: string, options: ShellKeybindingOptions): string {
  const keybindings = normalizeShellKeybindingOptions(options);
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
    "function Set-PastaKeyHandlersIfFree {",
    "  param([string[]] $Chords, [scriptblock] $ScriptBlock, [string] $Description)",
    "  foreach ($Chord in $Chords) {",
    "    $Existing = Get-PSReadLineKeyHandler -Chord $Chord -ErrorAction SilentlyContinue",
    "    if (-not $Existing) {",
    "      try {",
    "        Set-PSReadLineKeyHandler -Chord $Chord -ScriptBlock $ScriptBlock -Description $Description -ErrorAction Stop",
    "      } catch {",
    "      }",
    "    }",
    "  }",
    "}",
    "if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) {",
    keybindings.copyKeys.length === 0 ? "  # Pasta copy keybindings disabled" : `  Set-PastaKeyHandlersIfFree -Chords ${powershellArray(keybindings.copyKeys.map(powershellKeySpec))} -ScriptBlock { ${copy} } -Description "Pasta copy"`,
    keybindings.pasteKeys.length === 0 ? "  # Pasta paste keybindings disabled" : `  Set-PastaKeyHandlersIfFree -Chords ${powershellArray(keybindings.pasteKeys.map(powershellKeySpec))} -ScriptBlock { ${paste} } -Description "Pasta paste"`,
    "}",
    "Remove-Item function:Set-PastaKeyHandlersIfFree -ErrorAction SilentlyContinue"
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
