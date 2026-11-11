import { sha256 } from "./read";
import { referenceRequest } from "./reference-request";
const MAX_BYTES = 1024 * 1024;

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

/** Resolve a reported reference, without asserting experimental chemical identity. */
export async function readPublicReference(namespace: string, accession: string, deadlineAt: number, onResponse?: (status: number) => void) {
  const request = referenceRequest(namespace, accession);
  const remaining = Math.min(15000, deadlineAt - Date.now());
  if (remaining <= 0) fail(504, `${namespace} reference lookup deadline exceeded`);
  const url = request.url;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: controller.signal });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {}); // Best-effort cleanup of a late response.
          fail(504, `${namespace} reference lookup deadline exceeded`);
        }
        onResponse?.(response.status);
        const length = response.headers.get("content-length");
        reader = response.body?.getReader();
        if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) fail(413, `${namespace} record exceeds 1 MiB`);
        return await readReferenceBody(reader, controller, namespace, request, response, accession, url);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error(`${namespace} reference lookup deadline exceeded`), { status: 504 }));
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer); controller.abort();
    if (reader) {
      void reader.cancel().catch(() => {}); // Cleanup must not wait for an unresponsive upstream.
      reader.releaseLock();
    }
  }
}

async function readReferenceBody(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>> | undefined, controller: AbortController, namespace: string, request: { provider: string; url: string; identify(native: unknown): string | null; }, response: Response, accession: string, url: string) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const chunks: string[] = []; let bytes = 0;
  while (reader) {
    const part = await reader.read();
    if (controller.signal.aborted) fail(504, `${namespace} reference lookup deadline exceeded`);
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_BYTES) fail(413, `${namespace} record exceeds 1 MiB`);
    chunks.push(decoder.decode(part.value, { stream: true }));
  }
  chunks.push(decoder.decode());
  const text = chunks.join("");
  let native: unknown = text;
  try { native = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { /* Preserve non-JSON errors and unrecognized records. */ }
  const returned = request.identify(native);
  const resolution = referenceResolution(response, returned, accession);
  return {
    http_status: response.status, resolution, returned_accession: returned,
    reference_match: response.status === 200 && returned === accession, native,
    source: {
      url, provider: namespace, retrieved_at: new Date().toISOString(), decoded_utf8_sha256: await sha256(text),
      etag: response.headers.get("etag"), last_modified: response.headers.get("last-modified"),
      location: response.headers.get("location"), retry_after: response.headers.get("retry-after"),
      request_throttling: response.headers.get("x-throttling-control"), release_pinned: false
    },
  };
}

function referenceResolution(response: Response, returned: string | null, accession: string) {
  if (response.status >= 300 && response.status < 400) return "redirect_not_followed";
  if (response.status === 202) return "pending";
  if (response.status === 404) return "not_found";
  if (!response.ok) return "upstream_error";
  if (!returned) return "unrecognized_record";
  return returned === accession ? "requested_accession_returned" : "different_accession_returned";
}
