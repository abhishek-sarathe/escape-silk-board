import { describe, expect, it } from "vitest";
import { newGame } from "@/game/engine";
import { mixMoves } from "@/components/suggestions";
import { nextMoves } from "./tools";

describe("planned next moves (route planner, no AI)", () => {
  it("offers real first steps toward the airport from Silk Board", () => {
    const moves = nextMoves(newGame(4242))!;
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(3);
    for (const m of moves) expect(m).toMatch(/^(Take the|Book a|Find an auto|Walk to)/);
  });

  it("stays out of the way during a ride, a haggle or a decision", () => {
    const s = newGame(1);
    expect(nextMoves({ ...s, ride: { transport: "auto", destination: "hebbal" } })).toBeUndefined();
    expect(nextMoves({ ...s, quote: { destination: "airport", ask: 900, floor: 800, patience: 2 } })).toBeUndefined();
  });

  it("can differ by evening: surge pricing changes which ride is worth it", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) nextMoves(newGame(seed))?.forEach((m) => seen.add(m));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("mixing the move buttons", () => {
  const local = ["Keep going", "Buy a chai", "Ask a stranger", "Check the traffic", "Call my friend"];

  it("puts planned moves first and fills with local ideas", () => {
    expect(mixMoves(["Take the 500-D to Hennur (₹25)"], local, [])).toEqual(["Take the 500-D to Hennur (₹25)", ...local.slice(0, 3)]);
  });

  it("skips what was shown last turn when there is something new", () => {
    const out = mixMoves([], local, ["Keep going", "Buy a chai"], 3);
    expect(out).not.toContain("Keep going");
    expect(out).not.toContain("Buy a chai");
  });

  it("keeps the best planned move even if it was shown last turn", () => {
    expect(mixMoves(["Take the KIA-8 to Airport (₹270)"], local, ["Take the KIA-8 to Airport (₹270)"])[0]).toBe("Take the KIA-8 to Airport (₹270)");
  });
});
