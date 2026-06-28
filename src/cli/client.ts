import { bytesToUtf8, fromBase64Url, randomBase64Url, stableJson, toBase64Url, utf8ToBytes } from "../shared/encoding";
import { sha256Base64Url, SIGNATURE_HEADERS, type EncryptedClip, type SignedRequestParts, type StoredClip } from "../shared/protocol";
import { signCanonicalRequest } from "../shared/crypto";
import type { PastaConfig } from "./config";
import { requireSecret, SecretName, type SecretStore } from "./secret-store";

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown, signed?: boolean): Promise<T>;
  uploadEncryptedFile?(clip: EncryptedClip): Promise<{ clip: StoredClip }>;
  downloadEncryptedFile?(clipId: string): Promise<{ clip: StoredClip; ciphertext: string }>;
}

export class FetchApiClient implements ApiClient {
  constructor(
    private readonly config: PastaConfig,
    private readonly secrets: SecretStore,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async request<T>(method: string, path: string, body?: unknown, signed = true): Promise<T> {
    const bodyText = body === undefined ? "" : stableJson(body);
    const headers = new Headers();
    if (body !== undefined) headers.set("content-type", "application/json");
    if (signed) {
      await this.signHeaders(headers, method, path, utf8ToBytes(bodyText));
    }
    const init: RequestInit = {
      method,
      headers
    };
    if (body !== undefined) {
      init.body = bodyText;
    }
    const response = await this.fetchImpl(new URL(path, this.config.endpoint), init);
    return await parseJsonFetchResponse<T>(response);
  }

  async uploadEncryptedFile(clip: EncryptedClip): Promise<{ clip: StoredClip }> {
    const encryptedBytes = fromBase64Url(clip.ciphertext);
    const envelope = { ...clip, ciphertext: "" };
    const path = "/v2/files";
    const headers = new Headers({
      "content-type": "application/octet-stream",
      "pasta-file-envelope": toBase64Url(utf8ToBytes(stableJson(envelope)))
    });
    await this.signHeaders(headers, "POST", path, encryptedBytes);
    const response = await this.fetchImpl(new URL(path, this.config.endpoint), {
      method: "POST",
      headers,
      body: requestBodyFromBytes(encryptedBytes)
    });
    return await parseJsonFetchResponse<{ clip: StoredClip }>(response);
  }

  async downloadEncryptedFile(clipId: string): Promise<{ clip: StoredClip; ciphertext: string }> {
    const path = `/v2/files/${encodeURIComponent(clipId)}/content`;
    const headers = new Headers();
    await this.signHeaders(headers, "GET", path, new Uint8Array());
    const response = await this.fetchImpl(new URL(path, this.config.endpoint), {
      method: "GET",
      headers
    });
    if (!response.ok) {
      await throwJsonFetchError(response);
    }
    const envelopeHeader = response.headers.get("pasta-file-envelope");
    if (!envelopeHeader) throw new Error("missing_file_envelope");
    const clip = JSON.parse(bytesToUtf8(fromBase64Url(envelopeHeader))) as StoredClip;
    const encryptedBytes = new Uint8Array(await response.arrayBuffer());
    return { clip, ciphertext: toBase64Url(encryptedBytes) };
  }

  private async signHeaders(headers: Headers, method: string, path: string, body: Uint8Array): Promise<void> {
    const timestamp = Date.now();
    const nonce = randomBase64Url(18);
    const bodyHash = sha256Base64Url(body);
    const parts: SignedRequestParts = {
      method,
      pathWithQuery: path,
      timestamp,
      nonce,
      bodyHash
    };
    headers.set(SIGNATURE_HEADERS.accountId, this.config.accountId);
    headers.set(SIGNATURE_HEADERS.deviceId, this.config.deviceId);
    headers.set(SIGNATURE_HEADERS.timestamp, String(timestamp));
    headers.set(SIGNATURE_HEADERS.nonce, nonce);
    headers.set(SIGNATURE_HEADERS.bodyHash, bodyHash);
    headers.set(SIGNATURE_HEADERS.signature, signCanonicalRequest(parts, await requireSecret(this.secrets, SecretName.signingPrivateKey)));
  }
}

async function parseJsonFetchResponse<T>(response: Response): Promise<T> {
  const responseText = await response.text();
  const parsed = parseJsonResponse(responseText, response);
  if (!response.ok) {
    const error = parsed?.error ?? `http_${response.status}`;
    throw new Error(typeof error === "string" ? error : `http_${response.status}`);
  }
  return parsed as T;
}

async function throwJsonFetchError(response: Response): Promise<never> {
  const responseText = await response.text();
  const parsed = parseJsonResponse(responseText, response);
  const error = parsed?.error ?? `http_${response.status}`;
  throw new Error(typeof error === "string" ? error : `http_${response.status}`);
}

function parseJsonResponse(responseText: string, response: Response): Record<string, unknown> {
  if (!responseText) return {};
  try {
    return JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    const preview = responseText.replace(/\s+/gu, " ").slice(0, 160);
    const detail = preview ? `: ${preview}` : "";
    if (!response.ok) {
      throw new Error(`http_${response.status}${detail}`);
    }
    throw new Error(`invalid_json_response${detail}`);
  }
}

function requestBodyFromBytes(bytes: Uint8Array): BodyInit {
  const copy = new Uint8Array(bytes);
  return copy.buffer as ArrayBuffer;
}

export class MockApiClient implements ApiClient {
  readonly calls: Array<{ method: string; path: string; body?: unknown; signed: boolean }> = [];

  constructor(private readonly responder: (call: { method: string; path: string; body?: unknown; signed: boolean }) => unknown) {}

  async request<T>(method: string, path: string, body?: unknown, signed = true): Promise<T> {
    const call = { method, path, body, signed };
    this.calls.push(call);
    return this.responder(call) as T;
  }
}
