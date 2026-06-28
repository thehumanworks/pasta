import { lstat, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export const DIRECTORY_BUNDLE_MIME = "application/vnd.pasta.directory+zip";

interface ZipEntry {
  name: string;
  directory: boolean;
  size: number;
  crc: number;
  filePath?: string;
}

interface WalkState {
  maxBytes: number;
  sourceBytes: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

export async function zipDirectory(rootPath: string, maxBytes: number): Promise<Uint8Array> {
  const rootStat = await lstat(rootPath);
  if (rootStat.isSymbolicLink()) throw new Error("directory copy does not support symlink roots");
  if (!rootStat.isDirectory()) throw new Error(`not a directory: ${rootPath}`);
  const entries = await collectEntries(rootPath, rootPath, { maxBytes, sourceBytes: 0 });
  const zip = await buildZip(entries);
  if (zip.length > maxBytes) throw new Error(`directory bundle exceeds max size ${maxBytes}`);
  return zip;
}

export async function unzipDirectoryBundle(bytes: Uint8Array, outputDir: string): Promise<number> {
  const outputRoot = resolve(outputDir);
  try {
    await mkdir(outputRoot, { recursive: false });
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") {
      throw new Error(`output directory already exists: ${outputDir}`);
    }
    throw error;
  }

  let offset = 0;
  let entries = 0;
  while (offset + 4 <= bytes.length) {
    const signature = readUInt32(bytes, offset);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error("invalid directory bundle zip");
    if (offset + 30 > bytes.length) throw new Error("truncated directory bundle zip");

    const flags = readUInt16(bytes, offset + 6);
    const method = readUInt16(bytes, offset + 8);
    const expectedCrc = readUInt32(bytes, offset + 14);
    const compressedSize = readUInt32(bytes, offset + 18);
    const uncompressedSize = readUInt32(bytes, offset + 22);
    const nameLength = readUInt16(bytes, offset + 26);
    const extraLength = readUInt16(bytes, offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;

    if ((flags & 0x0001) !== 0) throw new Error("encrypted zip entries are not supported");
    if ((flags & 0x0008) !== 0) throw new Error("zip data descriptors are not supported");
    if (method !== STORE_METHOD) throw new Error("compressed zip entries are not supported");
    if (compressedSize !== uncompressedSize) throw new Error("zip entry size mismatch");
    if (nameEnd > bytes.length || dataEnd > bytes.length) throw new Error("truncated directory bundle zip");

    const name = decoder.decode(bytes.slice(nameStart, nameEnd));
    const entryBytes = bytes.slice(dataStart, dataEnd);
    if (crc32(entryBytes) !== expectedCrc) throw new Error("zip entry checksum mismatch");

    const target = resolveZipEntry(outputRoot, name);
    if (name.endsWith("/")) {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await Bun.write(target, entryBytes);
    }
    entries += 1;
    offset = dataEnd;
  }
  return entries;
}

async function collectEntries(rootPath: string, currentPath: string, state: WalkState): Promise<ZipEntry[]> {
  const dirents = await readdir(currentPath, { withFileTypes: true });
  dirents.sort((left, right) => left.name.localeCompare(right.name));
  const entries: ZipEntry[] = [];
  for (const dirent of dirents) {
    const fullPath = join(currentPath, dirent.name);
    const stat = await lstat(fullPath);
    const relativeName = zipRelativeName(rootPath, fullPath);
    if (stat.isSymbolicLink()) throw new Error(`directory copy does not support symlink: ${relativeName}`);
    if (stat.isDirectory()) {
      entries.push({ name: `${relativeName}/`, directory: true, size: 0, crc: 0 });
      entries.push(...await collectEntries(rootPath, fullPath, state));
      continue;
    }
    if (!stat.isFile()) throw new Error(`directory copy supports only files and directories: ${relativeName}`);
    state.sourceBytes += stat.size;
    if (state.sourceBytes > state.maxBytes) throw new Error(`directory bundle exceeds max size ${state.maxBytes}`);
    const fileBytes = new Uint8Array(await Bun.file(fullPath).arrayBuffer());
    entries.push({
      name: relativeName,
      directory: false,
      size: fileBytes.length,
      crc: crc32(fileBytes),
      filePath: fullPath
    });
  }
  return entries;
}

function zipRelativeName(rootPath: string, fullPath: string): string {
  const name = relative(rootPath, fullPath).split(sep).join("/");
  if (!name || name.startsWith("../") || name === ".." || name.includes("\0")) {
    throw new Error(`unsafe directory entry: ${name}`);
  }
  return name;
}

async function buildZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    if (nameBytes.length > 0xffff) throw new Error(`zip entry name too long: ${entry.name}`);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    writeUInt32(localHeader, 0, 0x04034b50);
    writeUInt16(localHeader, 4, 20);
    writeUInt16(localHeader, 6, UTF8_FLAG);
    writeUInt16(localHeader, 8, STORE_METHOD);
    writeUInt16(localHeader, 10, 0);
    writeUInt16(localHeader, 12, 33);
    writeUInt32(localHeader, 14, entry.crc);
    writeUInt32(localHeader, 18, entry.size);
    writeUInt32(localHeader, 22, entry.size);
    writeUInt16(localHeader, 26, nameBytes.length);
    writeUInt16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);
    chunks.push(localHeader);
    if (!entry.directory) {
      if (!entry.filePath) throw new Error(`missing zip source path: ${entry.name}`);
      chunks.push(new Uint8Array(await Bun.file(entry.filePath).arrayBuffer()));
    }

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    writeUInt32(centralHeader, 0, 0x02014b50);
    writeUInt16(centralHeader, 4, 20);
    writeUInt16(centralHeader, 6, 20);
    writeUInt16(centralHeader, 8, UTF8_FLAG);
    writeUInt16(centralHeader, 10, STORE_METHOD);
    writeUInt16(centralHeader, 12, 0);
    writeUInt16(centralHeader, 14, 33);
    writeUInt32(centralHeader, 16, entry.crc);
    writeUInt32(centralHeader, 20, entry.size);
    writeUInt32(centralHeader, 24, entry.size);
    writeUInt16(centralHeader, 28, nameBytes.length);
    writeUInt16(centralHeader, 30, 0);
    writeUInt16(centralHeader, 32, 0);
    writeUInt16(centralHeader, 34, 0);
    writeUInt16(centralHeader, 36, 0);
    writeUInt32(centralHeader, 38, entry.directory ? 0x10 : 0);
    writeUInt32(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralDirectory.push(centralHeader);

    offset += localHeader.length + entry.size;
  }

  const centralOffset = offset;
  const centralSize = byteLength(centralDirectory);
  const eocd = new Uint8Array(22);
  writeUInt32(eocd, 0, 0x06054b50);
  writeUInt16(eocd, 8, entries.length);
  writeUInt16(eocd, 10, entries.length);
  writeUInt32(eocd, 12, centralSize);
  writeUInt32(eocd, 16, centralOffset);
  return concatBytes([...chunks, ...centralDirectory, eocd]);
}


function resolveZipEntry(root: string, name: string): string {
  if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/u.test(name)) {
    throw new Error(`unsafe zip entry: ${name}`);
  }
  const segments = name.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error(`unsafe zip entry: ${name}`);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) {
    throw new Error(`unsafe zip entry: ${name}`);
  }
  const target = resolve(root, ...segments);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`unsafe zip entry: ${name}`);
  }
  return target;
}

function byteLength(chunks: Uint8Array[]): number {
  return chunks.reduce((sum, chunk) => sum + chunk.length, 0);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(byteLength(chunks));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function readUInt16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function writeUInt16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
