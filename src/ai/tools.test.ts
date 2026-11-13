import { describe, expect, it } from "vitest";
import { newGame } from "@/game/engine";
import { parseLocally } from "./localParser";
import { runLookup } from "./tools";

type Plan = { options: { steps: string[]; total_fare: number; makes_checkin: boolean }[] };

describe("agent tools", () => {
  it("plan_trip finds the cheap two-bus route a single-bus search misses", () => {
    const plan = runLookup(newGame(7), "plan_trip", { to: "airport", prefer: "cheapest" }) as Plan;
    const best = plan.options[0];
    expect(best.total_fare).toBeLessThan(385); // cheaper than the KIA-8 straight from Silk Board
    expect(best.steps).toHaveLength(2);
    expect(best.makes_checkin).toBe(true);
  });

  it("plan_trip never suggests something the player can't pay for", () => {
    const broke = { ...newGame(7), cash: 60, upi: 0, inventory: [] };
    const plan = runLookup(broke, "plan_trip", { prefer: "fastest" }) as Plan;
    for (const o of plan.options) expect(o.total_fare).toBeLessThanOrEqual(60);
  });

  it("bus_options can look from another place", () => {
    const r = JSON.stringify(runLookup(newGame(7), "bus_options", { from: "hennur", to: "airport" }));
    expect(r).toMatch(/293-AP/);
  });

  it("lookups are read-only", () => {
    const s = newGame(8);
    const before = structuredClone(s);
    for (const [name, args] of [["look_around", {}], ["plan_trip", { prefer: "cheapest" }], ["bus_options", {}], ["quote", { transport: "cab", to: "hebbal" }]] as const)
      runLookup(s, name, args);
    expect(s).toEqual(before);
  });

  it("the keyword fallback treats a question as asking, not doing", () => {
    expect(parseLocally(newGame(1), "how much is the bus from Hennur to the airport?")).toMatchObject({ kind: "other" });
    expect(parseLocally(newGame(1), "is there an auto here")).toMatchObject({ kind: "other" });
  });
});
