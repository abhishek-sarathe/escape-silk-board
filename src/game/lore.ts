// Real-world colour for each place, for the narrator to draw on. Scenery only: none of it changes the game.
// Written in our own words from public reporting and commuter accounts of these junctions; no numbers,
// so the narrator's "only numbers from FACTS" rule still holds.
import { rngFor } from "./rng";
import type { GameState, LocationId } from "./types";

const PLACE_LORE: Record<LocationId, string[]> = {
  silk_board: [
    "The Central Silk Board office that gave the junction its name sits behind the flyover, ignored by everyone stuck in front of it.",
    "A double-decker flyover and metro pillars stand overhead; the jam simply continues underneath them.",
    "Navigation apps here show an arrival time that grows while you watch it.",
    "Regulars say this junction wins every poll for the worst signal in the city, and are oddly proud of it.",
  ],
  hsr: [
    "Agara Lake lies dark and calm beside the Outer Ring Road, which is neither.",
    "At the BDA Complex stop, people with trolley bags watch the road for the blue Vayu Vajra airport bus.",
    "Locals grumble that the new flyover at Silk Board only moved the traffic here.",
    "Café tables along the main road are full of people pitching apps that will fix traffic.",
  ],
  koramangala: [
    "Sony World signal: a landmark named after a showroom nobody remembers visiting.",
    "Pubs and breweries glow along the road, full of people who walked because parking was impossible.",
    "An ambulance from St John's Hospital noses through, and the traffic somehow finds room it never had for you.",
    "Delivery riders thread the gaps with insulated bags, the only things moving at speed.",
  ],
  marathahalli: [
    "Every tech park on the Outer Ring Road lets out at once onto this one bridge.",
    "Office cabs with company stickers stand nose to tail, their passengers still on calls.",
    "Andhra mess signboards promise unlimited meals to anyone who can reach the other side of the road.",
    "Saree showrooms blaze with light above a service road that has given up.",
  ],
  mg_road: [
    "The Metro's purple line glides overhead, on time, which feels personal.",
    "Brigade Road and Church Street glow off to one side, full of people with nowhere urgent to be.",
    "Cubbon Park is a dark block of trees, the only quiet thing for kilometres.",
    "Old Bengaluru shows here: wide pavements, stone buildings, and a signal every few metres.",
  ],
  kr_puram: [
    "The cable-stayed bridge is lit up against the sky; the bottleneck lives underneath it.",
    "At Tin Factory the queue of buses is the landmark now, more than the factory ever was.",
    "People cross from the railway station with suitcases, trusting the traffic to be too slow to hurt them.",
    "Two jams, one from each direction, meet here and become a single patient organism.",
  ],
  hebbal: [
    "Hebbal Lake is black below the flyover's loops.",
    "Every airport taxi in the city funnels into this one merge, each driver certain of his lane.",
    "Regulars count the minutes lost at this junction the way other cities count weather.",
    "A newly opened ramp curls overhead; the traffic has already filled it.",
  ],
  yelahanka: [
    "Ballari Road opens into six lanes, and drivers suddenly remember fifth gear.",
    "The Air Force station's fence runs along the road, a long dark line with warning boards.",
    "The elevated expressway lifts over the service-road chaos toward the toll gate.",
    "Airport signboards turn up at last, green and enormous and calm.",
  ],
  hennur: [
    "Kalyan Nagar's cafés and dosa joints line the Ring Road, busy with people who live on this side of the city for exactly this reason.",
    "The Hennur-Bagalur road heads north between new apartment towers and older villages the city has swallowed.",
    "Locals swear by this way to the airport and complain about it in the same breath.",
  ],
  hoskote: [
    "Old Madras Road opens up past the city: lorries, dhabas and the first dark fields.",
    "Hoskote's market lights give way to a quieter state highway heading north.",
    "Out here the airport's glow sits low on the horizon, further than it looks.",
  ],
  airport: [
    "The new terminal is all bamboo and hanging gardens, a forest built for people who are late.",
    "A line of blue Vayu Vajra buses idles at the kerb, doors open.",
    "The coffee here is priced like jewellery.",
    "Trolleys, farewells, and one family photographing every stage of a departure.",
  ],
};

const CITY_LORE = [
  "Old-timers still say 'one-and-a-half' for the fare above the meter; these days nobody mentions the meter at all.",
  "People in this city tell stories of leaving for the airport half a day early, out of fear.",
  "Everyone here has a story of a short hop that took longer than a train to another city.",
  "Somebody nearby is taking a work call from the back of an auto, laptop open.",
];

/** Two details for this turn: one of the place, one of the city. Seeded, so replays match. */
export function localColour(s: GameState): string[] {
  const rng = rngFor(s.seed, s.turn, "lore");
  const place = PLACE_LORE[s.location];
  return [place[Math.floor(rng() * place.length)], CITY_LORE[Math.floor(rng() * CITY_LORE.length)]];
}
