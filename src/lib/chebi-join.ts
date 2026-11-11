import type { parseMaf } from "./maf";
import { CHEBI_BASE, readChebiRecord } from "./chebi-record";
import { PUBLIC_REFERENCE_APIS } from "./reference-request";
import { readPublicReference } from "./reference-record";

export function chebiPage(params: Record<string, unknown>) {
  const allowed = new Set(["file", "include_raw_data", "expected_manifest_sha256", "expected_file_sha256", "offset", "limit"]);
  if (Object.keys(params).some(key => !allowed.has(key))) throw Object.assign(new Error("Unsupported reference-lookup parameter"), { status: 400 });
  const offset = params.offset ?? 0; const limit = params.limit ?? 5;
  if (typeof offset !== "number" || !Number.isSafeInteger(offset) || offset < 0 || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw Object.assign(new Error("offset must be a nonnegative integer and limit must be an integer from 1 to 10"), { status: 400 });
  }
  if (offset > 0 && (typeof params.expected_file_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(params.expected_file_sha256))) {
    throw Object.assign(new Error("Continuation requires expected_file_sha256 from the preceding MAF response"), { status: 400 });
  }
  return { offset, limit };
}

export async function resolveChebiReferences(maf: ReturnType<typeof parseMaf>, page: ReturnType<typeof chebiPage>, deadlineAt: number) {
  return resolveMafReferences(maf, page, deadlineAt, true);
}

export async function resolveMafReferences(maf: ReturnType<typeof parseMaf>, page: ReturnType<typeof chebiPage>, deadlineAt: number, chebiOnly = false) {
  const { selected, references } = selectMafReferences(maf, chebiOnly, page);
  const lookup = createReferenceLookup(deadlineAt, chebiOnly);
  const results: Awaited<ReturnType<typeof lookup>>[] = new Array(selected.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, selected.length) }, async () => {
    while (next < selected.length) {
      const index = next++;
      results[index] = await lookup(selected[index]);
    }
  }));
  const end = page.offset + selected.length;
  return {
    ...(chebiOnly ? { provider: "ChEBI", api_base: CHEBI_BASE, scope: "Explicit ChEBI accessions in database_identifier only" }
      : { provider: "public_compound_references", api_bases: PUBLIC_REFERENCE_APIS, scope: "Explicit ChEBI, ChEMBL and PubChem references; HMDB access remains unavailable",
        pubchem_request_spacing_ms: 250, pacing_scope: "This invocation only; aggregate traffic from other clients is not controlled" }),
    offset: page.offset, limit: page.limit, total_distinct_identifiers: references.size,
    next_offset: end < references.size ? end : null, results,
    matched_identifiers: results.filter(result => result.reference_match).length,
    unresolved_identifiers: results.filter(result => !result.reference_match).length,
    complete: false,
    semantics: "Reference lookups do not validate the study's identification, confidence, spectra, abundance or chemical equivalence. Different returned accessions remain unresolved; native records are preserved for review. Unqualified identifiers are not queried. Separate mutable reads are not pinned database releases or an atomic cross-database snapshot. Keep the same route and file hash when continuing.",
  };
}

function createReferenceLookup(deadlineAt: number, chebiOnly: boolean) {
  let nextPubchemAt = 0; let pubchemBackoff = false; let pubchemTurn = Promise.resolve();
  const waitForPubchem = () => {
    const turn = pubchemTurn.then(async () => {
      if (pubchemBackoff) return;
      const delay = Math.max(0, nextPubchemAt - Date.now());
      if (Date.now() + delay >= deadlineAt) throw Object.assign(new Error("PubChem reference lookup deadline exceeded before request"), { status: 504 });
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      nextPubchemAt = Date.now() + 250;
    });
    pubchemTurn = turn.catch(() => { }); // A failed turn must not prevent per-reference error reporting.
    return turn;
  };
  const lookup = async ([accession, reference]: [string, { namespace: string; rows: number[]; }]) => {
    const context = { namespace: reference.namespace, requested_accession: accession, row_numbers: reference.rows, identity_equivalence_asserted: false };
    if (reference.namespace === "HMDB") return {
      ...context, resolution: "access_unavailable", reference_match: false, http_status: null,
      access_documentation: "https://hmdb.ca/simple/api", error: { status: 503, message: "No verified public HMDB API contract or entitlement is configured; no request was made" }
    };
    try {
      if (reference.namespace === "PubChem") {
        await waitForPubchem();
        if (pubchemBackoff) return {
          ...context, resolution: "provider_backoff", reference_match: false, http_status: null,
          error: { status: 503, message: "A prior PubChem lookup returned 429 or 503; no further PubChem request was made in this invocation" }
        };
      }
      const result = chebiOnly ? await readChebiRecord(accession, deadlineAt) : await readPublicReference(reference.namespace, accession, deadlineAt, status => {
        // Stop queued requests as soon as headers arrive, even if the error body stalls or exceeds the cap.
        if (reference.namespace === "PubChem" && (status === 429 || status === 503)) pubchemBackoff = true;
      });
      return { ...context, ...result };
    }
    catch (error) {
      const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 502;
      return {
        ...context, resolution: "lookup_failed", reference_match: false, http_status: null,
        error: { status, message: error instanceof Error ? error.message : String(error) }
      };
    }
  };
  return lookup;
}

function selectMafReferences(maf: { columns: string[]; rows: { row_number: number; cells: string[]; identifier_evidence: { reported_value: string; candidate: { namespace: string; accession: string; lookup_key: string; } | null; resolution: string; identity_equivalence_asserted: boolean; }; }[]; semantics: string; }, chebiOnly: boolean, page: { offset: number; limit: number; }) {
  const references = new Map<string, { namespace: string; rows: number[]; }>();
  for (const row of maf.rows) {
    const candidate = row.identifier_evidence.candidate;
    if (!candidate || (chebiOnly && candidate.namespace !== "ChEBI")) continue;
    const reference = references.get(candidate.lookup_key) ?? { namespace: candidate.namespace, rows: [] };
    reference.rows.push(row.row_number); references.set(candidate.lookup_key, reference);
  }
  if (page.offset > references.size) throw Object.assign(new Error("offset exceeds this MAF's distinct identifier count for the selected route"), { status: 400 });
  const selected = [...references].slice(page.offset, page.offset + page.limit);
  return { selected, references };
}
