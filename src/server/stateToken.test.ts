import { describe, expect, it, vi } from "vitest";
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

  it("refuses to run in production without STATE_SECRET", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STATE_SECRET", "");
    expect(() => sealState(newGame(42))).toThrow(/STATE_SECRET/);
    vi.stubEnv("STATE_SECRET", "a-real-secret");
    expect(openState(sealState(newGame(42)))).toEqual(newGame(42));
    vi.unstubAllEnvs();
  });

  it("rejects garbage", () => {
    expect(openState("not-a-token")).toBeNull();
  });
});
