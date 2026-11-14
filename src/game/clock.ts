import { CHECKIN_CLOSES } from "./rules";

const START_OF_GAME = 19 * 60; // 7:00 PM

export function formatClock(minutes: number): string {
  const total = START_OF_GAME + minutes;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** When check-in closes tonight: 8:55 PM, plus any minutes the counter agreed to hold for you. */
export const deadlineOf = (s: { grace?: number }) => CHECKIN_CLOSES + (s.grace ?? 0);

export function minutesLeft(minutes: number, grace = 0): number {
  return CHECKIN_CLOSES + grace - minutes;
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}
