import { afterEach, expect, it, vi } from "vitest";
import { readPublicReference } from "./reference-record";
import { sha256 } from "./read";

afterEach(() => vi.unstubAllGlobals());

it.each([
  ["ChEMBL", "CHEMBL25", "https://www.ebi.ac.uk/chembl/api/data/molecule/CHEMBL25.json", { molecule_chembl_id: "CHEMBL25", molecule_hierarchy: { parent_chembl_id: "CHEMBL25" }, unknown_field: "001.20" }],
  ["PubChem", "CID:2244", "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/2244/JSON", { PC_Compounds: [{ id: { id: { cid: 2244 } }, props: [{ urn: { label: "fixture" }, value: { sval: "001.20" } }] }] }],
] as const)("retains the full %s native record and hashes the exact UTF-8 text", async (namespace, accession, url, native) => {
  const text = `\uFEFF${JSON.stringify(native, null, 2)}\n`;
  const fetcher = vi.fn().mockResolvedValue(new Response(text, { headers: { etag: '"fixture"', "last-modified": "Fri, 02 Oct 2026 12:00:00 GMT" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await readPublicReference(namespace, accession, Date.now() + 15000)).toMatchObject({
    http_status: 200, reference_match: true, returned_accession: accession, resolution: "requested_accession_returned", native,
    source: { url, provider: namespace, decoded_utf8_sha256: await sha256(text), etag: '"fixture"', last_modified: "Fri, 02 Oct 2026 12:00:00 GMT", release_pinned: false },
  });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ redirect: "manual", headers: { Accept: "application/json" } }));
});

it.each([
  ["ChEMBL", "CHEMBL25", { molecule_chembl_id: "CHEMBL26" }, "different_accession_returned"],
  ["ChEMBL", "CHEMBL25", { molecule_hierarchy: { parent_chembl_id: "CHEMBL25" } }, "unrecognized_record"],
  ["PubChem", "CID:2244", { PC_Compounds: [{ id: { id: { cid: 2245 } } }] }, "different_accession_returned"],
  ["PubChem", "CID:2244", { PC_Compounds: [{ id: { id: { cid: "2244" } } }] }, "unrecognized_record"],
  ["PubChem", "CID:2244", { PC_Compounds: [{ id: { id: { cid: 9007199254740992 } } }] }, "unrecognized_record"],
  ["PubChem", "CID:2244", { PC_Compounds: [{ id: { id: { cid: 2244 } } }, { id: { id: { cid: 2245 } } }] }, "unrecognized_record"],
  ["PubChem", "CID:2244", { PC_Compounds: [] }, "unrecognized_record"],
  ["PubChem", "CID:2244", { Fault: { Code: "PUGREST.NotFound", Message: "fixture" } }, "unrecognized_record"],
] as const)("keeps unverified %s records unresolved (%j)", async (namespace, accession, native, resolution) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(native)));
  expect(await readPublicReference(namespace, accession, Date.now() + 15000)).toMatchObject({ native, resolution, reference_match: false });
});

it.each([429, 503])("preserves PubChem HTTP %s and rate-limit evidence without retrying", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response("<html>Try later</html>", { status, headers: { "retry-after": "30", "x-throttling-control": "Request Count status: Red (100%)" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await readPublicReference("PubChem", "CID:2244", Date.now() + 15000)).toMatchObject({
    http_status: status, native: "<html>Try later</html>", resolution: "upstream_error", reference_match: false,
    source: { retry_after: "30", request_throttling: "Request Count status: Red (100%)" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("keeps an asynchronous PubChem response pending even if it contains the requested ID", async () => {
  const native = { PC_Compounds: [{ id: { id: { cid: 2244 } } }] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(native, { status: 202 })));
  expect(await readPublicReference("PubChem", "CID:2244", Date.now() + 15000)).toMatchObject({ native, http_status: 202, resolution: "pending", reference_match: false });
});

it.each([[302, "redirect_not_followed"], [503, "upstream_error"]] as const)("retains empty HTTP %s responses and never follows redirects", async (status, resolution) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status, headers: { location: "https://unrelated.example/" } }));
  vi.stubGlobal("fetch", fetcher);
  expect(await readPublicReference("ChEMBL", "CHEMBL25", Date.now() + 15000)).toMatchObject({ http_status: status, native: "", resolution, reference_match: false, source: { decoded_utf8_sha256: await sha256(""), location: "https://unrelated.example/" } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([
  ["ChEMBL", "CHEMBL25/../../other"], ["ChEMBL", "CHEMBL0"], ["PubChem", "CID:1,2"],
  ["PubChem", "CID:9007199254740992"], ["PubChem", "PubChem:2244"], ["PubChem", "CID:0"],
  ["HMDB", "HMDB0000001"], ["https://unrelated.example", "CID:2244"],
])("rejects invalid or unsupported %s accessions before any request: %s", async (namespace, accession) => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(readPublicReference(namespace, accession, Date.now() + 15000)).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
});
