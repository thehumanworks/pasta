import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Paths } from "./config";

export const GLOBAL_HOTKEY_PROVIDERS = ["auto", "macos"] as const;
export type GlobalHotkeyProvider = (typeof GLOBAL_HOTKEY_PROVIDERS)[number];

export const MACOS_HOTKEY_LABEL = "work.thehumanworks.pasta.hotkeys";
export const DEFAULT_GLOBAL_COPY_KEY = "hyper+c";
export const DEFAULT_GLOBAL_PASTE_KEY = "hyper+p";

export class GlobalHotkeyUsageError extends Error {}
export class GlobalHotkeyUnsupportedError extends Error {}
export class GlobalHotkeyInstallError extends Error {}

export interface HotkeyCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type HotkeyCommandRunner = (
  command: readonly string[],
  options?: { allowFailure?: boolean }
) => Promise<HotkeyCommandResult>;

export type HotkeyCommandResolver = (command: string) => string | null | undefined;

export interface InstallGlobalHotkeyOptions {
  command?: string;
  provider?: GlobalHotkeyProvider;
  copyKey?: string;
  pasteKey?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  runner?: HotkeyCommandRunner;
  commandResolver?: HotkeyCommandResolver;
  uid?: string;
  swiftcPath?: string;
  launchctlPath?: string;
}

export interface UninstallGlobalHotkeyOptions {
  provider?: GlobalHotkeyProvider;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  runner?: HotkeyCommandRunner;
  uid?: string;
  launchctlPath?: string;
}

export interface MacosHotkeyPaths {
  directory: string;
  sourcePath: string;
  binaryPath: string;
  stdoutLogPath: string;
  stderrLogPath: string;
  launchAgentPath: string;
}

export interface InstalledGlobalHotkeys {
  provider: "macos";
  paths: MacosHotkeyPaths;
  copyKey: string;
  pasteKey: string;
}

interface NormalizedHotkey {
  action: "copy" | "paste";
  id: number;
  spec: string;
  keyCode: number;
  modifiers: readonly MacosModifier[];
  commandLine: string;
}

type MacosModifier = "ctrl" | "opt" | "shift" | "cmd";

const MODIFIER_ORDER: readonly MacosModifier[] = ["ctrl", "opt", "shift", "cmd"];
const MODIFIER_ALIASES: Record<string, MacosModifier | undefined> = {
  control: "ctrl",
  ctrl: "ctrl",
  option: "opt",
  opt: "opt",
  alt: "opt",
  shift: "shift",
  command: "cmd",
  cmd: "cmd"
};
const CARBON_MODIFIERS: Record<MacosModifier, string> = {
  ctrl: "controlKey",
  opt: "optionKey",
  shift: "shiftKey",
  cmd: "cmdKey"
};
const MACOS_KEY_CODES: Record<string, number | undefined> = {
  a: 0,
  s: 1,
  d: 2,
  f: 3,
  h: 4,
  g: 5,
  z: 6,
  x: 7,
  c: 8,
  v: 9,
  b: 11,
  q: 12,
  w: 13,
  e: 14,
  r: 15,
  y: 16,
  t: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "=": 24,
  "9": 25,
  "7": 26,
  "-": 27,
  "8": 28,
  "0": 29,
  "]": 30,
  o: 31,
  u: 32,
  "[": 33,
  i: 34,
  p: 35,
  l: 37,
  j: 38,
  "'": 39,
  k: 40,
  ";": 41,
  "\\": 42,
  ",": 43,
  "/": 44,
  n: 45,
  m: 46,
  ".": 47,
  "`": 50
};

export function isGlobalHotkeyProvider(value: string): value is GlobalHotkeyProvider {
  return (GLOBAL_HOTKEY_PROVIDERS as readonly string[]).includes(value);
}

export function globalHotkeySpecHelp(): string {
  return "supported macOS key specs: hyper+<key>, cmd+shift+<key>, ctrl+opt+shift+cmd+<key>, alt+<key>, or none";
}

export function macosHotkeyPaths(paths: Paths, env: Record<string, string | undefined> = Bun.env): MacosHotkeyPaths {
  const userHome = env.HOME;
  if (!userHome) throw new GlobalHotkeyUsageError("HOME is required to install a macOS LaunchAgent");
  const directory = join(paths.home, "hotkeys", "macos");
  return {
    directory,
    sourcePath: join(directory, "PastaHotkeys.swift"),
    binaryPath: join(directory, "PastaHotkeys"),
    stdoutLogPath: join(directory, "stdout.log"),
    stderrLogPath: join(directory, "stderr.log"),
    launchAgentPath: join(userHome, "Library", "LaunchAgents", `${MACOS_HOTKEY_LABEL}.plist`)
  };
}

