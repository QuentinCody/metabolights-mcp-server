import { expect, it } from "vitest";
import { parseMaf } from "./maf";

const header = "database_identifier\tmetabolite_identification\treliability\tsample\tsample";
it("preserves repeated features, duplicate sample columns, unknowns and exact numeric text", () => {
  const data = parseMaf(`${header}\nCHEBI:27389\t3-Aminoisobutyric acid\tMSI:2\t001.20\tNA\nCHEBI:27389\tOther feature\tMSI:3\t0\t\n\tUnknown1\t\t1e-9\t0`);
  expect(data.columns).toEqual(["database_identifier", "metabolite_identification", "reliability", "sample", "sample"]);
  expect(data.rows.map(row => row.cells)).toEqual([
    ["CHEBI:27389", "3-Aminoisobutyric acid", "MSI:2", "001.20", "NA"],
    ["CHEBI:27389", "Other feature", "MSI:3", "0", ""],
    ["", "Unknown1", "", "1e-9", "0"],
  ]);
  expect(data.rows[2].identifier_evidence.candidate).toBeNull();
});

it("handles BOM, quoted tabs, escaped quotes, CRLF and embedded newlines", () => {
  const result = parseMaf('\uFEFF"database_identifier"\t"metabolite_identification"\r\n"HMDB0000122"\t"A\tB\n""quoted"""\r\n');
  expect(result.rows[0].cells).toEqual(["HMDB0000122", 'A\tB\n"quoted"']);
});

it.each([
  ["CHEBI:27389", "ChEBI", "CHEBI:27389"],
  ["HMDB0000122", "HMDB", "HMDB0000122"],
  ["CHEMBL25", "ChEMBL", "CHEMBL25"],
  ["CID:5793", "PubChem", "CID:5793"],
])("recognizes explicit identifiers as unverified lookup candidates: %s", (value, namespace, lookup_key) => {
  expect(parseMaf(`database_identifier\tmetabolite_identification\n${value}\tName`).rows[0].identifier_evidence).toMatchObject({ reported_value: value, candidate: { namespace, lookup_key }, resolution: "syntax_only_not_verified", identity_equivalence_asserted: false });
});

it.each(["27389", "CHEBI:1|CHEBI:2", "glucose", "InChI=1S/...", "Unknown1"])("does not invent a join for %s", value => {
  expect(parseMaf(`database_identifier\tmetabolite_identification\n${value}\tName`).rows[0].identifier_evidence.candidate).toBeNull();
});

it.each([
  "", "<html>login</html>",
  'database_identifier\tmetabolite_identification\nCHEBI:1\t"unclosed',
  'database_identifier\tmetabolite_identification\nCHEBI:1\t"name"junk',
  "database_identifier\tmetabolite_identification\nCHEBI:1\tname\textra",
  "database_identifier\tdatabase_identifier\tmetabolite_identification\nX\tY\tZ",
])("rejects malformed metadata rather than reporting an empty join", text => {
  expect(() => parseMaf(text)).toThrow();
});

it.each([
  ["trailing blank LF line", `${header}\nCHEBI:1\tA\tMSI:2\t1\t2\n\n`],
  ["trailing blank CRLF line", `${header}\r\nCHEBI:1\tA\tMSI:2\t1\t2\n\r\n`],
])("skips a %s instead of rejecting the MAF", (_label, text) => {
  expect(parseMaf(text).rows.map(row => row.cells)).toEqual([["CHEBI:1", "A", "MSI:2", "1", "2"]]);
});

it("keeps source row numbers when a blank line sits between data rows", () => {
  const data = parseMaf(`${header}\nCHEBI:1\tA\tMSI:2\t1\t2\n\nCHEBI:2\tB\tMSI:2\t3\t4\n`);
  expect(data.rows.map(row => [row.row_number, row.cells[0]])).toEqual([[1, "CHEBI:1"], [3, "CHEBI:2"]]);
});
