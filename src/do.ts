import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export class MetabolightsDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
      ? value.structuredContent.data : value;
    if (!record(data)) return data;
    // Avoid a user SQL _rowid colliding with the staging table's own primary key.
    if (typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map(native => ({ native })) };
    if (typeof data.raw_maf === "string" && Array.isArray(data.rows) && Array.isArray(data.columns)) return {
      // Generic primitive-array projections join with pipes; ordered cells need JSON.
      maf_rows: data.rows.map(row => record(row) && Array.isArray(row.cells) ? { ...row, cells: JSON.stringify(row.cells) } : row),
      maf_columns: data.columns.map((name, column_index) => ({ column_index, name })),
      ...(record(data.identifier_resolution) && Array.isArray(data.identifier_resolution.results)
        ? { identifier_references: data.identifier_resolution.results.map(row => record(row) && Array.isArray(row.row_numbers) ? { ...row, row_numbers: JSON.stringify(row.row_numbers) } : row) } : {}),
    };
    if (Array.isArray(data.content) && data.content.every(item => typeof item === "string")) return { studies: data.content.map(accession => ({ accession })) };
    if (Array.isArray(data.study)) return { files: data.study };
    if (data.complete_inventory_verified === false && Array.isArray(data.files)) return { files: data.files };
    if (record(data.header) && record(data.data) && Array.isArray(data.data.rows)) return { metadata_rows: data.data.rows };
    if (record(data.data) && Array.isArray(data.data.assays)) return { assays: data.data.assays };
    return data;
  }
}
