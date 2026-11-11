import { readPublicReference } from "./reference-record";
import { PUBLIC_REFERENCE_APIS } from "./reference-request";

export const CHEBI_BASE = PUBLIC_REFERENCE_APIS.ChEBI;

export function readChebiRecord(accession: string, deadlineAt: number) {
  return readPublicReference("ChEBI", accession, deadlineAt);
}
