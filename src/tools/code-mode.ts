import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { metabolightsCatalog } from "../spec/catalog";
import { createMetabolightsApiFetch } from "../lib/api-adapter";
import { metabolightsResponse } from "../lib/tool-result";

interface CodeModeEnv {
    METABOLIGHTS_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createMetabolightsApiFetch();
    const registrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof metabolightsResponse>;
        rest.push((input: unknown, extra: unknown) => metabolightsResponse(() => handler(input, extra), env, String(name), extra, input));
        // SAFETY: shared factories supply SDK arguments; only the alias changes.
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest); register(`mcp_${String(name)}`, ...rest);
    } };

    const searchTool = createSearchTool({
        prefix: "metabolights",
        catalog: metabolightsCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "metabolights",
        // Verifiable provenance: metabolights_execute results carry a _meta.citation.
        source: { id: "metabolights", name: "MetaboLights", url: "https://www.ebi.ac.uk/metabolights" },
        catalog: metabolightsCatalog,
        apiFetch,
        preserveApiErrors: true,
        doNamespace: env.METABOLIGHTS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        timeout: 60000,
    });
    executeTool.register(registrar);
}
