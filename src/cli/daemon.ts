import { sha256Base64Url } from "../shared/protocol";
import type { ClipboardAdapter } from "./clipboard";

export interface DaemonOptions {
  intervalMs: number;
  once: boolean;
  dryRun: boolean;
  maxIntervalMs?: number;
  idleBackoffMultiplier?: number;
}

export async function runDaemonLoop(
  clipboard: ClipboardAdapter,
  publish: (text: string) => Promise<void>,
  getLastRemotePasteHash: () => string | undefined,
  options: DaemonOptions
): Promise<{ published: number; iterations: number }> {
  const baseIntervalMs = Math.max(50, options.intervalMs);
  const maxIntervalMs = Math.max(baseIntervalMs, options.maxIntervalMs ?? Math.max(baseIntervalMs, 5_000));
  const multiplier = Math.max(1.1, options.idleBackoffMultiplier ?? 1.5);
  let delayMs = baseIntervalMs;
  let lastHash: string | undefined;
  let published = 0;
  let iterations = 0;
  for (;;) {
    iterations += 1;
    const text = await clipboard.readText();
    const hash = sha256Base64Url(text);
    const changed = text.length > 0 && hash !== lastHash && hash !== getLastRemotePasteHash();
    if (changed) {
      lastHash = hash;
      delayMs = baseIntervalMs;
      if (!options.dryRun) {
        await publish(text);
        published += 1;
      }
    } else {
      delayMs = Math.min(maxIntervalMs, Math.ceil(delayMs * multiplier));
    }
    if (options.once) return { published, iterations };
    await Bun.sleep(delayMs);
  }
}
