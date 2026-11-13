import { describe, expect, it } from "vitest";
import { MAX_WORDS, capLength } from "./narrator";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe("narration length cap", () => {
  const long =
    "You board the 281-AP bus and pay ₹40 for the ride. The rain is pouring and the bus takes 18 minutes to crawl from Hebbal to Yelahanka. " +
    "Kiran has already left you behind, so you're on your own now, machaa. The conductor hums an old film song the whole way there.";

  it("leaves short narration alone", () => {
    expect(capLength("Bike taxi booked for ₹243. Your rider weaves through the jam.", false)).toBe(
      "Bike taxi booked for ₹243. Your rider weaves through the jam.",
    );
  });

  it("cuts long narration at a sentence boundary, within the limit", () => {
    const out = capLength(long, false);
    expect(words(out)).toBeLessThanOrEqual(MAX_WORDS);
    expect(out.startsWith("You board the 281-AP bus and pay ₹40")).toBe(true);
    expect(out).toMatch(/[.!?]$/);
  });

  it("always keeps the last sentence when it carries a decision or the ending", () => {
    const withChoice = `${long} Share an auto for ₹60, or wait for the next bus?`;
    const out = capLength(withChoice, true);
    expect(out.endsWith("Share an auto for ₹60, or wait for the next bus?")).toBe(true);
    expect(out.startsWith("You board the 281-AP bus")).toBe(true);
  });
});
