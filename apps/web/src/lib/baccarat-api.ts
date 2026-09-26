import type { BaccaratBets, BaccaratNextTableDTO, BaccaratTableDTO, BaccaratUpdateDTO } from "@snakeland/shared";
import { api } from "./api";

export const baccaratApi = {
  table: () => api<BaccaratTableDTO>("/v1/baccarat/table", { method: "POST", body: {} }),
  nextTable: () => api<BaccaratNextTableDTO>("/v1/baccarat/table/next", { method: "POST", body: {} }),
  play: (input: { tableId: string; bets: BaccaratBets; clientSeed?: string }) =>
    api<BaccaratUpdateDTO>("/v1/baccarat/rounds", { method: "POST", body: input }),
};
