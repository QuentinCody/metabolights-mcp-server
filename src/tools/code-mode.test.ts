import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import type { ExecuteToolOptions } from "@bio-mcp/shared/codemode/execute-tool";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { metabolightsFetch } from "../lib/http";

const captured = vi.hoisted(() => ({ options: [] as ExecuteToolOptions[] }));
vi.mock("../lib/http", () => ({ metabolightsFetch: vi.fn() }));
vi.mock("@bio-mcp/shared/codemode/execute-tool", async importOriginal => {
  const actual = await importOriginal<typeof import("@bio-mcp/shared/codemode/execute-tool")>();
  return { ...actual, createExecuteTool: (options: ExecuteToolOptions) => { captured.options.push(options); return actual.createExecuteTool(options); } };
});
afterEach(() => { captured.options.length = 0; vi.resetAllMocks(); vi.unstubAllGlobals(); });

function registered() {
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: invalid-code tests do not execute the Worker loader.
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  // SAFETY: inspect SDK registry to invoke actual registered handlers.
  return (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
}

it("registers eight aliases with both fields on success and failure", async () => {
  const tools = registered(); expect(Object.keys(tools)).toHaveLength(8);
  for (const prefix of ["", "mcp_"]) {
    expect(await tools[prefix + "metabolights_search"].handler({ query: "manifest", max_results: 5 }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    for (const [name, args] of [["metabolights_execute", { code: "" }], ["metabolights_query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["metabolights_get_schema", { data_access_id: "fixture" }]] as const) {
      expect(await tools[prefix + name].handler(args, {})).toMatchObject({ content: expect.any(Array), structuredContent: expect.any(Object), isError: true });
    }
  }
});

it.each([
  ["chebi", "CHEBI:27389", 200], ["chebi", "CHEBI:27389", 503],
  ["identifiers", "CHEMBL25", 200], ["identifiers", "CID:2244", 503],
] as const)("stages the %s response for %s with native HTTP %s", async (route, accession, status) => {
  registered(); const options = captured.options[0];
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      // SAFETY: the shared staging protocol supplies the data envelope.
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["evidence"], total_rows: 2 });
    }
    return Response.json({ success: true, schema: { tables: { evidence: { columns: [{ name: "raw_maf" }] } } } });
  } }) };
  const text = `database_identifier\tmetabolite_identification\treliability\tsample\n${accession}\tfeature\tMSI:2\t001.20`;
  const identity = accession.startsWith("CHEBI:") ? { chebi_accession: accession }
    : accession.startsWith("CHEMBL") ? { molecule_chembl_id: accession } : { Fault: { Code: "PUGREST.ServerBusy" } };
  const native = { ...identity, detail: "α".repeat(20000), unknown_native_field: ["preserve"] };
  vi.mocked(metabolightsFetch).mockResolvedValueOnce(Response.json({ study: [{ file: "m_MTBLS1.tsv" }] })).mockResolvedValueOnce(new Response(text));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(native, { status })));
  const proxy = createApiProxyTool({ apiFetch: options.apiFetch, catalog: options.catalog, doNamespace: namespace, stagingPrefix: "metabolights", maxInlineBytes: options.maxInlineBytes });
  const result = await proxy.handler({ method: "GET", path: `/evidence/studies/MTBLS1/${route}`, params: { file: "m_MTBLS1.tsv" } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, complete: false, data_access_id: expect.any(String), _staging: expect.any(Object) });
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual(expect.objectContaining({
    raw_maf: text, identifier_resolution: expect.objectContaining({ results: [expect.objectContaining({
      requested_accession: accession, row_numbers: [1], native, http_status: status,
      reference_match: status === 200, identity_equivalence_asserted: false,
      source: expect.objectContaining({ decoded_utf8_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    })] }),
  }));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});

it.each([false, true])("stages complete MAF or provider error evidence (failure=%s)", async failure => {
  registered(); const options = captured.options[0];
  expect(options).toMatchObject({ maxInlineBytes: 30 * 1024, stagingThreshold: 30 * 1024, timeout: 60000 });
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      // SAFETY: shared staging protocol sends this data envelope.
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["metadata"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: { metadata: { columns: [{ name: "raw_maf" }] } } } });
  } }) };
  const text = `database_identifier\tmetabolite_identification\treliability\tsample\nCHEBI:27389\t${"α".repeat(20000)}\tMSI:2\t001.20`;
  const listing = Response.json({ study: [{ file: "m_MTBLS1.tsv", type: "metadata_maf" }] });
  vi.mocked(metabolightsFetch).mockResolvedValueOnce(listing).mockResolvedValueOnce(new Response(text, { status: failure ? 502 : 200 }));
  const proxy = createApiProxyTool({ apiFetch: options.apiFetch, catalog: options.catalog, doNamespace: namespace, stagingPrefix: "metabolights", maxInlineBytes: options.maxInlineBytes });
  const result = await proxy.handler({ method: "GET", path: "/evidence/studies/MTBLS1/maf", params: { file: "m_MTBLS1.tsv" } }, { sql: () => [] });
  const plain = JSON.parse(JSON.stringify(result));
  if (failure) expect(plain).toMatchObject({ __api_error: true, incomplete: true, status: 502, data: { __staged: true } });
  else expect(plain).toMatchObject({ __staged: true, data_access_id: expect.any(String), _staging: expect.any(Object) });
  expect(JSON.stringify(stored)).toContain("MSI:2");
  expect(JSON.stringify(stored)).toContain("001.20");
  if (!failure) expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual(expect.objectContaining({ raw_maf: text, file: "m_MTBLS1.tsv", source: expect.objectContaining({ decoded_utf8_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});
