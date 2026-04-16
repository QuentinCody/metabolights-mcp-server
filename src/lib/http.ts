import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const METABOLIGHTS_BASE = "https://www.ebi.ac.uk/metabolights/ws";

export interface MetabolightsFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the MetaboLights (EBI) REST API.
 */
export async function metabolightsFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: MetabolightsFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? METABOLIGHTS_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 45_000,
        userAgent: "metabolights-mcp-server/1.0 (bio-mcp)",
    });
}
