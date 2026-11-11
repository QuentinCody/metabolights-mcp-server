import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { readMetabolights } from "./read";
import { studyEvidence } from "./study-evidence";
import { metabolightsCompleteness, observedCoverage } from "./completeness";

export function createMetabolightsApiFetch(): ApiFetchFn {
    return async (request) => {
        if (request.method.toUpperCase() !== "GET" || request.body !== undefined) throw Object.assign(new Error("This MetaboLights adapter accepts GET without a body"), { status: 405 });
        const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
        const response = path.startsWith("/evidence/") ? await studyEvidence(path, request.params) : await readMetabolights(path, request.params);
        return { status: response.status, data: response.data, upstreamTotal: null,
            completeness: metabolightsCompleteness(response.data) ?? observedCoverage() };
    };
}
