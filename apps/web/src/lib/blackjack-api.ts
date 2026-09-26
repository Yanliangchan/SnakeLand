import type {
  BlackjackAction,
  BlackjackTableDTO,
  BlackjackUpdateDTO,
  NextTableDTO,
} from "@snakeland/shared";
import { api } from "./api";

export const blackjackApi = {
  table: () => api<BlackjackTableDTO>("/v1/blackjack/table", { method: "POST", body: {} }),
  nextTable: () => api<NextTableDTO>("/v1/blackjack/table/next", { method: "POST", body: {} }),
  deal: (input: { tableId: string; bet: number; clientSeed?: string }) =>
    api<BlackjackUpdateDTO>("/v1/blackjack/rounds", { method: "POST", body: input }),
  act: (roundId: string, action: BlackjackAction, version: number) =>
    api<BlackjackUpdateDTO>(`/v1/blackjack/rounds/${encodeURIComponent(roundId)}/actions`, {
      method: "POST",
      body: { action, version },
    }),
};
