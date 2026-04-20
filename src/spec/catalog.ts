import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const metabolightsCatalog: ApiCatalog = {
    name: "MetaboLights",
    baseUrl: "https://www.ebi.ac.uk/metabolights/ws",
    auth: "none",
    endpointCount: 10,
    notes:
        "- MetaboLights (EBI) is the open repository for metabolomics studies — MS and NMR data + experimental metadata.\n" +
        "- Primary entry points: `/studies` (list / archive browsing) and `/studies/{MTBLS-id}` (single-study detail).\n" +
        "- Study-list endpoints return `{ content: [...], page, totalElements, ... }` — flatten with `record_path: 'content'` when staging.\n" +
        "- Study accessions: MTBLS<N> (e.g. MTBLS1, MTBLS374).\n" +
        "- Sub-resources on a study: assays, samples, files, protocols, factors, metabolites, descriptors.\n" +
        "- Responses can be large for studies with many samples/metabolites.\n" +
        "- Docs: https://www.ebi.ac.uk/metabolights/ws/api-portal — Swagger: /ws/swagger-ui.html",
    endpoints: [
        // Archive browsing
        {
            method: "GET",
            path: "/studies",
            summary: "List (paged) public MetaboLights studies (archive browsing)",
            description: "Returns a paged envelope: `{ content: [...], page, totalElements }`. Use `record_path: 'content'` when staging.",
            category: "studies",
            queryParams: [
                { name: "page", type: "number", required: false, description: "Page number (0-indexed)", default: 0 },
                { name: "size", type: "number", required: false, description: "Page size (default 20)", default: 20 },
                { name: "sort", type: "string", required: false, description: "Sort field (e.g. 'studyDate,desc')" },
            ],
            featured: true,
            usageHint: "Flatten with record_path: 'content' when staging.",
        },
        {
            method: "GET",
            path: "/studies/{accession}",
            summary: "Get a single study by MetaboLights accession (e.g. MTBLS1) — full metadata",
            description: "Returns the full ISA-tab style study descriptor: title, abstract, factors, protocols, publications, assays, samples.",
            category: "studies",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Study accession (MTBLS...)" },
            ],
            featured: true,
        },

        // Sub-resources of a study
        {
            method: "GET",
            path: "/studies/{accession}/assays",
            summary: "List assays (MS, NMR technology platforms) recorded for a study",
            category: "study_resources",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Study accession" },
            ],
        },
        // NOTE: /studies/{accession}/samples was removed 2026-04-17 — upstream
        // has no such route and interprets the last segment as a TSV filename,
        // returning HTTP 400 "not a valid TSV". Use the sample list embedded in
        // the /studies/{accession} ISA-tab descriptor instead (see the `samples`
        // array under `isaInvestigation.studies[0]`).
        {
            method: "GET",
            path: "/studies/{accession}/files",
            summary: "List all files attached to a study (raw spectra, processed, metadata)",
            category: "study_resources",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Study accession" },
            ],
            queryParams: [
                { name: "include_raw_data", type: "boolean", required: false, description: "Include raw data files in the listing" },
            ],
        },
        {
            method: "GET",
            path: "/studies/{accession}/protocols",
            summary: "List experimental / analytical protocols used in a study",
            category: "study_resources",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Study accession" },
            ],
        },
        {
            method: "GET",
            path: "/studies/{accession}/factors",
            summary: "List study design factors (experimental variables)",
            category: "study_resources",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Study accession" },
            ],
        },
        {
            method: "GET",
            path: "/studies/{accession}/descriptors",
            summary: "List study descriptors (study design type, technology type ontology terms)",
            category: "study_resources",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Study accession" },
            ],
        },
        {
            method: "GET",
            path: "/studies/{accession}/publications",
            summary: "List publications linked to a study",
            category: "study_resources",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "Study accession" },
            ],
        },

        // Metadata lookups
        {
            method: "GET",
            path: "/ebi-metabolights/studies",
            summary: "Alternative study-list endpoint (legacy path, same semantics as /studies)",
            category: "studies",
            queryParams: [
                { name: "page", type: "number", required: false, description: "Page number", default: 0 },
                { name: "size", type: "number", required: false, description: "Page size", default: 20 },
            ],
            usageHint: "Prefer /studies. Listed for discoverability only.",
        },
    ],
};
