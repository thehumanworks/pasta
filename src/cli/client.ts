import { randomBase64Url, stableJson } from "../shared/encoding";
import { sha256Base64Url, SIGNATURE_HEADERS, type SignedRequestParts } from "../shared/protocol";
import { signCanonicalRequest } from "../shared/crypto";
import type { PastaConfig } from "./config";
import { requireSecret, SecretName, type SecretStore } from "./secret-store";

export interface ApiClient {
  request<T>(method: string, path: string, body?: unknown, signed?: boolean): Promise<T>;
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
      const timestamp = Date.now();
      const nonce = randomBase64Url(18);
      const bodyHash = sha256Base64Url(bodyText);
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
    const init: RequestInit = {
      method,
      headers
    };
    if (body !== undefined) {
      init.body = bodyText;
    }
    const response = await this.fetchImpl(new URL(path, this.config.endpoint), init);
    const responseText = await response.text();
    const parsed = responseText ? JSON.parse(responseText) : {};
    if (!response.ok) {
      const error = parsed?.error ?? `http_${response.status}`;
      throw new Error(String(error));
    }
    return parsed as T;
  }
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
