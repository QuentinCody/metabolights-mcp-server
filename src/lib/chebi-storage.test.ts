import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { ChunkingEngine, type SqlExec } from "@bio-mcp/shared/staging/chunking";
import { storeEvidencePayload } from "@bio-mcp/shared/staging/evidence-payload";
import { canonicalJson, sha256Hex } from "@bio-mcp/shared";
import { createMetabolightsApiFetch } from "./api-adapter";

afterEach(() => vi.unstubAllGlobals());

it.each(["chebi", "identifiers"])("recovers the large %s response with native evidence, feature rows and hashes from SQLite chunks", async route => {
  const maf = "database_identifier\tmetabolite_identification\treliability\tsample\nCHEBI:27389\tfeature A\tMSI:2\t001.20\nCHEBI:27389\tfeature B\tMSI:3\t0\nCID:2244\tfeature C\tMSI:2\t4\nCHEMBL25\tfeature D\tMSI:3\t5";
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const path = new URL(input).pathname;
    if (path.endsWith("/files")) return Response.json({ study: [{ file: "m_MTBLS1.tsv" }] });
    if (path.endsWith("/download")) return new Response(maf);
    if (path.endsWith("/compound/27389/")) return Response.json({ chebi_accession: "CHEBI:27389", annotation: "🧬α".repeat(20000), unknown_native: { retained: true } });
    if (path.endsWith("/compound/cid/2244/JSON")) return Response.json({ PC_Compounds: [{ id: { id: { cid: 2244 } }, props: [{ fixture: "native PubChem field" }] }] });
    if (path.endsWith("/molecule/CHEMBL25.json")) return Response.json({ molecule_chembl_id: "CHEMBL25", unknown_native: "native ChEMBL field" });
    throw new Error(`Unexpected URL: ${input}`);
  }));
  const result = await createMetabolightsApiFetch()({ method: "GET", path: `/evidence/studies/MTBLS1/${route}`, params: { file: "m_MTBLS1.tsv" } });
  const database = new DatabaseSync(":memory:");
  const sql: SqlExec = { exec(query, ...bindings) {
    const statement = database.prepare(query);
    const rows = statement.columns().length ? statement.all(...bindings as SQLInputValue[]) : (statement.run(...bindings as SQLInputValue[]), []);
    return { toArray: () => rows, one: () => rows[0] };
  } };
  try {
    const chunking = new ChunkingEngine();
    const handle = await storeEvidencePayload(sql, chunking, result.data);
    const stored = sql.exec("SELECT root_json, payload_hash FROM evidence_payloads WHERE id = 1").one!()!;
    expect(String(stored.root_json)).toMatch(/^__CHUNKED__:/);
    const recovered = await chunking.smartJsonParse(String(stored.root_json), sql);
    // Compare canonical hashes first to avoid dumping the large fixture on failure.
    expect(await sha256Hex(canonicalJson(recovered))).toBe(await sha256Hex(canonicalJson(result.data)));
    expect(recovered).toMatchObject({ raw_maf: maf, identifier_resolution: { matched_identifiers: route === "chebi" ? 1 : 3, results: expect.arrayContaining([expect.objectContaining({ row_numbers: [1, 2], identity_equivalence_asserted: false, reference_match: true })]) } });
    expect(stored.payload_hash).toBe(`sha256:${await sha256Hex(canonicalJson(recovered))}`);
    expect(handle.payloadHash).toBe(stored.payload_hash);
  } finally { database.close(); }
});
