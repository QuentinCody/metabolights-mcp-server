import { expect, it, vi } from "vitest";
import { metabolightsCatalog } from "./catalog";

it("exposes the public evidence workflow without claiming standalone samples or metabolites routes", () => {
  expect(metabolightsCatalog.endpointCount).toBe(metabolightsCatalog.endpoints.length);
  for (const path of ["/evidence/studies/{accession}/manifest", "/evidence/studies/{accession}/maf", "/evidence/studies/{accession}/chebi", "/evidence/studies/{accession}/identifiers", "/studies/{accession}/download"]) {
    expect(metabolightsCatalog.endpoints.some(endpoint => endpoint.path === path && endpoint.method === "GET")).toBe(true);
  }
  expect(metabolightsCatalog.endpoints.some(endpoint => /\/(samples|metabolites)$/.test(endpoint.path))).toBe(false);
});

it("runs the manifest discovery recipe without inventing a filename", async () => {
  const workflows = metabolightsCatalog.workflows ?? []; expect(workflows).toHaveLength(3);
  const get = vi.fn().mockResolvedValue({ native: { study: [] } });
  const run = new Function("api", `return (async () => { ${workflows[0].code} })()`);
  expect(await run({ get })).toEqual({ native: { study: [] } });
  expect(get).toHaveBeenCalledWith("/evidence/studies/MTBLS1/manifest", { include_raw_data: false });
});

it.each([[1, "chebi"], [2, "identifiers"]] as const)("runs recipe %s after unique manifest selection and forwards its digest", async (index, route) => {
  const workflow = metabolightsCatalog.workflows![index];
  const run = new Function("api", `return (async () => { ${workflow.code} })()`);
  const digest = "a".repeat(64);
  const result = { __staged: true, data_access_id: "joined-fixture", complete: false };
  const get = vi.fn().mockResolvedValueOnce({ files: [{ file: "m_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv" }], source: { decoded_utf8_sha256: digest } }).mockResolvedValueOnce(result);
  expect(await run({ get })).toEqual(result);
  expect(get).toHaveBeenLastCalledWith(`/evidence/studies/MTBLS1/${route}`, { file: "m_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv", expected_manifest_sha256: digest, limit: 5 });
});

it.each([{ __staged: true, data_access_id: "manifest" }, { __api_error: true, status: 503 }, { files: [] }, { files: [{ file: "m_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv" }, { file: "m_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv" }] }])("does not resolve references from an unreadable or ambiguous manifest: %j", async manifest => {
  for (const index of [1, 2]) {
    const run = new Function("api", `return (async () => { ${metabolightsCatalog.workflows![index].code} })()`);
    const get = vi.fn().mockResolvedValue(manifest);
    const result = await run({ get });
    expect(get).toHaveBeenCalledTimes(1);
    if ("files" in manifest) expect(result).toMatchObject({ manifest, selection_required: expect.any(String) });
    else expect(result).toEqual(manifest);
  }
});
