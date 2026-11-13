# busData.json: data licence

`busData.json` is derived from the **Unofficial BMTC GTFS** dataset by Vonter
(https://github.com/Vonter/bmtc-gtfs), which is built from data in the Namma BMTC app and
published under the **Open Database License (ODbL) v1.0**: https://opendatacommons.org/licenses/odbl/1-0/

As a derived database, `busData.json` is also released under the ODbL v1.0.

It was produced by `scripts/build-bus-data.py`. That script matches real BMTC stops to the game's nine
places, takes typical fares and service frequencies per route, and drops values that look like data
errors. The source data's timetables are unreliable, so travel times in the game come from the game's
own traffic model and are only scaled per bus type. This is game data: don't use it to plan a real trip.
