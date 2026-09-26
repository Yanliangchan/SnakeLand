"use client";

import { useCallback, useState } from "react";

/**
 * Per-table identity for table games. "Next table" issues a new id; anything
 * keyed on it (felt contents, recent results, streak, shoe) is discarded,
 * while the wallet and lifetime stats live elsewhere and are untouched.
 */
export function useTable(initialTableId: string) {
  const [tableId, setTableId] = useState(initialTableId);
  const nextTable = useCallback(() => setTableId(crypto.randomUUID()), []);
  return { tableId, tableLabel: `Table ${tableId.slice(0, 4).toUpperCase()}`, nextTable };
}
