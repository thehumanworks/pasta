import { sha256Base64Url } from "../shared/protocol";
import type { ClipboardAdapter } from "./clipboard";

export interface DaemonOptions {
  intervalMs: number;
  once: boolean;
  dryRun: boolean;
}

export async function runDaemonLoop(
  clipboard: ClipboardAdapter,
  publish: (text: string) => Promise<void>,
  getLastRemotePasteHash: () => string | undefined,
  options: DaemonOptions
): Promise<{ published: number }> {
  let lastHash: string | undefined;
  let published = 0;
  for (;;) {
    const text = await clipboard.readText();
    const hash = sha256Base64Url(text);
    if (text.length > 0 && hash !== lastHash && hash !== getLastRemotePasteHash()) {
      lastHash = hash;
      if (!options.dryRun) {
        await publish(text);
        published += 1;
      }
    }
    if (options.once) return { published };
    await Bun.sleep(options.intervalMs);
  }
}

