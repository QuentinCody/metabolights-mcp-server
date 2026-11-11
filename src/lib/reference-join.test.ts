import { afterEach, expect, it, vi } from "vitest";
import { createMetabolightsApiFetch } from "./api-adapter";
import { parseMaf } from "./maf";
import { sha256 } from "./read";

afterEach(() => vi.unstubAllGlobals());
const path = "/evidence/studies/MTBLS1/identifiers";
const file = "m_MTBLS1.tsv";
const text = "database_identifier\tmetabolite_identification\treliability\tsample\tsample\nCHEBI:27389\tfeature A\tMSI:2\t001.20\t\nPubChem:2244\tfeature B\tMSI:3\t0\t2\nchembl25\tfeature C\tMSI:2\t4\t5\nCID:2244\tfeature D\tMSI:1\t6\t7\nHMDB0000001\tfeature E\tMSI:2\t8\t9\n2244\tUnknown1\t\t\t\n\tUnknown2\t\t\t\nCHEBI:2\tfeature F\tMSI:3\t0\t1";

function upstream(maf = text) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/files")) return Response.json({ study: [{ file, type: "metadata_maf" }] });
    if (url.pathname.endsWith("/download")) return new Response(maf);
    if (url.pathname.endsWith("/compound/27389/")) return Response.json({ chebi_accession: "CHEBI:27389", stars: 2 });
    if (url.pathname.endsWith("/compound/2/")) return Response.json({ detail: "missing fixture" }, { status: 404 });
    if (url.pathname.endsWith("/molecule/CHEMBL25.json")) return Response.json({ molecule_chembl_id: "CHEMBL25", unknown_native: ["retained"] });
    if (url.pathname.endsWith("/compound/cid/2244/JSON")) return Response.json({ PC_Compounds: [{ id: { id: { cid: 2244 } }, props: [] }] });
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}

it("links qualified references without collapsing MAF rows, confidence, duplicate sample columns or numeric text", async () => {
  const fetcher = upstream();
  const result = await createMetabolightsApiFetch()({ method: "GET", path, params: { file } });
  expect(result).toMatchObject({ status: 200, data: {
    raw_maf: text, rows: parseMaf(text).rows, columns: parseMaf(text).columns, complete: false,
    source: { decoded_utf8_sha256: await sha256(text) }, identifier_resolution: {
      total_distinct_identifiers: 5, next_offset: null, matched_identifiers: 3, unresolved_identifiers: 2, complete: false,
      results: [
        { namespace: "ChEBI", requested_accession: "CHEBI:27389", row_numbers: [1], reference_match: true, identity_equivalence_asserted: false },
        { namespace: "PubChem", requested_accession: "CID:2244", row_numbers: [2, 4], reference_match: true, native: { PC_Compounds: [{ id: { id: { cid: 2244 } } }] } },
        { namespace: "ChEMBL", requested_accession: "CHEMBL25", row_numbers: [3], reference_match: true, native: { unknown_native: ["retained"] } },
        { namespace: "HMDB", requested_accession: "HMDB0000001", row_numbers: [5], resolution: "access_unavailable", reference_match: false, http_status: null },
        { namespace: "ChEBI", requested_accession: "CHEBI:2", row_numbers: [8], resolution: "not_found", native: { detail: "missing fixture" } },
      ],
    },
  } });
  expect(fetcher).toHaveBeenCalledTimes(6);
  expect(fetcher.mock.calls.every(([input]) => ["www.ebi.ac.uk", "pubchem.ncbi.nlm.nih.gov"].includes(new URL(String(input)).hostname))).toBe(true);
});

it("paginates distinct references in first-appearance order with the same MAF hash", async () => {
  const fetcher = upstream(); const api = createMetabolightsApiFetch();
  expect(await api({ method: "GET", path, params: { file, limit: 2 } })).toMatchObject({ data: { identifier_resolution: { next_offset: 2, results: [{ requested_accession: "CHEBI:27389" }, { requested_accession: "CID:2244" }] } } });
  expect(await api({ method: "GET", path, params: { file, offset: 2, limit: 2, expected_file_sha256: await sha256(text) } })).toMatchObject({ data: { identifier_resolution: { next_offset: 4, results: [{ requested_accession: "CHEMBL25" }, { requested_accession: "HMDB0000001" }] } } });
  expect(fetcher).toHaveBeenCalledTimes(7);
});

it("stops continuation on file drift before contacting compound providers", async () => {
  const fetcher = upstream();
  await expect(createMetabolightsApiFetch()({ method: "GET", path, params: { file, offset: 2, expected_file_sha256: "a".repeat(64) } })).rejects.toMatchObject({ status: 409 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([{ offset: 1 }, { offset: -1 }, { limit: 11 }, { query: "aspirin" }])("rejects unsafe lookup parameters before IO: %j", async params => {
  const fetcher = upstream();
  await expect(createMetabolightsApiFetch()({ method: "GET", path, params: { file, ...params } })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("leaves unsupported, bare and mixed identifiers in the study without querying them", async () => {
  const maf = "database_identifier\tmetabolite_identification\n2244\taspirin\nCHEBI:1|CID:2244\tx\nhttps://example.org/id\tx\n\tunknown";
  const fetcher = upstream(maf);
  expect(await createMetabolightsApiFetch()({ method: "GET", path, params: { file } })).toMatchObject({ data: { raw_maf: maf, rows: parseMaf(maf).rows, identifier_resolution: { total_distinct_identifiers: 0, results: [], complete: false } } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
