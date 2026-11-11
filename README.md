# metabolights-mcp-server

MCP server wrapping the [MetaboLights](https://www.ebi.ac.uk/metabolights/) (EBI) REST API — the open repository for metabolomics studies (MS and NMR data with experimental metadata).

- **Base URL**: `https://www.ebi.ac.uk/metabolights/ws`
- **API docs / Swagger**: https://www.ebi.ac.uk/metabolights/ws/swagger-ui.html
- **Port** (dev): `8885`
- **Auth**: none (public)

Code Mode exposes `metabolights_search`, `metabolights_execute`,
`metabolights_query_data` and `metabolights_get_schema`, each with a `mcp_` alias.
Native study and file routes remain available. Inspect their actual response
shape. Native `/studies` returns `content[]` accession strings; acceptance requests
with page 0/1 and size 2 returned the same 3,487-accession observation. These
parameters do not implement paging, and no authoritative archive total is inferred.
No standalone samples/metabolites endpoint is advertised.

## Study manifests and metabolite evidence

The September 29, 2026 review used the provider's [file guide](https://ebi-metabolights.github.io/guides/Files/),
[MAF guide](https://ebi-metabolights.github.io/guides/MAF/) and the
[EMBL-EBI HoloFood client](https://github.com/EBI-Metagenomics/holofood-database/blob/main/holofood/external_apis/metabolights/api.py).
The catalog adds:

- `/evidence/studies/{accession}/manifest`: native file listing, original file
  entries, source digest, HTTP validators and requested `include_raw_data` scope
  (default false). Inventory completeness is explicitly unverified.
- `/evidence/studies/{accession}/maf`: rechecks that `file` is a unique manifest
  member, downloads that `m_*.tsv` metadata file, and returns raw text plus ordered
  columns/cells and explicit identifier candidates. Optional
  `expected_manifest_sha256` and `expected_file_sha256` reject changed content.
- `/studies/{accession}/download`: the underlying native metadata download route.
- `/studies/{accession}/{filename}`: the native JSON metadata view. It can hide
  columns: MTBLS1's default response has 18 columns and flags
  `columns_hidden: true`, `sample_abundance: false`, while its raw MAF has 156
  columns. Use the download/helper for full ordered file evidence. The legacy
  `/ebi-metabolights/studies` path returned 404 and is no longer advertised.
- `/evidence/studies/{accession}/chebi`: resolves a bounded page of explicit
  ChEBI references in the selected MAF. Returns the complete MAF, separate
  native ChEBI records, source hashes and links to every original feature row.
- `/evidence/studies/{accession}/identifiers`: also resolves explicit ChEMBL and
  PubChem/CID references, with per-reference failures and unavailable HMDB entries.

Manifest and file reads are separate mutable observations, not an atomic study
snapshot. Hashes identify decoded UTF-8 content; they are not provider release
numbers or signatures. Keep both source records when citing derived evidence.

MAF parsing preserves duplicate sample columns, repeated features, unknowns,
confidence fields and numeric strings. It supports quoted tabs/newlines and
escaped quotes; malformed tables fail explicitly. ChEBI, HMDB, ChEMBL and
explicit PubChem/CID strings produce **unverified lookup candidates**. Bare
numbers, compound names, mixed identifiers and structures are not automatically
resolved. The helpers below check the returned accession only; reference
matches do not establish chemical identity or justify combining measurements.
Confidence and units remain in
the source cells; no cross-study abundance normalization is performed.

### ChEBI reference resolution

The October 2 follow-up uses ChEBI's public
[`GET /compound/{chebi_id}/`](https://www.ebi.ac.uk/chebi/backend/api/docs/)
contract, already integrated in the dedicated ChEBI server. It resolves only
explicit ChEBI accessions in the MAF's `database_identifier` column. Repeated
features retain separate rows and link to one shared lookup result. Names,
other namespaces and unqualified numeric values are not queried.

After choosing a unique filename from the manifest:

```js
return await api.get('/evidence/studies/MTBLS1/chebi', {
  file: 'm_MTBLS1_metabolite_profiling_NMR_spectroscopy_v2_maf.tsv',
  limit: 5
});
```

The catalog recipe also forwards the manifest digest. Inspect
`identifier_resolution.results`: an exact returned accession sets
`reference_match: true`; different accessions, absent records and failures remain
distinct unresolved results. Native records are retained for review, including
unknown fields and HTTP error payloads. An accession match does not establish
chemical equivalence, validate spectra or raise the study's confidence level.
ChEBI includes chemical classes as well as specific entities.

`limit` defaults to 5 and accepts 1–10 distinct identifiers. Follow
`identifier_resolution.next_offset` with `expected_file_sha256` from the
preceding response's `source.decoded_utf8_sha256`. The hash pins the MAF bytes
and identifier order; it does not pin the independently mutable ChEBI records.
Each ChEBI record carries its own retrieval time and decoded UTF-8 hash.
There are at most three concurrent lookups, a 1 MiB body limit and a 15-second
header/body deadline per lookup within the helper's remaining 50-second budget.
The returned `complete: false` survives staging; all-namespace resolution and
experimental identification remain outside this helper's scope.

### ChEMBL and PubChem reference resolution

Use `/evidence/studies/{accession}/identifiers` with the same filename and paging
parameters to include ChEMBL and PubChem. The [ChEMBL web-service guide](https://chembl.github.io/using-new-chembl-web-services/)
documents molecule JSON records. PubChem's [September 15, 2026 PUG REST documentation](https://pubchem.ncbi.nlm.nih.gov/pcfe/docs/markdown/pug-rest.md)
documents CID record retrieval and a five-requests-per-second usage limit.
These are existing provider capabilities newly connected to study annotations.

The helper reads `/molecule/{CHEMBL-id}.json` and `/compound/cid/{cid}/JSON`,
preserving native properties, structures, wrappers and unknown fields. PubChem
requires exactly one record with the requested numeric CID; missing, ambiguous
or different IDs remain unresolved. Pending HTTP 202 responses also remain
unresolved. `CID:2244` and `PubChem:2244` share one lookup while every original
row and spelling remain intact. HMDB references return `access_unavailable`
without a request because a supported access contract is not configured.

Pagination includes all recognized namespaces, including HMDB. Continue on this
same route using `next_offset` and `expected_file_sha256`; ChEBI-only offsets
refer to a different list. Each provider record retains its source URL, retrieval
time, hash and HTTP validators. Separate reads are not pinned database releases.

The same three-request concurrency and per-record size/deadline limits apply.
PubChem starts are spaced at least 250ms within an invocation. HTTP 429/503
headers stop its queued requests immediately; in-flight requests can finish,
other providers continue, and no automatic retries occur. Readable error bodies,
`Retry-After` and `X-Throttling-Control` are retained. This pacing does not control
aggregate traffic from other clients or invocations. All results remain
`complete: false`, with no experimental-confidence upgrade.

Each MetaboLights manifest/file read has a 15-second header/retry budget, 10-second body limit and 4 MiB
byte cap, bounded by the remaining 50-second helper budget. The strict UTF-8
reader bounds uncooperative streams and cancellation. Invalid JSON/MAF responses
retain their bounded source evidence; unavailable HTTP-error bodies retain their
status and explicit failure context. Larger raw-data transfers belong in provider FTP/Aspera/Globus tools.
Complete success/error payloads over 30 KiB stage; inspect the staged schema and
query the dataset instead of treating a staging envelope as an empty result.
Dataset-specific license terms must be retained; a universal CC0 label is no
longer attached by the tool.

## Upstream developments and validation

The [provider utility changelog](https://github.com/EBI-Metabolights/metabolights-utils/blob/main/CHANGELOG.md)
records May–June 2026 REST-method, ISA parsing and FTP fixes. The current
[mtblspy documentation](https://github.com/EBI-Metabolights/mtblspy) identifies
`ws3` as a submission/validation service. Those developments do not establish
a replacement public data API; protected submission/editing remains outside
this integration's scope.

### October 3 native acceptance (receipts October 4 UTC)

128 server behavioral tests, 13 static checks, TypeScript, lint and a fresh dry
bundle pass. Real Durable Objects over SQLite verify complete response recovery,
ordered cells, duplicate columns, reference links, source failures and Unicode.
The full suite passes 13,358 tests with 109 skips; affected-workspace results are
recorded in the implementation tracker. No dependency or credential was added.

The local bundled Worker passes 4,414 MCP calls: 4,378 inline and 36 materialized
staged citation proofs. Maximum structured/whole response sizes were
20,120/20,364 bytes. Eleven native cases match the exact provider payload through
both aliases, including the accession list, study/subresources, JSON metadata
view and raw download. All three catalog recipes execute through both aliases.
The standard live harness passes nine checks; dedicated acceptance supplies its
otherwise-skipped large-response coverage.

MTBLS1's 252,657-byte MAF retains all 220 rows and 156 columns, including provider
annotation columns, sample strings and unknown features. Its source SHA-256 is
`e05ed5f0f52f385192846beb7c20573b56c5a233e90b3d3e2dee26c2a2bcc6ff`.
Native MTBLS3 joins verify ChEBI records, hashes and file-pinned continuation.
Standalone ChEBI **CHEBI:15365**, ChEMBL **CHEMBL25** and PubChem **CID:2244**
reads match their native records. A synthetic MAF with real provider reads also
verifies all three lookups, repeated PubChem row links and unavailable HMDB.
The sampled published MAFs contained ChEBI references; published-study ChEMBL/
PubChem end-to-end acceptance remains unverified. This distinction is not a
claim that such study annotations are absent from the archive.

Complete tool envelopes over 30 KiB now stage, including composed program,
SQL and schema responses. Small SQL/schema/error outputs carry verifiable
citations. Omitting SQL `limit` retains the handler's 100-row default without
silently adding it to the signed caller arguments. Native/helper coverage remains
conservative through inline, staged and composed outputs.

SQL projections expose `studies`, `files`, `metadata_rows`, `maf_rows`,
`maf_columns` and `identifier_references` as applicable. MAF `cells` and reference
`row_numbers` are **JSON text arrays**; use `json_extract` with the zero-based
`maf_columns.column_index`. They are not pipe-delimited strings. Original
wrappers, raw text and unknown fields remain in `payloads.root_json` and
`content_chunks`. Query bounded row windows: a query exceeding the DO's
98,304-byte lossless ceiling fails explicitly; transport staging does not remove
that query budget.

Acceptance scripts and the local verified-TLS Worker configuration are under
`scratch/2026-10-03-metabolights/`; receipts are under `/tmp/metabolights-*`.
The manual directory scan reports zero TypeScript, Semgrep, secret or dependency
vulnerability findings, with advisory style, coverage, complexity, typing,
test-heuristic and tsconfig findings. No deployment, commit, provisioning or
Interlinked configuration change was performed. The prior shared Unicode fix
still requires a deliberate fleet rollout.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from MetaboLights (+ ChEBI/ChEMBL/PubChem) and stays under the terms of that source: Open; ChEMBL part CC BY-SA.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
