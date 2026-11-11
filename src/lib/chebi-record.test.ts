import { afterEach, expect, it, vi } from "vitest";
import { readChebiRecord } from "./chebi-record";
import { sha256 } from "./read";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("preserves the native record and byte-derived source hash when the requested accession returns", async () => {
  const native = { id: 27389, chebi_accession: "CHEBI:27389", stars: 3, name: "fixture", chemical_data: { mass: "00103.12" }, default_structure: null };
  const text = JSON.stringify(native);
  const fetcher = vi.fn().mockResolvedValue(new Response(text, { headers: { etag: '"fixture"' } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await readChebiRecord("CHEBI:27389", Date.now() + 30000)).toMatchObject({
    resolution: "requested_accession_returned", reference_match: true, returned_accession: "CHEBI:27389", native,
    source: { url: "https://www.ebi.ac.uk/chebi/backend/api/public/compound/27389/", decoded_utf8_sha256: await sha256(text), etag: '"fixture"', release_pinned: false },
  });
  expect(fetcher).toHaveBeenCalledWith("https://www.ebi.ac.uk/chebi/backend/api/public/compound/27389/", expect.objectContaining({ redirect: "manual", headers: { Accept: "application/json" } }));
});

it.each([
  [{ chebi_accession: "CHEBI:2", id: 2 }, 200, "different_accession_returned"],
  [{ name: "same reported name" }, 200, "unrecognized_record"],
  [[{ chebi_accession: "CHEBI:1" }], 200, "unrecognized_record"],
  [{ detail: "No compound" }, 404, "not_found"],
  [{ detail: "Retry later" }, 429, "upstream_error"],
  [{ chebi_accession: "CHEBI:1" }, 500, "upstream_error"],
  [{ detail: "moved" }, 302, "redirect_not_followed"],
] as const)("retains unresolved native evidence: %j HTTP %s", async (native, status, resolution) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(native, { status, headers: { location: "https://other.example/" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await readChebiRecord("CHEBI:1", Date.now() + 30000)).toMatchObject({ native, http_status: status, resolution, reference_match: false });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps malformed JSON and non-JSON provider failures for inspection", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"broken"')).mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await readChebiRecord("CHEBI:1", Date.now() + 30000)).toMatchObject({ native: '{"broken"', resolution: "unrecognized_record", reference_match: false });
  expect(await readChebiRecord("CHEBI:1", Date.now() + 30000)).toMatchObject({ native: "unavailable", http_status: 503, resolution: "upstream_error" });
});

it.each(["CHEBI:1/../../other", "1", "CHEBI:0", `CHEBI:${"1".repeat(101)}`])("rejects unsafe or oversized accessions before fetching: %s", async accession => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readChebiRecord(accession, Date.now() + 30000)).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds actual UTF-8 bytes even with a misleading content length", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("α".repeat(600000), { headers: { "content-length": "2" } })));
  await expect(readChebiRecord("CHEBI:1", Date.now() + 30000)).rejects.toMatchObject({ status: 413 });
});

it("rejects an advertised oversized body and invalid UTF-8", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("x", { headers: { "content-length": "1048577" } })).mockResolvedValueOnce(new Response(new Uint8Array([0xff]))));
  await expect(readChebiRecord("CHEBI:1", Date.now() + 30000)).rejects.toMatchObject({ status: 413 });
  await expect(readChebiRecord("CHEBI:1", Date.now() + 30000)).rejects.toThrow();
});

it("does not start a request after the shared deadline", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readChebiRecord("CHEBI:1", Date.now() - 1)).rejects.toMatchObject({ status: 504 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds a stalled header request even when fetch ignores abort", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", fetcher);
  const assertion = expect(readChebiRecord("CHEBI:1", Date.now() + 2000)).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(2001); await assertion;
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});

it("bounds a stalled body without awaiting an unresponsive cancellation", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
  const assertion = expect(readChebiRecord("CHEBI:1", Date.now() + 30000)).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(15001); await assertion;
  expect(cancel).toHaveBeenCalled();
});
