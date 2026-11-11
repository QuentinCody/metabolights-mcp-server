/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { MetabolightsDataDO } from "../do";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function createStore() {
  const database = new DatabaseSync(":memory:");
  let ready = Promise.resolve();
  const exec = (query: string, ...values: any[]) => {
    const rows = database.prepare(query).all(...values);
    const iterator = rows[Symbol.iterator]();
    return { toArray: () => rows, one: () => rows[0], next: () => iterator.next(), [Symbol.iterator]: () => iterator };
  };
  const transactionSync = <T>(run: () => T): T => {
    database.exec("BEGIN");
    try { const result = run(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const ctx = { blockConcurrencyWhile: (run: () => Promise<void>) => { ready = run(); return ready; }, storage: { sql: { exec }, transactionSync } };
  const instance = new MetabolightsDataDO(ctx as unknown as DurableObjectState, {} as Cloudflare.Env);
  return { database, instance, ready };
}

function fixture() {
  // Exercise generated API helpers and user code; replace only the platform isolate.
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockImplementation(async (code, functions) => {
    const staged: Array<Record<string, unknown>> = [];
    try {
      const run = new Function("codemode", "__stagedResults", "console", `return (${code})();`);
      const result = await run(functions, staged, { warn() {}, log() {} });
      return { result: JSON.parse(JSON.stringify(result)), __stagedResults: staged };
    } catch (error) { return { error: String((error as Error).message), __stagedResults: staged }; }
  });
  const stores = new Map<string, ReturnType<typeof createStore>>();
  const namespace = { idFromName: (name: string) => name, get: (id: string) => ({ fetch: async (request: Request) => {
    let store = stores.get(id);
    if (!store) { store = createStore(); stores.set(id, store); }
    await store.ready;
    return store.instance.fetch(request);
  } }) };
  const env = { METABOLIGHTS_DATA_DO: namespace, CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, env); registerQueryData(server, env); registerGetSchema(server, env);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<any> }> })._registeredTools;
  return { tools, close: () => { for (const store of stores.values()) store.database.close(); } };
}

async function recover(f: ReturnType<typeof fixture>, id: string, prefix: string) {
  const rows = async (sql: string) => {
    const output = await f.tools[`${prefix}metabolights_query_data`].handler({ data_access_id: id, sql }, {});
    expect(output.isError, JSON.stringify(output)).not.toBe(true);
    expect(output.structuredContent.staged).not.toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(30720);
    return output.structuredContent.data.rows;
  };
  const text = async (table: string, column: string, where: string) => {
    const [{ n }] = await rows(`SELECT length(${column}) AS n FROM ${table} WHERE ${where}`);
    let result = "";
    for (let start = 1; start <= n; start += 1000) {
      const [row] = await rows(`SELECT substr(${column}, ${start}, 1000) AS part FROM ${table} WHERE ${where}`);
      result += row.part;
    }
    return result;
  };
  let raw = await text("payloads", "root_json", "id = 1");
  if (raw.startsWith("__CHUNKED__:")) {
    const chunk = raw.slice("__CHUNKED__:".length);
    expect(chunk).toMatch(/^chunk_[a-f0-9]{32}$/);
    const parts = await rows(`SELECT chunk_index FROM content_chunks WHERE content_id = '${chunk}' ORDER BY chunk_index`);
    raw = "";
    for (const part of parts) raw += await text("content_chunks", "chunk_data", `content_id = '${chunk}' AND chunk_index = ${part.chunk_index}`);
  }
  const decoded = JSON.parse(raw);
  return typeof decoded === "string" ? JSON.parse(decoded) : decoded;
}

