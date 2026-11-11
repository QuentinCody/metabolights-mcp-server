import { afterEach, expect, it, vi } from "vitest";
import { createMetabolightsApiFetch } from "./api-adapter";
import { metabolightsFetch } from "./http";
vi.mock("./http", () => ({ metabolightsFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const api = createMetabolightsApiFetch();

it("preserves native shapes and query parameters instead of assuming a paged envelope", async () => {
  const data = { studies: ["MTBLS1", "MTBLS2"], additional: "source" };
  vi.mocked(metabolightsFetch).mockResolvedValue(Response.json(data));
  expect(await api({ method: "GET", path: "studies", params: { page: 2 } })).toMatchObject({ status: 200, data, upstreamTotal: null, completeness: { complete: false } });
  expect(metabolightsFetch).toHaveBeenCalledWith("/studies", { page: 2 }, expect.any(Object));
});

it("connects manifest evidence to the native file-list route", async () => {
  vi.mocked(metabolightsFetch).mockResolvedValue(Response.json({ study: [] }));
  expect(await api({ method: "GET", path: "/evidence/studies/MTBLS1/manifest" })).toMatchObject({ status: 200, data: { accession: "MTBLS1", native: { study: [] }, complete_inventory_verified: false } });
});

it("keeps provider failures explicit and refuses write methods", async () => {
  vi.mocked(metabolightsFetch).mockResolvedValue(new Response("unavailable", { status: 403 }));
  await expect(api({ method: "GET", path: "/studies/MTBLS1" })).rejects.toMatchObject({ status: 403, data: "unavailable" });
  await expect(api({ method: "POST", path: "/studies" })).rejects.toMatchObject({ status: 405 });
  await expect(api({ method: "GET", path: "/studies", body: {} })).rejects.toMatchObject({ status: 405 });
  expect(metabolightsFetch).toHaveBeenCalledTimes(1);
});
