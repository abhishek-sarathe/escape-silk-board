import { describe, expect, it } from "vitest";
import { newGame } from "@/game/engine";
import { openState, sealState } from "./stateToken";

describe("state token", () => {
  it("round-trips game state", () => {
    const state = newGame(42);
    expect(openState(sealState(state))).toEqual(state);
  });

  it("rejects a tampered token", () => {
    const token = sealState(newGame(42));
    const bytes = Buffer.from(token, "base64url");
    bytes[bytes.length - 1] ^= 1;
    expect(openState(bytes.toString("base64url"))).toBeNull();
  });

  it("rejects garbage", () => {
    expect(openState("not-a-token")).toBeNull();
  });
});
