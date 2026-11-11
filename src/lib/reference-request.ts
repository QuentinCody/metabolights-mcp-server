export const PUBLIC_REFERENCE_APIS = {
  ChEBI: "https://www.ebi.ac.uk/chebi/backend/api/public",
  ChEMBL: "https://www.ebi.ac.uk/chembl/api/data",
  PubChem: "https://pubchem.ncbi.nlm.nih.gov/rest/pug",
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pubchemAccession(native: unknown): string | null {
  const compounds = object(native)?.PC_Compounds;
  if (!Array.isArray(compounds) || compounds.length !== 1) return null;
  const cid = object(object(object(compounds[0])?.id)?.id)?.cid;
  return typeof cid === "number" && Number.isSafeInteger(cid) && cid > 0 ? `CID:${cid}` : null;
}

export function referenceRequest(namespace: string, accession: string) {
  if (accession.length <= 100) {
    if (namespace === "ChEBI" && /^CHEBI:[1-9]\d*$/.test(accession)) return {
      provider: namespace, url: `${PUBLIC_REFERENCE_APIS.ChEBI}/compound/${accession.slice(6)}/`,
      identify(native: unknown) {
        const value = object(native)?.chebi_accession;
        return typeof value === "string" && /^CHEBI:[1-9]\d*$/i.test(value) ? value.toUpperCase() : null;
      },
    };
    if (namespace === "ChEMBL" && /^CHEMBL[1-9]\d*$/.test(accession)) return {
      provider: namespace, url: `${PUBLIC_REFERENCE_APIS.ChEMBL}/molecule/${accession}.json`,
      identify(native: unknown) {
        const value = object(native)?.molecule_chembl_id;
        return typeof value === "string" && /^CHEMBL[1-9]\d*$/i.test(value) ? value.toUpperCase() : null;
      },
    };
    if (namespace === "PubChem" && /^CID:[1-9]\d*$/.test(accession) && Number.isSafeInteger(Number(accession.slice(4)))) return {
      provider: namespace, url: `${PUBLIC_REFERENCE_APIS.PubChem}/compound/cid/${accession.slice(4)}/JSON`, identify: pubchemAccession,
    };
  }
  throw Object.assign(new Error(`Invalid, unsupported or oversized ${namespace} accession`), { status: 400 });
}
