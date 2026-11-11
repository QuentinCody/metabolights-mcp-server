/** Strict TSV decoding: ordered cells preserve duplicate sample columns and numeric text. */
function table(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const field = /(?:"((?:[^"]|"")*)"|([^\t\r\n"]*))(\t|\r\n|\n|\r|$)/y;
  const rows: string[][] = []; let row: string[] = []; let position = 0;
  while (position < input.length) {
    field.lastIndex = position;
    const match = field.exec(input);
    if (!match || field.lastIndex === position) throw new Error("Invalid quoted TSV metadata");
    row.push(match[1] === undefined ? match[2] : match[1].replace(/""/g, '"'));
    position = field.lastIndex;
    if (match[3] !== "\t") { rows.push(row); row = []; }
  }
  if (row.length) rows.push([...row, ""]);
  return rows;
}

function identifier(value: string): { namespace: string; accession: string; lookup_key: string } | null {
  const text = value.trim();
  const chebi = /^CHEBI:([1-9]\d*)$/i.exec(text);
  if (chebi) return { namespace: "ChEBI", accession: chebi[1], lookup_key: `CHEBI:${chebi[1]}` };
  const hmdb = /^(HMDB\d+)$/i.exec(text);
  if (hmdb) return { namespace: "HMDB", accession: hmdb[1].toUpperCase(), lookup_key: hmdb[1].toUpperCase() };
  const chembl = /^(CHEMBL[1-9]\d*)$/i.exec(text);
  if (chembl) return { namespace: "ChEMBL", accession: chembl[1].toUpperCase(), lookup_key: chembl[1].toUpperCase() };
  const pubchem = /^(?:CID|PubChem):([1-9]\d*)$/i.exec(text);
  if (pubchem) return { namespace: "PubChem", accession: pubchem[1], lookup_key: `CID:${pubchem[1]}` };
  return null;
}

export function parseMaf(text: string) {
  const [headers, ...records] = table(text);
  if (!headers || headers[0] !== "database_identifier" || !headers.includes("metabolite_identification")) {
    throw new Error("Expected a MAF with database_identifier first and metabolite_identification present");
  }
  if (headers.filter(header => header === "database_identifier").length !== 1) throw new Error("Ambiguous database_identifier columns");
  // A blank line holds no cells, so dropping it discards nothing; row_number keeps the source record position.
  const rows = records.map((cells, index) => ({ cells, row_number: index + 1 }))
    .filter(({ cells }) => !(cells.length === 1 && cells[0] === ""));
  if (rows.some(({ cells }) => cells.length !== headers.length)) throw new Error("MAF row width differs from its header; no cells were silently discarded");
  return {
    columns: headers,
    rows: rows.map(({ cells, row_number }) => ({
      row_number, cells,
      identifier_evidence: { reported_value: cells[0], candidate: identifier(cells[0]),
        resolution: "syntax_only_not_verified", identity_equivalence_asserted: false },
    })),
    semantics: "Values remain strings; repeated features and sample columns are not collapsed. Names, formulas, spectra, confidence and abundance do not establish identifier equivalence.",
  };
}