export function normalizeGlobalHotkeys(options: InstallGlobalHotkeyOptions = {}): readonly NormalizedHotkey[] {
  const command = normalizeCommand(options.command ?? "pasta");
  const copyKey = options.copyKey ?? options.env?.PASTA_COPY_KEY ?? DEFAULT_GLOBAL_COPY_KEY;
  const pasteKey = options.pasteKey ?? options.env?.PASTA_PASTE_KEY ?? DEFAULT_GLOBAL_PASTE_KEY;
  const copy = normalizeMacosHotkey("copy", 1, copyKey, actionCommandLine(command, ["copy"]));
  const paste = normalizeMacosHotkey("paste", 2, pasteKey, actionCommandLine(command, ["paste", "--clipboard"]));
  const hotkeys = [copy, paste].filter((hotkey): hotkey is NormalizedHotkey => hotkey !== null);
  if (hotkeys.length === 0) throw new GlobalHotkeyUsageError("at least one global hotkey must be enabled");
  if (copy && paste && sameHotkey(copy, paste)) {
    throw new GlobalHotkeyUsageError("--copy-key and --paste-key must not use the same global hotkey");
  }
  return hotkeys;
}

export function macosHotkeySource(hotkeys: readonly NormalizedHotkey[]): string {
  const actionLines = hotkeys.map((hotkey) => {
    const modifiers = hotkey.modifiers.map((modifier) => CARBON_MODIFIERS[modifier]).join(" | ");
    return `  HotKeyAction(id: ${hotkey.id}, name: ${swiftStringLiteral(hotkey.action)}, spec: ${swiftStringLiteral(hotkey.spec)}, keyCode: ${hotkey.keyCode}, modifiers: UInt32(${modifiers}), commandLine: ${swiftStringLiteral(hotkey.commandLine)})`;
  });
  return `import Carbon
import Foundation

struct HotKeyAction {
  let id: UInt32
  let name: String
  let spec: String
  let keyCode: UInt32
  let modifiers: UInt32
  let commandLine: String
}

let actions: [HotKeyAction] = [
${actionLines.join(",\n")}
]

let signature = OSType(0x50535441) // PSTA
var registeredHotKeys: [EventHotKeyRef?] = []
let actionsById = Dictionary(uniqueKeysWithValues: actions.map { ($0.id, $0) })

func writeStderr(_ value: String) {
  FileHandle.standardError.write(Data(value.utf8))
}

func registerHotKey(_ action: HotKeyAction) -> OSStatus {
  let hotKeyID = EventHotKeyID(signature: signature, id: action.id)
  var hotKeyRef: EventHotKeyRef?
  let status = RegisterEventHotKey(action.keyCode, action.modifiers, hotKeyID, GetApplicationEventTarget(), OptionBits(kEventHotKeyExclusive), &hotKeyRef)
  if status == noErr {
    registeredHotKeys.append(hotKeyRef)
  }
  return status
}

func registerAllOrExit() {
  for action in actions {
    let status = registerHotKey(action)
    if status != noErr {
      writeStderr("Pasta hotkey conflict for \\(action.name) \\(action.spec): Carbon status \\(status)\\n")
      exit(2)
    }
  }
}

func runAction(_ action: HotKeyAction) {
  DispatchQueue.global(qos: .userInitiated).async {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", action.commandLine]
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError
    do {
      try process.run()
      process.waitUntilExit()
      if process.terminationStatus != 0 {
        writeStderr("Pasta hotkey \\(action.name) exited with status \\(process.terminationStatus)\\n")
      }
    } catch {
      writeStderr("Pasta hotkey \\(action.name) failed to start: \\(error)\\n")
    }
  }
}

let handler: EventHandlerUPP = { _, eventRef, _ in
  var hotKeyID = EventHotKeyID()
  let status = GetEventParameter(
    eventRef,
    EventParamName(kEventParamDirectObject),
    EventParamType(typeEventHotKeyID),
    nil,
    MemoryLayout<EventHotKeyID>.size,
    nil,
    &hotKeyID
  )
  if status == noErr, let action = actionsById[hotKeyID.id] {
    runAction(action)
  }
  return noErr
}

if CommandLine.arguments.contains("--check-conflicts") {
  registerAllOrExit()
  exit(0)
}

var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
let handlerStatus = InstallEventHandler(GetApplicationEventTarget(), handler, 1, &eventType, nil, nil)
if handlerStatus != noErr {
  writeStderr("Pasta hotkey helper could not install event handler: Carbon status \\(handlerStatus)\\n")
  exit(1)
}

registerAllOrExit()
RunLoop.main.run()
`;
}

