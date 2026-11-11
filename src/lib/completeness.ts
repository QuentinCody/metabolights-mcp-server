import type { Completeness } from "@bio-mcp/shared";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function observedCoverage(returned?: number): Completeness {
  return { complete: false, ...(returned === undefined ? {} : { returned }), truncation: { reason: "unknown",
    detail: "The returned observation is preserved; archive, study inventory and identifier coverage are not established by this read.",
    remedy: "Discover exact files and retain source hashes, listing scope, ordered MAF cells and per-reference outcomes. Native /studies ignores page/size in acceptance checks. Independent mutable reads are not an atomic snapshot; matching references do not validate experimental identity." } };
}

function direct(data: Record<string, unknown>): Completeness | undefined {
  if (typeof data.raw_maf === "string" && Array.isArray(data.rows)) return observedCoverage(data.rows.length);
  if (data.complete_inventory_verified === false && Array.isArray(data.files)) return observedCoverage(data.files.length);
  for (const key of ["content", "study", "protocols", "factors", "publications", "studyDesignDescriptors"])
    if (Array.isArray(data[key])) return observedCoverage(data[key].length);
  if (record(data.isaInvestigation)) return observedCoverage();
  if (record(data.data) && Array.isArray(data.data.assays)) return observedCoverage(data.data.assays.length);
  if (record(data.header) && record(data.data) && Array.isArray(data.data.rows)) return observedCoverage(data.data.rows.length);
  return undefined;
}

/** Keep limitations when native responses are returned directly or inside a program result. */
export function metabolightsCompleteness(value: unknown): Completeness | undefined {
  const observations: Completeness[] = [];
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    if (record(item) && item.__staged === true) {
      if (record(item._staging) && record(item._staging.completeness) && item._staging.completeness.complete === false)
        observations.push({ ...item._staging.completeness, complete: false });
      continue;
    }
    const coverage = record(item) ? direct(item) : undefined;
    if (coverage) observations.push(coverage);
    else pending.push(...Object.values(item));
  }
  return observations.length === 1 ? observations[0] : observations.length ? observedCoverage() : undefined;
}
