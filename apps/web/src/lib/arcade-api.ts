import type { CarrierFlightResultDTO, CarrierMode, LadderGame, LadderStateDTO, LadderUpdateDTO } from "@snakeland/shared";
import { api } from "./api";

export const carrierApi = {
  state: () => api<{ nextCommit: string }>("/v1/carrier/state", { method: "POST", body: {} }),
  fly: (input: { bet: number; mode: CarrierMode; clientSeed: string }) =>
    api<CarrierFlightResultDTO>("/v1/carrier/flights", { method: "POST", body: input }),
};

/** Tower and Crossing share one API shape. */
export const ladderApi = (game: LadderGame) => ({
  state: () => api<LadderStateDTO>(`/v1/${game}/state`, { method: "POST", body: {} }),
  start: (input: { bet: number; mode: string; clientSeed: string }) =>
    api<LadderUpdateDTO>(`/v1/${game}/rounds`, { method: "POST", body: input }),
  step: (roundId: string, version: number, door?: number) =>
    api<LadderUpdateDTO>(`/v1/${game}/rounds/${encodeURIComponent(roundId)}/step`, {
      method: "POST",
      body: door === undefined ? { version } : { version, door },
    }),
  cashOut: (roundId: string, version: number) =>
    api<LadderUpdateDTO>(`/v1/${game}/rounds/${encodeURIComponent(roundId)}/cashout`, { method: "POST", body: { version } }),
});
