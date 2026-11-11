import { afterEach, expect, it, vi } from "vitest";
import { metabolightsFetch } from "./http";
import { readMetabolights, sha256 } from "./read";
vi.mock("./http", () => ({ metabolightsFetch: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });

it("preserves raw text, native JSON and provider validators with a content hash", async () => {
  const text = '{"study":[{"file":"m_MTBLS1.tsv","size":"0012"}],"other":true}';
  vi.mocked(metabolightsFetch).mockResolvedValue(new Response(text, { headers: { "content-type": "application/json", etag: '"v1"' } }));
  expect(await readMetabolights("/studies/MTBLS1/files")).toMatchObject({ text, data: JSON.parse(text), source: { decoded_utf8_sha256: await sha256(text), etag: '"v1"', release_pinned: false } });
});

it("keeps metadata downloads as text even if a server mislabels their content type", async () => {
  vi.mocked(metabolightsFetch).mockResolvedValue(new Response("database_identifier\tname\nCHEBI:1\tX", { headers: { "content-type": "application/json" } }));
  expect(await readMetabolights("/studies/MTBLS1/download", { file: "m_MTBLS1.tsv" }, "text")).toMatchObject({ data: "database_identifier\tname\nCHEBI:1\tX" });
});

it("rejects provider failures and oversized byte payloads without truncating", async () => {
  vi.mocked(metabolightsFetch).mockResolvedValueOnce(new Response("unavailable", { status: 503 })).mockResolvedValueOnce(new Response("α".repeat(2100000)));
  await expect(readMetabolights("/studies")).rejects.toMatchObject({ status: 503, data: "unavailable" });
  await expect(readMetabolights("/studies")).rejects.toMatchObject({ status: 413 });
});

it("cancels a stalled response body", async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  vi.mocked(metabolightsFetch).mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const assertion = expect(readMetabolights("/studies")).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(10001); await assertion;
  expect(cancel).toHaveBeenCalled();
});

it("bounds an uncooperative body and retains the native HTTP status when its body is unavailable", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const response = { ok: false, status: 503, headers: new Headers(), body: { getReader: () => ({ read: () => new Promise(() => {}), cancel, releaseLock: vi.fn() }) } };
  vi.mocked(metabolightsFetch).mockResolvedValue(response as unknown as Response);
  const assertion = expect(readMetabolights("/studies", undefined, "json", Date.now() + 250)).rejects.toMatchObject({ status: 503, data: { http_status: 503, body_unavailable: true } });
  await vi.advanceTimersByTimeAsync(251); await assertion; expect(cancel).toHaveBeenCalled();
});

it("retains malformed JSON and rejects advertised oversize before reading", async () => {
  vi.mocked(metabolightsFetch).mockResolvedValueOnce(new Response('{broken', { headers: { "content-type": "application/json" } }))
    .mockResolvedValueOnce(new Response("small", { headers: { "content-length": String(5 * 1024 * 1024) } }));
  await expect(readMetabolights("/studies")).rejects.toMatchObject({ status: 502, data: { response: "{broken" } });
  await expect(readMetabolights("/studies")).rejects.toMatchObject({ status: 413 });
});

it("parses JSON with a BOM while hashing the exact original decoded bytes", async () => {
  const text = '\uFEFF{"content":["MTBLS1"]}';
  vi.mocked(metabolightsFetch).mockResolvedValue(new Response(text, { headers: { "content-type": "application/json" } }));
  expect(await readMetabolights("/studies")).toMatchObject({ text, data: { content: ["MTBLS1"] }, source: { decoded_utf8_sha256: await sha256(text) } });
});
