import { afterEach, expect, it, vi } from "vitest";
import { chebiPage, resolveMafReferences } from "./chebi-join";
import { parseMaf } from "./maf";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function input(ids: string[]) {
  return parseMaf("database_identifier\tmetabolite_identification\n" + ids.map(id => `${id}\tfixture`).join("\n"));
}

function timers() {
  vi.useFakeTimers();
  // Hash correctness uses real crypto in reference-record.test; these tests isolate pacing.
  vi.spyOn(crypto.subtle, "digest").mockResolvedValue(new ArrayBuffer(32));
}

it("spaces PubChem request starts even when prior timer callbacks run late", async () => {
  timers(); const starts: number[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    starts.push(Date.now()); const cid = Number(/\/cid\/(\d+)\//.exec(url)![1]);
    return Response.json({ PC_Compounds: [{ id: { id: { cid } } }] });
  }));
  const pending = resolveMafReferences(input(["CID:1", "CID:2", "CID:3", "CID:4"]), chebiPage({}), Date.now() + 15000);
  await vi.advanceTimersByTimeAsync(0);
  vi.setSystemTime(Date.now() + 2000);
  await vi.advanceTimersByTimeAsync(1500);
  const result = await pending;
  expect(result.matched_identifiers).toBe(4); expect(starts).toHaveLength(4);
  expect(starts.slice(1).every((start, index) => start - starts[index] >= 250)).toBe(true);
});

it.each([429, 503])("stops queued PubChem lookups after HTTP %s while retaining other providers", async status => {
  timers();
  const fetcher = vi.fn(async (url: string) => url.includes("/molecule/")
    ? Response.json({ molecule_chembl_id: "CHEMBL25" })
    : new Response(null, { status, headers: { "retry-after": "60" } }));
  vi.stubGlobal("fetch", fetcher);
  const pending = resolveMafReferences(input(["CID:1", "CID:2", "CID:3", "CHEMBL25"]), chebiPage({}), Date.now() + 15000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ matched_identifiers: 1, unresolved_identifiers: 3, complete: false, results: [
    { requested_accession: "CID:1", resolution: "upstream_error", http_status: status, native: "", source: { retry_after: "60" } },
    { requested_accession: "CID:2", resolution: "provider_backoff", http_status: null, reference_match: false },
    { requested_accession: "CID:3", resolution: "provider_backoff", http_status: null, reference_match: false },
    { requested_accession: "CHEMBL25", reference_match: true },
  ] });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not send a queued PubChem request when its start would exceed the shared deadline", async () => {
  timers(); const fetcher = vi.fn().mockImplementation(async () => Response.json({ PC_Compounds: [{ id: { id: { cid: 1 } } }] }));
  vi.stubGlobal("fetch", fetcher);
  const pending = resolveMafReferences(input(["CID:1", "CID:2", "CID:3"]), chebiPage({}), Date.now() + 200);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ matched_identifiers: 1, unresolved_identifiers: 2, results: [
    { requested_accession: "CID:1", reference_match: true },
    { requested_accession: "CID:2", resolution: "lookup_failed", error: { status: 504 } },
    { requested_accession: "CID:3", resolution: "lookup_failed", error: { status: 504 } },
  ] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("honors PubChem backoff when its HTTP 503 body never finishes", async () => {
  timers(); const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream(), { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  const pending = resolveMafReferences(input(["CID:1", "CID:2", "CID:3"]), chebiPage({}), Date.now() + 20000);
  await vi.advanceTimersByTimeAsync(15001);
  expect(await pending).toMatchObject({ matched_identifiers: 0, unresolved_identifiers: 3, results: [
    { requested_accession: "CID:1", resolution: "lookup_failed", error: { status: 504 } },
    { requested_accession: "CID:2", resolution: "provider_backoff", reference_match: false },
    { requested_accession: "CID:3", resolution: "provider_backoff", reference_match: false },
  ] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
