// The server is stateless: game state travels with the browser as an encrypted token (AES-256-GCM).
// Encryption means players can't read hidden values (the driver's floor price);
// the auth tag means they can't edit their cash or clock either.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { GameState } from "@/game/types";

let warned = false;

function key(): Buffer {
  let secret = process.env.STATE_SECRET?.trim();
  if (!secret) {
    if (!warned) console.warn("[state] STATE_SECRET is not set; using an insecure development secret.");
    warned = true;
    secret = "escape-silk-board-dev-secret";
  }
  return createHash("sha256").update(secret).digest();
}

export function sealState(state: GameState): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openState(token: string): GameState | null {
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const state = JSON.parse(json) as GameState;
    return state?.version === 1 ? state : null;
  } catch {
    return null;
  }
}
