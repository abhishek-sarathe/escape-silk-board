// Bengaluru's ways of getting around that aren't an option tonight, so asking for one gets an honest,
// local answer instead of being quietly turned into a bike taxi. Researched November 2026:
//  - Bounce ended its dockless scooter rentals in January 2023 (Autocar India); its battery-swap
//    stations carried on.
//  - Vogo, once Ola-backed, has been scaled down; one report says Chalo acquired it in 2022.
//  - Yulu's e-bikes are capped at 25 km/h and are parked back in Yulu zones.
//  - The Namma Metro Yellow Line (opened August 2025) stops at Central Silk Board but runs south, to
//    Electronic City. The Blue Line (58 km, Silk Board to the airport) is under construction: Silk Board
//    to KR Puram targeted around May-June 2027, the airport stretch later (no official BMRCL date).

export interface Gone {
  id: string;
  /** Words that mean the player is asking for it. */
  words: RegExp;
  /** What happens, as an engine fact (the narrator tells it). */
  fact: string;
  /** Minutes spent finding out. */
  minutes: number;
}

export const GONE: Gone[] = [
  {
    id: "bounce",
    words: /\bbounce\b/i,
    fact: "You open the Bounce app out of pure muscle memory. It stopped renting scooters back in 2023; only its battery-swap stations are left.",
    minutes: 2,
  },
  {
    id: "vogo",
    words: /\bvogo\b/i,
    fact: "You look for a Vogo scooter by the metro steps, the way you used to. That fleet quietly faded away years ago.",
    minutes: 2,
  },
  {
    id: "yulu",
    words: /\byulu\b/i,
    fact: "You find a Yulu e-bike at a dock. It tops out at 25 km/h and has to be parked back in a Yulu zone, so it's not getting you anywhere near the airport tonight.",
    minutes: 3,
  },
  {
    id: "metro",
    words: /\b(metro|namma metro|yellow line)\b/i,
    fact: "The Yellow Line metro does stop at Silk Board now, but it runs south to Electronic City: the wrong way. The Blue Line from Silk Board to the airport is still being built: its first stretch, to KR Puram, is due around mid-2027, and the airport after that.",
    minutes: 3,
  },
];

const REAL_RIDE = /\b(rapido|uber|ola|namma yatri|auto|rickshaw|cab|taxi|bike taxi|bus|bmtc|vajra|kia|walk)\b/i;

/**
 * The player asked for a service that isn't an option tonight, and the AI read it as something else
 * (a bike taxi, say): turn the move into "looking for it", so the engine tells the real story instead of
 * booking a ride they never asked for. A message that also names a real ride is left alone.
 */
export function redirectGone<A extends { kind: string; note: string }>(input: string, action: A): A {
  const gone = askedForGone(input);
  if (!gone || REAL_RIDE.test(input) || !["hire", "other", "impossible"].includes(action.kind)) return action;
  return { ...action, kind: "other", transport: null, destination: null, priceCheck: false, note: `look for a ${gone.id}` };
}

/** The first unavailable service the text asks for, if any. */
export function askedForGone(text: string): Gone | null {
  return GONE.find((g) => g.words.test(text)) ?? null;
}
