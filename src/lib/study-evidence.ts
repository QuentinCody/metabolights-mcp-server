import { parseMaf } from "./maf";
import { readMetabolights } from "./read";
import { chebiPage, resolveChebiReferences, resolveMafReferences } from "./chebi-join";

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function checkHash(expected: unknown, actual: string, label: string): void {
  if (expected === undefined) return;
  if (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected)) fail(400, `${label} must be a SHA-256 digest`);
  if (expected.toLowerCase() !== actual) fail(409, `${label} changed; refresh and review the source before continuing`);
}

function filesFrom(data: unknown): unknown[] {
  if (!data || typeof data !== "object" || !("study" in data) || !Array.isArray(data.study)) {
    fail(502, "Unrecognized MetaboLights file-list schema; use the native /files response for inspection");
  }
  return data.study;
}

function fileName(entry: unknown): string | null {
  return entry && typeof entry === "object" && "file" in entry && typeof entry.file === "string" ? entry.file : null;
}

function mafFilename(value: unknown): string {
  if (typeof value !== "string" || !/^m_[^/\\\0]+\.tsv$/i.test(value) || value.includes("..")) {
    fail(400, "file must be a metabolite metadata m_*.tsv filename selected from the study manifest");
  }
  return value;
}

export async function studyEvidence(path: string, params: Record<string, unknown> = {}): Promise<{ status: number; data: unknown }> {
  const deadlineAt = Date.now() + 50000;
  const match = /^\/evidence\/studies\/(MTBLS[1-9]\d*)\/(manifest|maf|chebi|identifiers)$/.exec(path);
  if (!match) fail(400, "Use a public MTBLS accession and manifest, maf, chebi or identifiers evidence route");
  const [, accession, action] = match;
  const allowed = action === "manifest" ? ["include_raw_data", "expected_manifest_sha256"]
    : ["file", "include_raw_data", "expected_manifest_sha256", "expected_file_sha256", ...(action === "maf" ? [] : ["offset", "limit"])];
  if (Object.keys(params).some(key => !allowed.includes(key))) fail(400, "Unsupported evidence parameter; use the selected route's documented parameters");
  const page = action === "chebi" || action === "identifiers" ? chebiPage(params) : null;
  const file = action !== "manifest" ? mafFilename(params.file) : null;
  const includeRaw = params.include_raw_data ?? false;
  if (typeof includeRaw !== "boolean") fail(400, "include_raw_data must be a boolean");
  const listing = await readMetabolights(`/studies/${accession}/files`, { include_raw_data: includeRaw }, "json", deadlineAt);
  const files = filesFrom(listing.data);
  checkHash(params.expected_manifest_sha256, listing.source.decoded_utf8_sha256, "expected_manifest_sha256");
  const manifest = {
    accession, native: listing.data, source: listing.source,
    include_raw_data: includeRaw, complete_inventory_verified: false,
    files: files.map((entry, index) => ({ index, file: fileName(entry), native: entry })),
  };
  if (action === "manifest") return { status: listing.status, data: manifest };
  return await readMafEvidence(files, file, accession, deadlineAt, params, manifest, page, action);
}

async function readMafEvidence(files: unknown[], file: string | null, accession: string, deadlineAt: number, params: Record<string, unknown>, manifest: { accession: string; native: unknown; source: { url: string; query: Record<string, unknown>; decoded_utf8_sha256: string; retrieved_at: string; etag: string | null; last_modified: string | null; release_pinned: boolean; }; include_raw_data: boolean; complete_inventory_verified: boolean; files: { index: number; file: string | null; native: unknown; }[]; }, page: { offset: number; limit: number; } | null, action: string) {
  const selected = files.filter(entry => fileName(entry) === file);
  if (selected.length !== 1) fail(409, "Select a uniquely listed MAF file; absent or duplicate filenames cannot be resolved automatically");
  const download = await readMetabolights(`/studies/${accession}/download`, { file }, "text", deadlineAt);
  checkHash(params.expected_file_sha256, download.source.decoded_utf8_sha256, "expected_file_sha256");
  let maf: ReturnType<typeof parseMaf>;
  try { maf = parseMaf(download.text); }
  catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      status: 502,
      data: { accession, file, selected_file: selected[0], manifest_source: manifest.source, source: download.source, raw_maf: download.text }
    });
  }
  const resolution = page ? await (action === "chebi" ? resolveChebiReferences : resolveMafReferences)(maf, page, deadlineAt) : undefined;
  return {
    status: download.status, data: {
      accession, file, selected_file: selected[0], manifest_source: manifest.source,
      source: download.source, raw_maf: download.text, ...maf,
      ...(resolution ? { identifier_resolution: resolution, complete: false } : {}),
      snapshot_consistency: "Separate mutable reads; file digest identifies downloaded metadata, not an atomic study snapshot",
    }
  };
}
