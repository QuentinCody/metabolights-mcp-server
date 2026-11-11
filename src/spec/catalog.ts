import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const metabolightsCatalog: ApiCatalog = {
    name: "MetaboLights",
    baseUrl: "https://www.ebi.ac.uk/metabolights/ws",
    auth: "none",
    endpointCount: 14,
    notes:
        "- MetaboLights (EBI) is the open repository for metabolomics studies — MS and NMR data + experimental metadata.\n" +
        "- Primary entry points: `/studies` (list / archive browsing) and `/studies/{MTBLS-id}` (single-study detail).\n" +
        "- Native /studies returns content[] accession strings; page=0/1 and size=2 returned the same full observed list. Do not paginate it using page/size or infer an authoritative archive total.\n" +
        "- Study accessions: MTBLS<N> (e.g. MTBLS1, MTBLS374).\n" +
        "- Discover files first. MAF metabolite metadata is linked from assay sheets; unknown features and confidence levels must be retained. No standalone /samples or /metabolites route is asserted.\n" +
        "- Responses can be large for studies with many samples/metabolites.\n" +
        "- Evidence helpers are public reads only. Raw data transfer uses provider FTP/Aspera/Globus; the local MAF helper reads at most 4 MiB. Separate reads are not atomic study snapshots.\n" +
        "- Match compounds only by explicit source-qualified identifiers, then verify using the corresponding database. Names, formulas, InChI strings, spectra and abundance are not automatically equivalent. Preserve dataset-specific license information.\n" +
        "- /evidence/studies/{accession}/chebi resolves a bounded page of explicit ChEBI references from a manifest-selected MAF. Full native ChEBI records and repeated MAF rows remain separate; a matching accession does not validate the experimental identification. Continuation requires the MAF content hash.\n" +
        "- /evidence/studies/{accession}/identifiers also resolves explicit PubChem/CID and ChEMBL references. HMDB entries remain access_unavailable with no request. PubChem starts are spaced 250ms per invocation and further requests stop after 429/503; other clients' aggregate traffic is not controlled.\n" +
        "- Docs: https://ebi-metabolights.github.io/guides/Files/ and /MAF/. The ws3 submission API is a separate scope, not a replacement public data contract.",
    workflows: [{
        title: "Discover a study's metadata manifest before reading a MAF",
        description: "Return the full manifest and its digest. Select an exact m_*.tsv member, then call /evidence/studies/{accession}/maf with file and optional expected_manifest_sha256. Do not assume the first file is the metabolite table.",
        keywords: ["manifest", "files", "MAF", "metabolites", "identifiers"],
        code: "return await api.get('/evidence/studies/MTBLS1/manifest', { include_raw_data: false });",
    }, {
        title: "Resolve reported ChEBI references from a selected study MAF",
        description: "Set accession and an exact manifest filename. Fetch up to five distinct ChEBI references, preserving all MAF rows, confidence and native compound responses. Continue with next_offset and expected_file_sha256; review per-identifier failures and different returned accessions.",
        keywords: ["ChEBI", "metabolites", "MAF", "identifiers", "join", "confidence"],
        code: "const accession = 'MTBLS1'; const file = 'm_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv';\nconst manifest = await api.get('/evidence/studies/' + accession + '/manifest', { include_raw_data: false });\nif (manifest.__staged || manifest.__api_error) return manifest;\nif (!Array.isArray(manifest.files) || manifest.files.filter(entry => entry.file === file).length !== 1) return { manifest, selection_required: 'Choose an exact, uniquely listed m_*.tsv filename.' };\nreturn await api.get('/evidence/studies/' + accession + '/chebi', { file, expected_manifest_sha256: manifest.source.decoded_utf8_sha256, limit: 5 });",
    }, {
        title: "Resolve public compound references across a study MAF",
        description: "Resolve one page of explicit ChEBI, ChEMBL and PubChem/CID references from a uniquely selected MAF. Return all source cells and native records; inspect individual failures and HMDB access_unavailable results. Continue on the same route with next_offset and the returned file hash.",
        keywords: ["PubChem", "CID", "ChEMBL", "ChEBI", "HMDB", "MAF", "identifiers", "join"],
        code: "const accession = 'MTBLS1'; const file = 'm_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv';\nconst manifest = await api.get('/evidence/studies/' + accession + '/manifest', { include_raw_data: false });\nif (manifest.__staged || manifest.__api_error) return manifest;\nif (!Array.isArray(manifest.files) || manifest.files.filter(entry => entry.file === file).length !== 1) return { manifest, selection_required: 'Choose an exact, uniquely listed m_*.tsv filename.' };\nreturn await api.get('/evidence/studies/' + accession + '/identifiers', { file, expected_manifest_sha256: manifest.source.decoded_utf8_sha256, limit: 5 });",
    }],
    endpoints: [
        // Archive browsing
        {
            method: "GET",
            path: "/studies",
            summary: "Native public-study accession listing (page/size ignored in acceptance checks)",
            description: "Preserves content[] accession strings and the native wrapper. No authoritative total, snapshot or applied paging/filtering is asserted.",
            category: "studies",
            featured: true,
            usageHint: "Inspect the full native payload; large lists stage without removing context.",
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

        // Native JSON metadata view; the raw download retains columns hidden by default here.
        { method: "GET", path: "/studies/{accession}/{filename}", summary: "Native JSON view of an exact metadata filename discovered from /files.", category: "study_resources",
            description: "The default MAF view can hide sample abundance and provider annotation columns (MTBLS1: 18 JSON columns versus 156 raw TSV columns). Keep header/data wrappers and flags; use /download or the MAF helper for complete ordered file evidence.",
            pathParams: [{ name: "accession", type: "string", required: true, description: "Public MTBLS accession." },
                { name: "filename", type: "string", required: true, description: "Exact metadata filename selected from /files; never a guessed samples/metabolites subresource." }] },
        { method: "GET", path: "/studies/{accession}/download", summary: "Download one metadata file selected from the study file list; use bulk transfer tools for raw data.", category: "study_resources",
            pathParams: [{ name: "accession", type: "string", required: true, description: "Public MTBLS accession." }],
            queryParams: [{ name: "file", type: "string", required: true, description: "Exact metadata filename from /files." }] },
        { method: "GET", path: "/evidence/studies/{accession}/manifest", summary: "Local manifest with native file records, source hash and explicit raw-data listing scope.", category: "evidence",
            pathParams: [{ name: "accession", type: "string", required: true, description: "Public MTBLS accession." }],
            queryParams: [{ name: "include_raw_data", type: "boolean", required: false, description: "Default false; true requests raw-data entries, not their bytes." },
                { name: "expected_manifest_sha256", type: "string", required: false, description: "Optional prior manifest digest; mismatch returns 409." }] },
        { method: "GET", path: "/evidence/studies/{accession}/maf", summary: "Local manifest-backed MAF reader preserving raw text, ordered cells, source hashes and unverified identifier candidates.", category: "evidence",
            pathParams: [{ name: "accession", type: "string", required: true, description: "Public MTBLS accession." }],
            queryParams: [{ name: "file", type: "string", required: true, description: "Exact uniquely listed m_*.tsv file." },
                { name: "include_raw_data", type: "boolean", required: false, description: "Use the same listing scope as the prior manifest; default false." },
                { name: "expected_manifest_sha256", type: "string", required: false, description: "Optional manifest drift guard." },
                { name: "expected_file_sha256", type: "string", required: false, description: "Optional metadata content drift guard." }] },
        { method: "GET", path: "/evidence/studies/{accession}/chebi", summary: "Resolve a bounded page of explicit ChEBI references in a manifest-selected MAF, retaining the complete MAF and native database records.", category: "evidence",
            description: "Local read helper: the existing manifest and MAF paths plus public ChEBI compound GETs. Results link to original row numbers without merging repeated features. Exact returned accessions, different accessions, missing records and lookup errors remain distinct. Other namespaces are not queried, and study identification confidence is not upgraded. At most three concurrent lookups; each ChEBI response is bounded to 1 MiB and 15 seconds within the helper's remaining 50-second budget. No release pin or atomic snapshot is asserted.",
            pathParams: [{ name: "accession", type: "string", required: true, description: "Public MTBLS accession." }],
            queryParams: [
                { name: "file", type: "string", required: true, description: "Exact uniquely listed m_*.tsv filename." },
                { name: "include_raw_data", type: "boolean", required: false, description: "Manifest listing scope; default false." },
                { name: "expected_manifest_sha256", type: "string", required: false, description: "Optional manifest drift guard." },
                { name: "expected_file_sha256", type: "string", required: false, description: "MAF content hash; required when offset is greater than zero." },
                { name: "offset", type: "number", required: false, default: 0, description: "Offset into distinct ChEBI identifiers in first-appearance order; repeated MAF rows retain all their links." },
                { name: "limit", type: "number", required: false, default: 5, description: "Distinct identifiers to resolve, integer from 1 through 10." },
            ] },
        { method: "GET", path: "/evidence/studies/{accession}/identifiers", summary: "Join a page of reported ChEBI, ChEMBL and PubChem/CID references to native public records, preserving all MAF evidence.", category: "evidence",
            description: "Local read helper. Pages use distinct namespace-qualified identifiers in first-appearance order, including explicit unavailable HMDB entries. No names, structures or bare numbers are resolved. Each returned accession must match the requested reference; multiple PubChem records, mismatched IDs and malformed records remain unresolved with their native payload. This does not prove chemical equivalence or experimental identity. Public reads have the same 1 MiB/15-second limits as the ChEBI helper; no automatic retry. PubChem reads are paced at 250ms and later requests stop after 429/503 within this invocation. Preserve native error bodies, Retry-After and throttling headers.",
            pathParams: [{ name: "accession", type: "string", required: true, description: "Public MTBLS accession." }],
            queryParams: [
                { name: "file", type: "string", required: true, description: "Exact uniquely listed m_*.tsv filename." },
                { name: "include_raw_data", type: "boolean", required: false, description: "Manifest listing scope; default false." },
                { name: "expected_manifest_sha256", type: "string", required: false, description: "Optional manifest drift guard." },
                { name: "expected_file_sha256", type: "string", required: false, description: "Required for continuation; pins the MAF and identifier order, not the provider releases." },
                { name: "offset", type: "number", required: false, default: 0, description: "Distinct-reference offset for this identifiers route; do not reuse an offset from the ChEBI-only route." },
                { name: "limit", type: "number", required: false, default: 5, description: "Distinct references per page, integer 1–10; repeated feature rows stay linked." },
            ] },
    ],
};
