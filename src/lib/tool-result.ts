import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";
import { buildCitation, mergeCompleteness, type Completeness } from "@bio-mcp/shared";
import { metabolightsCompleteness } from "./completeness";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
type Result = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean; [key: string]: unknown };
type DataEnv = { METABOLIGHTS_DATA_DO?: unknown };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const source = { id: "metabolights", name: "MetaboLights", url: "https://www.ebi.ac.uk/metabolights" };

async function cite(structured: Record<string, unknown>, toolName: string, query: unknown) {
  const meta = record(structured._meta) ? structured._meta : {};
  if (record(meta.citation)) return structured;
  const { _meta: _metadata, ...root } = structured;
  const code = toolName.endsWith("metabolights_execute") && record(query) && typeof query.code === "string" ? query.code : undefined;
  const citation = await buildCitation({ source, server: "metabolights", tool: toolName.replace(/^mcp_/, ""), query: code ?? query,
    queryScope: code === undefined ? "tool_arguments" : "tool_argument:code", result: root, resultScope: "structured_content:root_without_meta", retrievedAt: new Date().toISOString() });
  return { ...structured, _meta: { ...meta, citation } };
}

/** Bound the complete envelope, including composed programs and escaped text. */
export async function metabolightsResponse(work: () => Promise<Result>, env: DataEnv, toolName: string, extra: unknown, query?: unknown): Promise<Result> {
  try {
    const original = await work();
    let structured = original.structuredContent ?? { success: original.isError !== true };
    const meta = record(structured._meta) ? structured._meta : {};
    const completeness: Completeness | undefined = record(meta.completeness) && typeof meta.completeness.complete === "boolean"
      ? { ...meta.completeness, complete: meta.completeness.complete }
      : toolName.endsWith("metabolights_execute") ? metabolightsCompleteness(structured.data) : undefined;
    if (completeness) structured = { ...structured, _meta: { ...meta, completeness } };
    const apiError = record(structured.data) && structured.data.__api_error === true;
    const failed = original.isError === true || structured.success === false || apiError || Boolean(structured.program_error) || structured.disposition === "partial";
    const result = { ...original, structuredContent: await cite(failed ? { ...structured, success: false } : structured, toolName, query), ...(failed ? { isError: true } : {}) };
    if (!shouldStage(bytes(result))) return result;
    return await stageResponse(env, result, toolName, extra, query, completeness, failed);
  } catch {
    const data = { success: false, error: { code: "RESPONSE_ERROR", message: "MetaboLights response could not be returned." } };
    const citation = await buildCitation({ source, server: "metabolights", tool: toolName.replace(/^mcp_/, ""), query, queryScope: "tool_arguments",
      retrievedAt: new Date().toISOString(), result: data, resultScope: "structured_content:root_without_meta" });
    return { content: [{ type: "text", text: data.error.message }], structuredContent: { ...data, _meta: { citation } }, isError: true };
  }
}

async function stageResponse(env: DataEnv, result: Result, toolName: string, extra: unknown, query: unknown, completeness: Completeness | undefined, failed: unknown) : Promise<Result> {
  if (!env.METABOLIGHTS_DATA_DO) throw new Error("Missing staging storage");
  const staged = await stageToDoAndRespond(result, env.METABOLIGHTS_DATA_DO as Parameters<typeof stageToDoAndRespond>[1], "metabolights", undefined,
    { toolName, serverName: "metabolights" }, "metabolights", extra as Parameters<typeof stageToDoAndRespond>[6]);
  const citation = await buildCitation({
    source, server: "metabolights", tool: toolName.replace(/^mcp_/, ""), query, queryScope: "tool_arguments",
    retrievedAt: new Date().toISOString(), result, resultScope: "staged:full_result", dataAccessId: staged.dataAccessId
  });
  const combined = mergeCompleteness(completeness, staged._staging.completeness);
  const structuredContent = {
    success: !failed, staged: true, data: undefined, data_access_id: staged.dataAccessId,
    _staging: { ...staged._staging, ...(combined ? { completeness: combined } : {}) }, _meta: { citation, ...(combined ? { completeness: combined } : {}) }
  };
  if (bytes(structuredContent) > 100000) throw new Error("Staging metadata exceeds transport limit");
  return { content: [{ type: "text", text: "Response staged. Use metabolights_query_data; payloads retains the complete original response." }], structuredContent, ...(failed ? { isError: true } : {}) };
}