export function macosLaunchAgentPlist(paths: MacosHotkeyPaths): string {
  const pastaHome = dirname(dirname(paths.directory));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(MACOS_HOTKEY_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(paths.binaryPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PASTA_HOME</key>
    <string>${xmlEscape(pastaHome)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(paths.stdoutLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(paths.stderrLogPath)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(paths.directory)}</string>
</dict>
</plist>
`;
}

export async function installGlobalHotkeys(paths: Paths, options: InstallGlobalHotkeyOptions = {}): Promise<InstalledGlobalHotkeys> {
  resolveGlobalHotkeyProvider(options.provider ?? "auto", options.platform ?? process.platform);
  const hotkeyPaths = macosHotkeyPaths(paths, options.env ?? Bun.env);
  const command = options.command ?? resolveDefaultGlobalHotkeyCommand(options.commandResolver);
  const hotkeys = normalizeGlobalHotkeys({ ...options, command });
  const runner = options.runner ?? defaultHotkeyCommandRunner;
  const swiftcPath = options.swiftcPath ?? "/usr/bin/swiftc";
  const launchctlPath = options.launchctlPath ?? "/bin/launchctl";
  const uid = macosUid(options.uid);

  await mkdir(hotkeyPaths.directory, { recursive: true });
  await Bun.write(hotkeyPaths.sourcePath, macosHotkeySource(hotkeys));
  await runRequired(
    runner,
    [swiftcPath, hotkeyPaths.sourcePath, "-o", hotkeyPaths.binaryPath, "-framework", "Carbon"],
    `failed to compile macOS hotkey helper with ${swiftcPath}; install Xcode command line tools and retry`
  );
  await chmod(hotkeyPaths.binaryPath, 0o755).catch(() => undefined);

  await runner([launchctlPath, "bootout", `gui/${uid}/${MACOS_HOTKEY_LABEL}`], { allowFailure: true });
  await runRequired(
    runner,
    [hotkeyPaths.binaryPath, "--check-conflicts"],
    "macOS hotkey conflict check failed; Pasta did not load the LaunchAgent"
  );
  await mkdir(dirname(hotkeyPaths.launchAgentPath), { recursive: true });
  await Bun.write(hotkeyPaths.launchAgentPath, macosLaunchAgentPlist(hotkeyPaths));
  await runRequired(
    runner,
    [launchctlPath, "bootstrap", `gui/${uid}`, hotkeyPaths.launchAgentPath],
    "failed to load Pasta macOS hotkey LaunchAgent"
  );
  await runRequired(
    runner,
    [launchctlPath, "kickstart", "-k", `gui/${uid}/${MACOS_HOTKEY_LABEL}`],
    "failed to start Pasta macOS hotkey LaunchAgent"
  );

  const copy = hotkeys.find((hotkey) => hotkey.action === "copy");
  const paste = hotkeys.find((hotkey) => hotkey.action === "paste");
  return {
    provider: "macos",
    paths: hotkeyPaths,
    copyKey: copy?.spec ?? "none",
    pasteKey: paste?.spec ?? "none"
  };
}

function resolveDefaultGlobalHotkeyCommand(resolver: HotkeyCommandResolver = Bun.which): string {
  try {
    return resolver("pasta") ?? "pasta";
  } catch {
    return "pasta";
  }
}

export async function uninstallGlobalHotkeys(paths: Paths, options: UninstallGlobalHotkeyOptions = {}): Promise<MacosHotkeyPaths> {
  resolveGlobalHotkeyProvider(options.provider ?? "auto", options.platform ?? process.platform);
  const hotkeyPaths = macosHotkeyPaths(paths, options.env ?? Bun.env);
  const runner = options.runner ?? defaultHotkeyCommandRunner;
  const launchctlPath = options.launchctlPath ?? "/bin/launchctl";
  const uid = macosUid(options.uid);

  await runner([launchctlPath, "bootout", `gui/${uid}/${MACOS_HOTKEY_LABEL}`], { allowFailure: true });
  await Promise.all([
    rm(hotkeyPaths.launchAgentPath, { force: true }),
    rm(hotkeyPaths.sourcePath, { force: true }),
    rm(hotkeyPaths.binaryPath, { force: true }),
    rm(hotkeyPaths.stdoutLogPath, { force: true }),
    rm(hotkeyPaths.stderrLogPath, { force: true })
  ]);
  await rm(hotkeyPaths.directory, { force: true, recursive: true }).catch(() => undefined);
  return hotkeyPaths;
}

function resolveGlobalHotkeyProvider(provider: GlobalHotkeyProvider, platform: NodeJS.Platform): "macos" {
  if (provider === "auto" && platform === "darwin") return "macos";
  if (provider === "macos" && platform === "darwin") return "macos";
  throw new GlobalHotkeyUnsupportedError("global hotkeys are currently supported only on macOS; use pasta install-shell for portable terminal bindings");
}

function normalizeMacosHotkey(
  action: "copy" | "paste",
  id: number,
  value: string,
  commandLine: string
): NormalizedHotkey | null {
  const spec = value.trim().toLowerCase();
  if (!spec) throw new GlobalHotkeyUsageError(`${action} hotkey cannot be empty; ${globalHotkeySpecHelp()}`);
  if (spec === "none") return null;

  const parts = spec.split("+").filter(Boolean);
  const key = parts.at(-1);
  if (!key || MACOS_KEY_CODES[key] === undefined) {
    throw new GlobalHotkeyUsageError(`${action} hotkey ${JSON.stringify(value)} must end with a supported macOS key; ${globalHotkeySpecHelp()}`);
  }
  const modifierParts = parts.slice(0, -1);
  if (modifierParts.length === 0) {
    throw new GlobalHotkeyUsageError(`${action} hotkey ${JSON.stringify(value)} must include a modifier; ${globalHotkeySpecHelp()}`);
  }

  const modifiers = new Set<MacosModifier>();
  for (const part of modifierParts) {
    if (part === "hyper") {
      for (const modifier of MODIFIER_ORDER) modifiers.add(modifier);
      continue;
    }
    const modifier = MODIFIER_ALIASES[part];
    if (!modifier) {
      throw new GlobalHotkeyUsageError(`${action} hotkey ${JSON.stringify(value)} has unsupported modifier ${JSON.stringify(part)}; ${globalHotkeySpecHelp()}`);
    }
    modifiers.add(modifier);
  }
  if (modifiers.size === 0) {
    throw new GlobalHotkeyUsageError(`${action} hotkey ${JSON.stringify(value)} must include a modifier; ${globalHotkeySpecHelp()}`);
  }
  if (isReservedMacosShortcut(modifiers, key)) {
    throw new GlobalHotkeyUsageError(`${action} hotkey ${JSON.stringify(value)} is reserved by terminal, OS, or active app shortcuts`);
  }

  const orderedModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return {
    action,
    id,
    spec: canonicalSpec(orderedModifiers, key),
    keyCode: MACOS_KEY_CODES[key],
    modifiers: orderedModifiers,
    commandLine
  };
}

function canonicalSpec(modifiers: readonly MacosModifier[], key: string): string {
  if (modifiers.length === 4 && modifiers.every((modifier, index) => modifier === MODIFIER_ORDER[index])) {
    return `hyper+${key}`;
  }
  return `${modifiers.join("+")}+${key}`;
}

function sameHotkey(left: NormalizedHotkey, right: NormalizedHotkey): boolean {
  return left.keyCode === right.keyCode && left.modifiers.join("+") === right.modifiers.join("+");
}

function isReservedMacosShortcut(modifiers: ReadonlySet<MacosModifier>, key: string): boolean {
  if (key === "c" && modifiers.size === 1 && modifiers.has("ctrl")) return true;
  if ((key === "c" || key === "v" || key === "p") && modifiers.size === 1 && modifiers.has("cmd")) return true;
  return false;
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) throw new GlobalHotkeyUsageError("--command cannot be empty");
  return trimmed;
}

function actionCommandLine(command: string, args: readonly string[]): string {
  const base = commandShouldStayShellPrefix(command) ? command : posixQuote(command);
  return [base, ...args.map(posixQuote)].join(" ");
}

function commandShouldStayShellPrefix(command: string): boolean {
  return /\s/u.test(command) && !command.startsWith("/") && !command.startsWith("./") && !command.startsWith("../");
}

function posixQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function swiftStringLiteral(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "\\\"")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function macosUid(value?: string): string {
  if (value) return value;
  const uid = process.getuid?.();
  if (uid === undefined) throw new GlobalHotkeyUnsupportedError("macOS LaunchAgent install requires a user id");
  return String(uid);
}

async function runRequired(runner: HotkeyCommandRunner, command: readonly string[], message: string): Promise<HotkeyCommandResult> {
  const result = await runner(command);
  if (result.code !== 0) throw new GlobalHotkeyInstallError(`${message}: ${formatRunnerResult(result)}`);
  return result;
}

function formatRunnerResult(result: HotkeyCommandResult): string {
  const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  return detail || `exit ${result.code}`;
}

async function defaultHotkeyCommandRunner(command: readonly string[]): Promise<HotkeyCommandResult> {
  try {
    const proc = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ]);
    return { code, stdout, stderr };
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}
