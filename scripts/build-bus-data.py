"""Build src/game/busData.json from the unofficial BMTC GTFS feed.

Source: https://github.com/Vonter/bmtc-gtfs (ODbL-1.0), built from the Namma BMTC app.
The output is a derived database and is released under ODbL-1.0 too (see src/game/busData.LICENSE.md).

    curl -L -o bmtc.zip https://raw.githubusercontent.com/Vonter/bmtc-gtfs/main/gtfs/bmtc.zip
    python -I scripts/build-bus-data.py bmtc.zip src/game/map.ts src/game/busData.json

What it keeps, for every ordered pair of the game's places and every bus service between them:
  fare   the typical real fare (median, junk values dropped)
  wait   half the average gap between buses, from how many trips a day run
  lines  real route numbers, most frequent first, each with the places it passes on the way
Plus one speed factor per service: game road minutes are scaled by how fast that service runs
in the feed relative to the others. The feed's own timetables are unreliable, so its minutes
are only used relative to each other, never directly.
"""

import collections
import csv
import heapq
import io
import json
import math
import re
import statistics
import sys
import zipfile

ZIP, MAP_TS, OUT = sys.argv[1:4]

# Where each game place is in the real city: centre and radius in metres. Stops inside count as that place.
ANCHOR = {
    "silk_board": (12.9177, 77.6233, 450),
    "hsr": (12.9200, 77.6480, 1100),
    "koramangala": (12.9375, 77.6265, 700),
    "marathahalli": (12.9568, 77.7010, 700),
    "mg_road": (12.9754, 77.6080, 700),
    "kr_puram": (12.9975, 77.6720, 900),
    "hebbal": (13.0420, 77.5940, 900),
    "yelahanka": (13.1000, 77.5960, 1600),
    "hennur": (13.0300, 77.6380, 900),
    "hoskote": (13.0707, 77.7982, 1500),
    "airport": (13.1985, 77.7100, 1300),
}
# Stops that count as a place although they're outside its circle: Hoskote-side buses stop at the
# airport's back gate, not the terminals.
EXTRA_STOPS = {"airport": re.compile(r"Kempegowda International Airport Back Gate", re.I)}
GAME_BUS_SPEED = 1.15  # the game's old single airport bus speed; services are scaled around it
SERVICE_DAY_MINUTES = {"bus": 18 * 60, "ac_bus": 18 * 60, "airport_bus": 24 * 60}  # Vayu Vajra runs 24x7
MAX_LINES = 8
WAIT_RANGE = (2, 25)
SPEED_RANGE = (1.0, 1.5)
FARE_JUNK_FACTOR = 2.5  # a fare more than this times the median for the same leg is a data error


def service_of(route):
    """Ordinary BMTC -> bus, Vajra AC -> ac_bus, Vayu Vajra -> airport_bus."""
    kind = route["route_desc"].split(";")[-1].strip()
    name = route["route_short_name"].upper()
    # The route number is more reliable than the feed's label (it calls some V-500A trips "Vayu Vajra").
    if name.startswith("KIA"):
        return "airport_bus"
    if name.startswith(("V-", "VV")):
        return "ac_bus"
    if kind == "Vayu Vajra":
        return "airport_bus"
    if kind in ("Vajra", "Vajra Vistara"):
        return "ac_bus"
    if kind in ("Ordinary", "Ordinary Express", "Mobile ticketing"):
        return "bus"
    return None  # tourist and special services


def line_name(route):
    """'500-A BSK-BELF' -> '500-A', 'KIA-7A D25G-KIA' -> 'KIA-7A'. None if it doesn't look like a route number."""
    first = route["route_short_name"].split()[0].upper()
    return first if re.search(r"\d", first) else None


def metres(a, b, c, d):
    k = 111_320
    return math.hypot((a - c) * k, (b - d) * k * math.cos(math.radians(a)))


