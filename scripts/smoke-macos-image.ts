import { SystemClipboardAdapter } from "../src/cli/clipboard";

if (process.platform !== "darwin") {
  console.log("skip macOS image smoke: not darwin");
  process.exit(0);
}

const clipboard = new SystemClipboardAdapter();
const previousText = await clipboard.readText().catch(() => null);
const png = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
));

try {
  await clipboard.writeImage({ mime: "image/png", bytes: png });
  const read = await clipboard.readImage();
  if (read.mime !== "image/png" || read.bytes.length !== png.length || read.bytes.some((value, index) => value !== png[index])) {
    throw new Error(`image mismatch ${read.bytes.length} != ${png.length}`);
  }
  console.log(`macos-image-ok ${read.bytes.length}`);
} finally {
  if (previousText !== null) await clipboard.writeText(previousText);
}
