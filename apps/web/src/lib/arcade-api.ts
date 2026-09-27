import type { CarrierFlightResultDTO, CarrierMode, HiloChoice, LadderGame, LadderStateDTO, LadderUpdateDTO } from "@snakeland/shared";
import { api } from "./api";

export const carrierApi = {
  state: () => api<{ nextCommit: string }>("/v1/carrier/state", { method: "POST", body: {} }),
  fly: (input: { bet: number; mode: CarrierMode; clientSeed: string }) =>
    api<CarrierFlightResultDTO>("/v1/carrier/flights", { method: "POST", body: input }),
};

/** Tower, Crossing, Penalty and Hi-Lo share one API shape. */
export const ladderApi = (game: LadderGame) => ({
  state: () => api<LadderStateDTO>(`/v1/${game}/state`, { method: "POST", body: {} }),
  start: (input: { bet: number; mode: string; clientSeed: string }) =>
    api<LadderUpdateDTO>(`/v1/${game}/rounds`, { method: "POST", body: input }),
  /** `move` is a door/spot number, a Hi-Lo guess, or nothing (Crossing). */
  step: (roundId: string, version: number, move?: number | HiloChoice) =>
    api<LadderUpdateDTO>(`/v1/${game}/rounds/${encodeURIComponent(roundId)}/step`, {
      method: "POST",
      body: move === undefined ? { version } : typeof move === "number" ? { version, door: move } : { version, choice: move },
    }),
  cashOut: (roundId: string, version: number) =>
    api<LadderUpdateDTO>(`/v1/${game}/rounds/${encodeURIComponent(roundId)}/cashout`, { method: "POST", body: { version } }),
});