def game_edges():
    """Each road's 7 PM minutes, as the game computes them: empty-road minutes x the zone's traffic factor."""
    text = open(MAP_TS, encoding="utf-8").read()
    rules = open(MAP_TS.replace("map.ts", "rules.ts"), encoding="utf-8").read()
    factor = {z: float(f) for z, f in re.findall(r"(city|arterial|highway): ([\d.]+)", rules.split("TRAFFIC", 1)[1].split("};", 1)[0])}
    pat = r'\{ a: "(\w+)", b: "(\w+)", km: [\d.]+, free: (\d+), zone: "(\w+)"'
    return {(a, b): max(1, round(int(m) * factor[z])) for a, b, m, z in re.findall(pat, text)}


EDGES = game_edges()
ADJ = collections.defaultdict(dict)
for (a, b), m in EDGES.items():
    ADJ[a][b] = m
    ADJ[b][a] = m


def shortest(a, b):
    dist, prev, todo = {a: 0}, {}, [(0, a)]
    while todo:
        d, x = heapq.heappop(todo)
        if x == b:
            break
        for y, m in ADJ[x].items():
            if d + m < dist.get(y, math.inf):
                dist[y], prev[y] = d + m, x
                heapq.heappush(todo, (d + m, y))
    path = [b]
    while path[0] != a:
        path.insert(0, prev[path[0]])
    return path


def game_path(places):
    """Real stop order -> a walkable path on the game map (gaps filled by the shortest road)."""
    path = [places[0]]
    for nxt in places[1:]:
        path += shortest(path[-1], nxt)[1:]
    # Filling gaps can double back (MG Road -> Hennur -> KR Puram -> Hennur): cut any loop out.
    out = []
    for p in path:
        if p in out:
            out = out[: out.index(p)]
        out.append(p)
    return out


z = zipfile.ZipFile(ZIP)


def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))


feed = next(rows("feed_info.txt"))
place_of = {}
for s in rows("stops.txt"):
    if not s["stop_lat"]:
        continue
    lat, lon = float(s["stop_lat"]), float(s["stop_lon"])
    for place, pattern in EXTRA_STOPS.items():
        if pattern.search(s["stop_name"]):
            place_of[s["stop_id"]] = place
    for place, (a, b, r) in ANCHOR.items():
        if metres(lat, lon, a, b) <= r:
            place_of[s["stop_id"]] = place

routes = {r["route_id"]: r for r in rows("routes.txt")}
trips_per = collections.Counter()
rep = {}  # one representative trip per (route, direction)
for t in rows("trips.txt"):
    key = (t["route_id"], t["direction_id"])
    trips_per[key] += 1
    rep.setdefault(key, t["trip_id"])
want = {tid: key for key, tid in rep.items()}

seqs = collections.defaultdict(list)
for st in rows("stop_times.txt"):
    if st["trip_id"] in want:
        seqs[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], st["arrival_time"]))


def clock(t):
    h, m, s = map(int, t.split(":"))
    return h * 60 + m + s / 60


legs = []  # one per (route direction, from place, to place)
for tid, seq in seqs.items():
    route_id, direction = want[tid]
    route = routes[route_id]
    service, name = service_of(route), line_name(route)
    if not service or not name:
        continue
    seq.sort()
    first = {}
    for _, sid, at in seq:
        place = place_of.get(sid)
        if place and place not in first:
            first[place] = (sid, clock(at))
    order = list(first)
    for i, a in enumerate(order):
        for b in order[i + 1:]:
            legs.append({
                "from": a, "to": b, "service": service, "line": name, "route_id": route_id,
                "from_stop": first[a][0], "to_stop": first[b][0],
                "minutes": first[b][1] - first[a][1], "trips": trips_per[(route_id, direction)],
                "places": order[i:order.index(b) + 1],
            })

need = {(l["route_id"], l["from_stop"], l["to_stop"]) for l in legs}
price = {f["fare_id"]: float(f["price"]) for f in rows("fare_attributes.txt")}
fares = {}
for fr in rows("fare_rules.txt"):
    key = (fr["route_id"], fr["origin_id"], fr["destination_id"])
    if key in need:
        fares[key] = price[fr["fare_id"]]

