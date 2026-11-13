// The player's own record, kept in their browser only. Missing or blocked storage just means no record.

export interface PlayerRecord {
  played: number;
  won: number;
  /** Most minutes to spare at the counter, across wins. */
  best: number | null;
}

const KEY = "escape-silk-board:record";
const EMPTY: PlayerRecord = { played: 0, won: 0, best: null };

export function readRecord(): PlayerRecord {
  try {
    const r = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (r && typeof r.played === "number" && typeof r.won === "number") return { ...EMPTY, ...r };
  } catch {
    // fall through
  }
  return EMPTY;
}

export function saveResult(won: boolean, spare: number): PlayerRecord {
  const prev = readRecord();
  const next: PlayerRecord = {
    played: prev.played + 1,
    won: prev.won + (won ? 1 : 0),
    best: won ? Math.max(prev.best ?? 0, spare) : prev.best,
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the record lasts for this page only
  }
  return next;
}
