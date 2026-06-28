import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface ClipboardImage {
  mime: "image/png";
  bytes: Uint8Array;
}

export interface ClipboardAdapter {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  readImage(): Promise<ClipboardImage>;
  writeImage(image: ClipboardImage): Promise<void>;
  doctor(): Promise<ClipboardDoctorResult>;
}

export interface ClipboardDoctorResult {
  platform: NodeJS.Platform;
  adapter: string | null;
  available: boolean;
  details: string[];
}

export class SystemClipboardAdapter implements ClipboardAdapter {
  private readonly planCache = new Map<"read" | "write", { name: string; command: string[] }>();
  private osascriptAvailable: boolean | null = null;

  async readText(): Promise<string> {
    const plan = await this.clipboardPlan("read");
    return runCommand(plan.command);
  }

  async writeText(text: string): Promise<void> {
    const plan = await this.clipboardPlan("write");
    await runCommand(plan.command, text);
  }

  async readImage(): Promise<ClipboardImage> {
    if (process.platform !== "darwin") {
      throw new Error("image clipboard is currently supported only on macOS; Linux/Windows remain command-plan assumptions");
    }
    await this.requireOsascript();
    const dir = await mkdtemp(join(tmpdir(), "pasta-image-"));
    const out = join(dir, "clipboard.png");
    try {
      await runCommand([
        "osascript",
        "-l",
        "JavaScript",
        "-e",
        `function run(argv) {
  ObjC.import("AppKit");
  const out = argv[0];
  const data = $.NSPasteboard.generalPasteboard.dataForType($("public.png"));
  if (!data) throw new Error("no PNG image in clipboard");
  const ok = data.writeToFileAtomically($(out), true);
  if (!ok) throw new Error("failed to write clipboard image");
}`,
        out
      ]);
      return { mime: "image/png", bytes: new Uint8Array(await Bun.file(out).arrayBuffer()) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async writeImage(image: ClipboardImage): Promise<void> {
    if (process.platform !== "darwin") {
      throw new Error("image clipboard is currently supported only on macOS; Linux/Windows remain command-plan assumptions");
    }
    await this.requireOsascript();
    if (image.mime !== "image/png") throw new Error(`unsupported image MIME for clipboard: ${image.mime}`);
    const dir = await mkdtemp(join(tmpdir(), "pasta-image-"));
    const input = join(dir, "clipboard.png");
    try {
      await writeFile(input, image.bytes);
      await runCommand([
        "osascript",
        "-l",
        "JavaScript",
        "-e",
        `function run(argv) {
  ObjC.import("AppKit");
  const input = argv[0];
  const data = $.NSData.dataWithContentsOfFile($(input));
  if (!data) throw new Error("failed to read PNG file");
  const pasteboard = $.NSPasteboard.generalPasteboard;
  pasteboard.clearContents;
  const ok = pasteboard.setDataForType(data, $("public.png"));
  if (!ok) throw new Error("failed to write PNG image to clipboard");
}`,
        input
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async clipboardPlan(direction: "read" | "write"): Promise<{ name: string; command: string[] }> {
    const cached = this.planCache.get(direction);
    if (cached) return cached;
    const plan = await chooseClipboardPlan(direction);
    this.planCache.set(direction, plan);
    return plan;
  }

  private async requireOsascript(): Promise<void> {
    if (this.osascriptAvailable === true) return;
    if (this.osascriptAvailable === false) throw new Error("osascript is required for image clipboard support");
    this.osascriptAvailable = await commandExists("osascript");
    if (!this.osascriptAvailable) throw new Error("osascript is required for image clipboard support");
  }

  async doctor(): Promise<ClipboardDoctorResult> {
    const details: string[] = [];
    for (const candidate of clipboardCandidatesForPlatform(process.platform)) {
      const present = await commandExists(candidate.probe);
      details.push(`${candidate.name}: ${present ? "available" : "missing"}`);
      if (present) {
        return {
          platform: process.platform,
          adapter: candidate.name,
          available: true,
          details
        };
      }
    }
    return {
      platform: process.platform,
      adapter: null,
      available: false,
      details
    };
  }
}

export class MemoryClipboardAdapter implements ClipboardAdapter {
  constructor(public value = "", public image: ClipboardImage | null = null) {}

  async readText(): Promise<string> {
    return this.value;
  }

  async writeText(text: string): Promise<void> {
    this.value = text;
  }

  async readImage(): Promise<ClipboardImage> {
    if (!this.image) throw new Error("no image in clipboard");
    return this.image;
  }

  async writeImage(image: ClipboardImage): Promise<void> {
    this.image = image;
  }

  async doctor(): Promise<ClipboardDoctorResult> {
    return {
      platform: process.platform,
      adapter: "memory",
      available: true,
      details: ["memory: available"]
    };
  }
}

export interface ClipboardCandidate {
  name: string;
  probe: string;
  read: string[];
  write: string[];
}

export function clipboardCandidatesForPlatform(platform: NodeJS.Platform): ClipboardCandidate[] {
  if (platform === "darwin") {
    return [{ name: "macos-pbcopy", probe: "pbcopy", read: ["pbpaste"], write: ["pbcopy"] }];
  }
  if (platform === "win32") {
    return [
      {
        name: "windows-powershell",
        probe: "powershell.exe",
        read: ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
        write: ["powershell.exe", "-NoProfile", "-Command", "$input | Set-Clipboard"]
      },
      {
        name: "windows-pwsh",
        probe: "pwsh",
        read: ["pwsh", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
        write: ["pwsh", "-NoProfile", "-Command", "$input | Set-Clipboard"]
      }
    ];
  }
  return [
    { name: "wayland-wl-clipboard", probe: "wl-copy", read: ["wl-paste", "--no-newline"], write: ["wl-copy"] },
    { name: "x11-xclip", probe: "xclip", read: ["xclip", "-selection", "clipboard", "-o"], write: ["xclip", "-selection", "clipboard"] },
    { name: "x11-xsel", probe: "xsel", read: ["xsel", "--clipboard", "--output"], write: ["xsel", "--clipboard", "--input"] }
  ];
}

async function chooseClipboardPlan(direction: "read" | "write"): Promise<{ name: string; command: string[] }> {
  for (const candidate of clipboardCandidatesForPlatform(process.platform)) {
    if (await commandExists(candidate.probe)) {
      return { name: candidate.name, command: candidate[direction] };
    }
  }
  throw new Error("No supported clipboard adapter found. Install pbcopy/pbpaste, wl-clipboard, xclip/xsel, or PowerShell.");
}

async function commandExists(command: string): Promise<boolean> {
  const proc = Bun.spawn(["sh", "-c", `command -v ${shellEscape(command)} >/dev/null 2>&1`], {
    stdout: "ignore",
    stderr: "ignore"
  });
  return (await proc.exited) === 0;
}


async function runCommand(command: string[], input?: string): Promise<string> {
  const proc = Bun.spawn(command, {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });
  if (input !== undefined) {
    if (!proc.stdin) throw new Error(`${command[0]} did not open stdin`);
    proc.stdin.write(input);
    proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) {
    throw new Error(`${command[0]} failed: ${stderr.trim() || `exit ${code}`}`);
  }
  return stdout;
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