grouped = collections.defaultdict(list)
further = collections.defaultdict(list)  # (route, boarding stop) -> [(places passed, fare)]
for leg in legs:
    leg["fare"] = fares.get((leg["route_id"], leg["from_stop"], leg["to_stop"]))
    if leg["fare"]:
        further[(leg["route_id"], leg["from_stop"])].append((len(leg["places"]), leg["fare"]))
estimated = 0
for leg in legs:
    # The feed has no fare for some legs (e.g. 280-F from Hoskote past the airport). Use the cheapest
    # fare the same bus charges from the same stop to somewhere further on: it can only overstate.
    if not leg["fare"]:
        longer = [f for n, f in further[(leg["route_id"], leg["from_stop"])] if n > len(leg["places"])]
        if longer:
            leg["fare"], leg["estimated"] = min(longer), True
            estimated += 1
    grouped[(leg["from"], leg["to"], leg["service"])].append(leg)


def clean_fare(values):
    values = [v for v in values if v]
    if not values:
        return None
    m = statistics.median(values)
    kept = [v for v in values if v <= FARE_JUNK_FACTOR * m]
    return int(round(statistics.median(kept)))


links = collections.defaultdict(dict)
dropped = collections.Counter()
feed_ratio = collections.defaultdict(list)  # service -> feed minutes / game minutes on single game edges
for (a, b, service), group in sorted(grouped.items()):
    fare = clean_fare([g["fare"] for g in group])
    if fare is None:
        dropped["no fare"] += 1
        continue
    by_line = {}
    for g in sorted(group, key=lambda g: -g["trips"]):
        by_line.setdefault(g["line"], g)  # the busiest variant of each line
    trips = sum(g["trips"] for g in group)
    wait = round(min(max(SERVICE_DAY_MINUTES[service] / max(trips, 1) / 2, WAIT_RANGE[0]), WAIT_RANGE[1]))
    # A route number should mean one kind of bus: AC lines are V-..., airport lines KIA-...
    prefix = {"ac_bus": ("V",), "airport_bus": ("KIA",)}.get(service)
    lines = sorted((g for g in by_line.values() if not prefix or g["line"].startswith(prefix)), key=lambda g: -g["trips"])
    if not lines:
        dropped["no matching line"] += 1
        continue
    links[f"{a}>{b}"][service] = {
        "fare": fare,
        "wait": wait,
        "lines": [{"name": g["line"], "path": game_path(g["places"])} for g in lines[:MAX_LINES]],
    }
    key = (a, b) if (a, b) in EDGES else (b, a) if (b, a) in EDGES else None
    if key:
        feed_ratio[service].append(statistics.median(g["minutes"] for g in group) / EDGES[key])

raw_speed = {s: statistics.median(v) for s, v in feed_ratio.items()}
mean = statistics.mean(raw_speed.values())
speed = {s: round(min(max(GAME_BUS_SPEED * v / mean, SPEED_RANGE[0]), SPEED_RANGE[1]), 2) for s, v in raw_speed.items()}

out = {
    "source": {
        "name": "Unofficial BMTC GTFS (Namma BMTC app data) by Vonter",
        "url": "https://github.com/Vonter/bmtc-gtfs",
        "license": "ODbL-1.0",
        "feed_version": feed["feed_version"],
    },
    "speed": speed,
    "links": dict(sorted(links.items())),
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    f.write("\n")

sys.stdout.reconfigure(encoding="utf-8")
print(f"feed {feed['feed_version']}: {len(links)} place pairs, {sum(len(v) for v in links.values())} services; {estimated} fares estimated; dropped {dict(dropped)}")
print("speed (raw feed min / game min -> game speed):", {s: (round(raw_speed[s], 2), speed[s]) for s in speed})
