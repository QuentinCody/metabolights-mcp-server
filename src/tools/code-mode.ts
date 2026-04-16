import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { metabolightsCatalog } from "../spec/catalog";
import { createMetabolightsApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    METABOLIGHTS_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createMetabolightsApiFetch();

    const searchTool = createSearchTool({
        prefix: "metabolights",
        catalog: metabolightsCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "metabolights",
        catalog: metabolightsCatalog,
        apiFetch,
        doNamespace: env.METABOLIGHTS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
