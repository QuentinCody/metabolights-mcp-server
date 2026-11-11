import { afterEach, expect, it, vi } from "vitest";
import { readMetabolights } from "./read";
import { studyEvidence } from "./study-evidence";
vi.mock("./read", () => ({ readMetabolights: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const digest = "a".repeat(64);
const source = { url: "fixture", query: {}, decoded_utf8_sha256: digest, retrieved_at: "2026-09-29", etag: null, last_modified: null, release_pinned: false };
const files = [{ file: "m_MTBLS1.tsv", type: "metadata_maf", size: "0004", checksum: "native" }];
const listing = { status: 200, text: JSON.stringify({ study: files }), data: { study: files, warnings: ["fixture"] }, source };

it("retains native manifest records and labels the requested listing scope", async () => {
  vi.mocked(readMetabolights).mockResolvedValue(listing);
  expect(await studyEvidence("/evidence/studies/MTBLS1/manifest")).toMatchObject({ data: {
    native: listing.data, files: [{ index: 0, file: "m_MTBLS1.tsv", native: files[0] }],
    include_raw_data: false, complete_inventory_verified: false, source,
  } });
  expect(readMetabolights).toHaveBeenCalledWith("/studies/MTBLS1/files", { include_raw_data: false }, "json", expect.any(Number));
});

it("downloads only the selected manifest member and preserves confidence, values and raw metadata", async () => {
  const text = "database_identifier\tmetabolite_identification\treliability\tsample\nCHEBI:27389\tName\tMSI:2\t001.20";
  vi.mocked(readMetabolights).mockResolvedValueOnce(listing).mockResolvedValueOnce({ status: 200, data: text, text, source });
  const result = await studyEvidence("/evidence/studies/MTBLS1/maf", { file: "m_MTBLS1.tsv", expected_manifest_sha256: digest, expected_file_sha256: digest });
  expect(result).toMatchObject({ data: { raw_maf: text, selected_file: files[0], manifest_source: source, source, rows: [{ cells: ["CHEBI:27389", "Name", "MSI:2", "001.20"] }] } });
  expect(readMetabolights).toHaveBeenLastCalledWith("/studies/MTBLS1/download", { file: "m_MTBLS1.tsv" }, "text", expect.any(Number));
});

it("rejects a changed manifest before downloading metadata", async () => {
  vi.mocked(readMetabolights).mockResolvedValue(listing);
  await expect(studyEvidence("/evidence/studies/MTBLS1/maf", { file: "m_MTBLS1.tsv", expected_manifest_sha256: "b".repeat(64) })).rejects.toMatchObject({ status: 409 });
  expect(readMetabolights).toHaveBeenCalledTimes(1);
});

it("rejects changed file content before emitting identifier candidates", async () => {
  const text = "database_identifier\tmetabolite_identification\nCHEBI:1\tName";
  vi.mocked(readMetabolights).mockResolvedValueOnce(listing).mockResolvedValueOnce({ status: 200, data: text, text, source });
  await expect(studyEvidence("/evidence/studies/MTBLS1/maf", { file: "m_MTBLS1.tsv", expected_file_sha256: "b".repeat(64) })).rejects.toMatchObject({ status: 409 });
});

it.each([{ members: [] }, { members: [...files, ...files] }])("does not invent a file when membership is absent or ambiguous", async ({ members }) => {
  vi.mocked(readMetabolights).mockResolvedValue({ ...listing, data: { study: members } });
  await expect(studyEvidence("/evidence/studies/MTBLS1/maf", { file: "m_MTBLS1.tsv" })).rejects.toMatchObject({ status: 409 });
  expect(readMetabolights).toHaveBeenCalledTimes(1);
});

it.each(["../m_file.tsv", "raw.mzML", "m_folder/file.tsv"])("rejects non-metadata or traversal filenames: %s", async file => {
  await expect(studyEvidence("/evidence/studies/MTBLS1/maf", { file })).rejects.toMatchObject({ status: 400 });
  expect(readMetabolights).not.toHaveBeenCalled();
});

it("fails on an unknown manifest shape rather than silently returning no files", async () => {
  vi.mocked(readMetabolights).mockResolvedValue({ ...listing, data: { new_shape: files } });
  await expect(studyEvidence("/evidence/studies/MTBLS1/manifest")).rejects.toMatchObject({ status: 502 });
});

it("retains a malformed MAF and source records in an explicit upstream-schema error", async () => {
  const text = "database_identifier\tmetabolite_identification\nCHEBI:1\tname\textra";
  vi.mocked(readMetabolights).mockResolvedValueOnce(listing).mockResolvedValueOnce({ status: 200, data: text, text, source });
  await expect(studyEvidence("/evidence/studies/MTBLS1/maf", { file: "m_MTBLS1.tsv" })).rejects.toMatchObject({ status: 502,
    data: { raw_maf: text, source, manifest_source: source, selected_file: files[0] } });
});

it.each(["manifest", "maf"])("rejects ignored options before making the %s read", async route => {
  await expect(studyEvidence(`/evidence/studies/MTBLS1/${route}`, { file: "m_MTBLS1.tsv", misspelled_filter: true })).rejects.toMatchObject({ status: 400 });
  expect(readMetabolights).not.toHaveBeenCalled();
});
