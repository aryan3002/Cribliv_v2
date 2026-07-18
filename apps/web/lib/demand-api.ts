import { fetchApi } from "./api";
import type { CreateDemandSignalDto } from "@cribliv/shared-types";

export function postDemandSignal(dto: CreateDemandSignalDto): Promise<{ ok: boolean; id: string }> {
  return fetchApi<{ ok: boolean; id: string }>("/demand-signals", {
    method: "POST",
    body: JSON.stringify(dto),
    headers: { "Content-Type": "application/json" }
  });
}
