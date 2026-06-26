import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

describe("hardening scans", () => {
  it("keeps runtime source free of log calls and sensitive R2 metadata names", async () => {
    const files = await tsFiles("src");
    const workerSource = await readFile("src/worker/index.ts", "utf8");

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, `${file} should not log runtime values`).not.toMatch(/\bconsole\.(debug|error|info|log|warn)\s*\(/u);
    }

    const metadataBlocks = workerSource.matchAll(/customMetadata:\s*\{(?<body>[^}]*)\}/gsu);
    for (const match of metadataBlocks) {
      expect(match.groups?.body ?? "", "R2 metadata must not include filenames or local paths").not.toMatch(/\b(fileName|filename|name|path)\b/iu);
    }
  });
});

async function tsFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await tsFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}
