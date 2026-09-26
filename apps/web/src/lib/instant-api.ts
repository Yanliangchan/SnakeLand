import type {
  MinesStateDTO,
  MinesUpdateDTO,
  PlinkoDropResultDTO,
  PlinkoRisk,
} from "@snakeland/shared";
import { api } from "./api";

export const minesApi = {
  state: () => api<MinesStateDTO>("/v1/mines/state", { method: "POST", body: {} }),
  start: (input: { bet: number; size: number; mines: number; clientSeed: string }) =>
    api<MinesUpdateDTO>("/v1/mines/rounds", { method: "POST", body: input }),
  reveal: (roundId: string, tile: number, version: number) =>
    api<MinesUpdateDTO>(`/v1/mines/rounds/${encodeURIComponent(roundId)}/reveal`, {
      method: "POST",
      body: { tile, version },
    }),
  cashOut: (roundId: string, version: number) =>
    api<MinesUpdateDTO>(`/v1/mines/rounds/${encodeURIComponent(roundId)}/cashout`, {
      method: "POST",
      body: { version },
    }),
};

export const plinkoApi = {
  state: () => api<{ nextCommit: string }>("/v1/plinko/state", { method: "POST", body: {} }),
  drop: (input: { bet: number; rows: number; risk: PlinkoRisk; clientSeed: string }) =>
    api<PlinkoDropResultDTO>("/v1/plinko/drops", { method: "POST", body: input }),
};
