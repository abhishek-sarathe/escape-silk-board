import { describe, expect, it } from "vitest";
import { STRATEGIES, play, winRates } from "./balance";

describe("balance: a well-played evening is a coin flip", () => {
  const rates = winRates(200);
  const values = Object.values(rates);
  const average = values.reduce((a, b) => a + b, 0) / values.length;

  it("sensible players win about half the time on average", () => {
    // 45-65%: scripted players know good routes and rush straight to the counter, so they should win a
    // little more than first-time humans. Money, the phone and BMTC surprises take their share.
    expect(average).toBeGreaterThan(0.45);
    expect(average).toBeLessThan(0.65);
  });

  it("every kind of bus is a real option somewhere", () => {
    expect(rates["Bike taxi to Hebbal, then the ₹40 281-AP"]).toBeGreaterThan(0.5); // ordinary BMTC
    expect(rates["V-500D AC to Hennur, then a KIA bus"]).toBeGreaterThan(0.3); // Vajra AC + Vayu Vajra
    expect(rates["Bus to MG Road, then a KIA bus"]).toBeGreaterThan(0.5); // Vayu Vajra from the centre
  });

  it("no plan is a sure thing, and the KIA-8 from Silk Board is mostly a trap", () => {
    for (const [name, rate] of Object.entries(rates)) expect(rate, name).toBeLessThan(1);
    expect(rates["KIA-8 all the way from Silk Board"]).toBeLessThan(0.5); // the weakest bus plan; lifts and luck can save it
  });

  it("the same seed and the same plan always give the same evening", () => {
    const plan = STRATEGIES["Bike taxi to Hebbal, then a KIA bus"];
    expect(play(42, plan)).toEqual(play(42, plan));
  });
});
