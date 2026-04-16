import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class MetabolightsDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        const obj = data as Record<string, unknown>;

        // Paged envelope: { content: [...], page, totalElements }
        if (Array.isArray(obj.content)) {
            const sample = obj.content[0];
            if (sample && typeof sample === "object") {
                const sampleObj = sample as Record<string, unknown>;
                if ("studyIdentifier" in sampleObj || "accession" in sampleObj) {
                    return {
                        tableName: "studies",
                        indexes: ["studyIdentifier", "accession", "title"],
                    };
                }
                return {
                    tableName: "records",
                    indexes: ["accession", "id"],
                };
            }
        }

        // Array response (sub-resources)
        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                const sampleObj = sample as Record<string, unknown>;
                if ("technology" in sampleObj || "assayTechnique" in sampleObj) {
                    return { tableName: "assays", indexes: ["name", "technology"] };
                }
                if ("sampleName" in sampleObj) {
                    return { tableName: "samples", indexes: ["sampleName"] };
                }
                if ("fileName" in sampleObj || "file" in sampleObj) {
                    return { tableName: "files", indexes: ["fileName", "file"] };
                }
                return { tableName: "records", indexes: [] };
            }
        }

        // Single study object
        if (typeof obj.studyIdentifier === "string" || typeof obj.accession === "string") {
            return {
                tableName: "study",
                indexes: ["studyIdentifier", "accession"],
            };
        }

        return undefined;
    }
}