it("recovers every ordered MAF cell, repeated reference and native record through real SQLite and both aliases", async () => {
  const f = fixture();
  const columns = ["database_identifier", "metabolite_identification", "reliability", "sample", "sample"];
  const cells = Array.from({ length: 60 }, (_, i) => [i % 3 ? "CHEBI:15365" : "CID:2244", "α🧬 | ".repeat(140), String(i % 4), "001.20", "0"]);
  const raw = [columns, ...cells].map(row => row.join("\t")).join("\n");
  const native = { chebi_accession: "CHEBI:15365", extra: { evidence: "native α🧬".repeat(5000) } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/files") ? Response.json({ study: [{ file: "m_fixture.tsv" }] })
    : url.includes("/download") ? new Response(raw) : url.includes("/compound/cid/") ? Response.json({ PC_Compounds: [{ id: { id: { cid: 2244 } } }] }) : Response.json(native)));
  try { for (const prefix of ["", "mcp_"]) {
    const args = { code: "return await api.get('/evidence/studies/MTBLS1/identifiers',{file:'m_fixture.tsv',limit:2});" };
    const result = await f.tools[prefix + "metabolights_execute"].handler(args, {});
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.structuredContent._meta.completeness).toMatchObject({ complete: false, returned: 60 });
    const id = result.structuredContent.data.data_access_id;
    const recovered = await recover(f, id, prefix);
    expect(recovered.raw_maf).toBe(raw); expect(recovered.columns).toEqual(columns);
    expect(recovered.rows.map((r: any) => r.cells)).toEqual(cells);
    expect(recovered.identifier_resolution.results[1]).toMatchObject({ native, reference_match: true, identity_equivalence_asserted: false, row_numbers: cells.flatMap((r, i) => r[0].startsWith("CHEBI") ? [i + 1] : []) });
    const proof = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args, materialized: { value: recovered } });
    expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
    const query = { data_access_id: id, sql: "SELECT row_number, cells FROM maf_rows ORDER BY row_number", limit: 60 };
    const large = await f.tools[prefix + "metabolights_query_data"].handler(query, {});
    expect(large.isError, JSON.stringify(large)).not.toBe(true);
    const full = await recover(f, large.structuredContent.data_access_id, prefix);
    expect(full.structuredContent.data.rows.map((r: any) => JSON.parse(r.cells))).toEqual(cells);
    const columnRows = await f.tools[prefix + "metabolights_query_data"].handler({ data_access_id: id, sql: "SELECT column_index,name FROM maf_columns ORDER BY column_index" }, {});
    expect(columnRows.structuredContent.data.rows).toEqual(columns.map((name, column_index) => ({ column_index, name })));
    const referenceRows = await f.tools[prefix + "metabolights_query_data"].handler({ data_access_id: id, sql: "SELECT requested_accession,row_numbers FROM identifier_references ORDER BY _rowid" }, {});
    expect(referenceRows.structuredContent.data.rows.map((r: any) => ({ id: r.requested_accession, rows: JSON.parse(r.row_numbers) })))
      .toEqual(recovered.identifier_resolution.results.map((r: any) => ({ id: r.requested_accession, rows: r.row_numbers })));
    const schemaArgs = { data_access_id: id };
    const schema = await f.tools[prefix + "metabolights_get_schema"].handler(schemaArgs, {});
    const schemaPayload = schema.structuredContent.staged ? await recover(f, schema.structuredContent.data_access_id, prefix) : undefined;
    expect((await verifyCitationEnvelope({ citation: schema.structuredContent._meta.citation, structuredContent: schema.structuredContent, toolArguments: schemaArgs,
      ...(schemaPayload ? { materialized: { value: schemaPayload } } : {}) })).verification).toMatchObject({ query: "verified", result: "verified" });
  } } finally { f.close(); }
});

it("preserves the native accession list without inferring paging or archive completeness", async () => {
  const f = fixture(); const native = { content: Array.from({ length: 3500 }, (_, i) => `MTBLS${i + 1}`) };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try { for (const prefix of ["", "mcp_"]) {
    const result = await f.tools[prefix + "metabolights_execute"].handler({ code: "return {listing:await api.get('/studies',{page:1,size:2})};" }, {});
    expect(result.structuredContent._meta.completeness).toMatchObject({ complete: false, returned: 3500 });
    const id = result.structuredContent.data.listing.data_access_id;
    expect(await recover(f, id, prefix)).toEqual(native);
    const count = await f.tools[prefix + "metabolights_query_data"].handler({ data_access_id: id, sql: "SELECT count(*) AS n FROM studies" }, {});
    expect(count.structuredContent.data.rows).toEqual([{ n: 3500 }]);
  } } finally { f.close(); }
});

it("preserves full native failures and stages composed Unicode output through both aliases", async () => {
  const f = fixture(); const body = "native failure α🧬".repeat(6000);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 400 })));
  try { for (const prefix of ["", "mcp_"]) {
    const result = await f.tools[prefix + "metabolights_execute"].handler({ code: "return await api.get('/studies/MTBLS1');" }, {});
    expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, data: { status: 400 } } });
    expect(await recover(f, result.structuredContent.data.data.data_access_id, prefix)).toBe(body);
    const args = { code: "return {text:'α🧬'.repeat(8000)};" };
    const large = await f.tools[prefix + "metabolights_execute"].handler(args, {});
    expect(new TextEncoder().encode(JSON.stringify(large)).byteLength).toBeLessThan(30720);
    const full = await recover(f, large.structuredContent.data_access_id, prefix);
    expect(full.structuredContent.data.text).toBe("α🧬".repeat(8000));
    expect((await verifyCitationEnvelope({ citation: large.structuredContent._meta.citation, structuredContent: large.structuredContent, toolArguments: args, materialized: { value: full } })).verification).toMatchObject({ query: "verified", result: "verified" });
  } } finally { f.close(); }
});
