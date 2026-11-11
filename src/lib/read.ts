import { metabolightsFetch } from "./http";
import { readResponseBytes, decodeResponseText } from "@bio-mcp/shared/http/response-reader";

const MAX_BYTES = 4 * 1024 * 1024;
const BODY_TIMEOUT_MS = 10000;

export async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}

export async function readMetabolights(path: string, params?: Record<string, unknown>, format: "json" | "text" = "json", deadlineAt = Date.now() + 25000) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw Object.assign(new Error("MetaboLights read deadline exceeded"), { status: 504 });
  const response = await metabolightsFetch(path, params, { timeout: Math.min(10000, remaining), deadlineMs: Math.min(15000, remaining) });
  let text: string;
  try {
    text = decodeResponseText(await readResponseBytes(response, { label: "MetaboLights", maxBytes: MAX_BYTES,
      timeoutMs: Math.min(BODY_TIMEOUT_MS, deadlineAt - Date.now()) }), "MetaboLights");
  } catch (error) {
    if (!response.ok) throw Object.assign(new Error(`MetaboLights HTTP ${response.status}`), { status: response.status,
      data: { http_status: response.status, body_unavailable: true, body_error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
  if (!response.ok) throw Object.assign(new Error(`MetaboLights HTTP ${response.status}: ${text.slice(0, 200)}`), { status: response.status, data: text });
  let data: unknown = text;
  if (format === "json" && response.headers.get("content-type")?.includes("json")) {
    try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { throw Object.assign(new Error("MetaboLights returned invalid JSON"), { status: 502, data: { response: text } }); }
  }
  return { status: response.status, data, text, source: {
    url: `https://www.ebi.ac.uk/metabolights/ws${path}`, query: params ?? {},
    decoded_utf8_sha256: await sha256(text), retrieved_at: new Date().toISOString(),
    etag: response.headers.get("etag"), last_modified: response.headers.get("last-modified"),
    release_pinned: false,
  } };
}
