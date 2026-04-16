# metabolights-mcp-server

MCP server wrapping the [MetaboLights](https://www.ebi.ac.uk/metabolights/) (EBI) REST API — the open repository for metabolomics studies (MS and NMR data with experimental metadata).

- **Base URL**: `https://www.ebi.ac.uk/metabolights/ws`
- **API docs / Swagger**: https://www.ebi.ac.uk/metabolights/ws/swagger-ui.html
- **Port** (dev): `8885`
- **Auth**: none (public)

All functionality is exposed through Code Mode: `metabolights_search` (discover endpoints) and `metabolights_execute` (run JavaScript in a V8 isolate). Primary entry points are `/studies` (archive browsing — paged envelope with records under `.content[]`) and `/studies/{MTBLS-id}` (single study detail) plus sub-resources (assays, samples, files, protocols, factors). Large responses auto-stage to `METABOLIGHTS_DATA_DO`; query with `metabolights_query_data` and inspect schemas via `metabolights_get_schema`.
