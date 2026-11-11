import { afterEach, expect, it, vi } from "vitest";
import { createMetabolightsApiFetch } from "./api-adapter";
import { parseMaf } from "./maf";
import { chebiPage, resolveChebiReferences } from "./chebi-join";
import { sha256 } from "./read";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const path = "/evidence/studies/MTBLS1/chebi";
const file = "m_MTBLS1.tsv";
const text = "database_identifier\tmetabolite_identification\treliability\tsample\tsample\nCHEBI:27389\tfeature A\tMSI:2\t001.20\t\nchebi:27389\tfeature B\tMSI:3\t0\t2\nCHEBI:2\tUnknown1\t\t\t\nCID:123\tfeature C\tMSI:2\t4\t5\n\tUnknown2\t\t\t\nCHEBI:3\tfeature D\tMSI:2\t6\t7";

function upstream(maf = text) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/files")) return Response.json({ study: [{ file, type: "metadata_maf" }] });
    if (url.pathname.endsWith("/download")) return new Response(maf);
    const id = /\/compound\/(\d+)\/$/.exec(url.pathname)?.[1];
    if (id === "2") return Response.json({ detail: "missing fixture" }, { status: 404 });
    if (id) return Response.json({ chebi_accession: `CHEBI:${id}`, name: "database fixture", stars: 2 });
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}

it("joins exact reported references without collapsing repeated features or upgrading confidence", async () => {
  const fetcher = upstream();
  const result = await createMetabolightsApiFetch()({ method: "GET", path, params: { file, limit: 2 } });
  expect(result).toMatchObject({ status: 200, data: {
    raw_maf: text, complete: false, source: { decoded_utf8_sha256: await sha256(text) },
    rows: parseMaf(text).rows,
    identifier_resolution: { total_distinct_identifiers: 3, offset: 0, next_offset: 2, matched_identifiers: 1, unresolved_identifiers: 1, results: [
      { requested_accession: "CHEBI:27389", row_numbers: [1, 2], identity_equivalence_asserted: false, reference_match: true, native: { stars: 2 } },
      { requested_accession: "CHEBI:2", row_numbers: [3], resolution: "not_found", native: { detail: "missing fixture" } },
    ] },
  } });
  expect(fetcher).toHaveBeenCalledTimes(4); // manifest + MAF + two distinct ChEBI IDs
  expect(fetcher.mock.calls.every(([input]) => new URL(String(input)).hostname === "www.ebi.ac.uk")).toBe(true);
});

it("continues against a content-pinned MAF with deterministic first-appearance order", async () => {
  const fetcher = upstream();
  const result = await createMetabolightsApiFetch()({ method: "GET", path, params: { file, offset: 2, limit: 2, expected_file_sha256: await sha256(text) } });
  expect(result).toMatchObject({ data: { identifier_resolution: { offset: 2, next_offset: null, total_distinct_identifiers: 3, results: [{ requested_accession: "CHEBI:3", row_numbers: [6] }] } } });
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("rejects MAF drift before any external identifier lookup", async () => {
  const fetcher = upstream();
  await expect(createMetabolightsApiFetch()({ method: "GET", path, params: { file, offset: 2, expected_file_sha256: "a".repeat(64) } })).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([{ offset: 1 }, { offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 11 }, { limit: "2" }, { name: "glucose" }])("rejects unpinned continuation and unsupported/bad request parameters before IO: %j", async params => {
  const fetcher = upstream();
  await expect(createMetabolightsApiFetch()({ method: "GET", path, params: { file, ...params } })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps missing, unqualified and other-namespace identifiers unqueried", async () => {
  const maf = "database_identifier\tmetabolite_identification\n27389\tname\nHMDB0000001\tname\nCID:123\tname\nCHEMBL1\tname\n\tunknown";
  const fetcher = upstream(maf);
  expect(await createMetabolightsApiFetch()({ method: "GET", path, params: { file } })).toMatchObject({ data: { raw_maf: maf, identifier_resolution: { total_distinct_identifiers: 0, results: [], next_offset: null, complete: false } } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("retains a per-reference transport failure alongside successful native records", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline fixture")).mockResolvedValueOnce(Response.json({ chebi_accession: "CHEBI:2" })));
  const maf = parseMaf("database_identifier\tmetabolite_identification\nCHEBI:1\ta\nCHEBI:2\tb");
  expect(await resolveChebiReferences(maf, chebiPage({}), Date.now() + 15000)).toMatchObject({ matched_identifiers: 1, unresolved_identifiers: 1, results: [
    { requested_accession: "CHEBI:1", resolution: "lookup_failed", error: { status: 502, message: "offline fixture" } },
    { requested_accession: "CHEBI:2", reference_match: true },
  ] });
});

it("limits concurrent requests and retains input order when responses finish out of order", async () => {
  vi.useFakeTimers(); let active = 0; let maximum = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const id = /\/compound\/(\d+)\/$/.exec(input)![1];
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, (7 - Number(id)) * 10));
    active--; return Response.json({ chebi_accession: `CHEBI:${id}` });
  }));
  const maf = parseMaf("database_identifier\tmetabolite_identification\n" + [1, 2, 3, 4, 5, 6].map(id => `CHEBI:${id}\tx`).join("\n"));
  const pending = resolveChebiReferences(maf, chebiPage({ limit: 10 }), Date.now() + 10000);
  await vi.advanceTimersByTimeAsync(1000);
  const result = await pending;
  expect(maximum).toBe(3);
  expect(result.results.map(entry => entry.requested_accession)).toEqual([1, 2, 3, 4, 5, 6].map(id => `CHEBI:${id}`));
});

it("rejects an offset past the actual distinct count", async () => {
  const fetcher = upstream();
  await expect(createMetabolightsApiFetch()({ method: "GET", path, params: { file, offset: 4, expected_file_sha256: await sha256(text) } })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
