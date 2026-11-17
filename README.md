# Borderfall

## ▶ [Play now: gorzaweba.github.io/Borderfall](https://gorzaweba.github.io/Borderfall/)

**https://gorzaweba.github.io/Borderfall/**

A real-time world conquest strategy game that runs in your browser, alone or with friends. Found a nation in the year 1500, carry it through the centuries with technology, population growth and politics, and hold 70% of the land to win.

No install, no account. Works on desktop and mobile browsers. New players can start with the built-in tutorial.

![A mid-game world with a dozen nations, the leaderboard, and the build dock](docs/screenshot.jpg)

## Two ways to play

| | Realistic | Blitz |
| --- | --- | --- |
| Calendar | 1500 to 2000, one year every 4.5 seconds | 1500 to 1700 |
| Technology | Each tech waits for its year and for the techs it builds on | Only needs the techs it builds on |
| Politics | Stability, administration, occupied land, revolts | None |
| Growth | Slower; fronts crawl until railroads and engines | Fast and aggressive |
| Ending | 70% of the land, or the largest nation in 2000 | 70% of the land, or the largest nation in 1700 |
| Typical length | 30–40 minutes | About 15 minutes |

## Maps

- **Random worlds:** Continents, Pangaea, Archipelago and Highlands, in four sizes up to Huge (576,000 tiles, room for 60 rival nations). Pick **Random** for a new world every game; the seed decides the world, so you can share one.
- **Real world:** World, Europe, Africa, The Americas, North America, South America, Oceania and Cyprus. These use real coastlines, with mountains, deserts, forests and tundra where they really are.
- **Competitive:** maps built from mirrored or rotated copies of one region, so every start has an identical twin.
  - **Mirror Strait:** two continents facing each other across a strait.
  - **Four Kingdoms:** four realms in two pairs around a contested island.
  - **Ring Sea:** six matching sectors around an inner sea.
  - **Twin Continents:** north and south joined by one mountainous isthmus.

## Multiplayer

- **Create lobby** gives you a 5-letter code and an invite link to share. Friends join with the code or by opening the link.
- **Quick match** joins an open public game in the same mode, or opens one that starts automatically 40 seconds after someone joins.
- Up to 8 people per match, with computer nations filling the world. The host picks the mode, map, rivals and difficulty, and everyone sees the changes live.

Players connect directly to each other (WebRTC), using public Nostr relays to find each other, so there is no game server to run. The host's browser runs the match: if the host leaves, the match ends; if anyone else drops out, the computer takes over their nation. Some strict networks (certain office, school or mobile networks) block direct connections; if joining fails, try another network.

## What you do

- **Expand.** Click land to send troops into it. Settling empty land is quick, and your border grows toward the spot you click. Enemy land costs troops based on how densely it's held, the terrain, and nearby fortresses.
- **Grow your people.** Population grows toward what your land and cities can feed. Only a share can serve as soldiers (8% in 1500, up to 23% by the World Wars); the rest work and pay taxes. Soldiers killed in battle are gone for good.
- **Manage your treasury.** Money comes in dollars at a realistic scale: you start with $1.2 million, a city costs $2 million, and a missile $8 million.
- **Research.** 28 technologies across six eras, from Military Drill and the Printing Press to Railroads, Machine Guns and Nuclear Fission. Click the year to open the tree and choose what comes next.
- **Keep order (Realistic).** Stability depends on your technology, how far you've outgrown your administration, occupied land, war losses, taxes and levies, and the size of your empire. Conquered land shows hatched until it integrates. Below 30 stability, restless regions break away as new nations. Declare martial law or hold a celebration when things get tense.
- **Build.** Cities, barracks, fortresses, harbors, universities, courthouses, factories, air defense and missile silos. Most unlock through technology.
- **Sail.** Click land across the water and a fleet carries your troops there to open a beachhead.
- **Strike.** Missiles wipe out troops and scorch land for a while. Air defense can shoot them down.
- **Negotiate.** Propose alliances, send money to win favor, reinforce allies, or betray them at a cost. Nations remember who attacked them and gang up on whoever grows too big.

## Features

- 3 to 60 AI rivals with distinct personalities (warlords, merchants, guardians, opportunists) and three difficulty levels.
- Six terrain types that change how fast fronts move, how costly land is, and how much it's worth.
- A guided tutorial for your first game.
- High and Low graphics. Low draws at 30 fps and native resolution with simpler effects, for phones and older computers.
- Pause and 1×, 2×, 4× speed in single player.

## Controls

| Input | Action |
| --- | --- |
| Click | Attack, send a fleet, place a building, or fire a missile |
| Right-click / long-press | Options for that spot (build, alliance, gifts, missiles) |
| Drag, mouse wheel, pinch | Move and zoom the map |
| `1`–`9` | Choose a building to place (hold Shift to place several) |
| `T` | Open the technology tree |
| `G` | Open government: stability, administration, policies (Realistic) |
| `M` | Aim a missile |
| `Q` / `E` | Lower or raise the share of troops sent per attack |
| `W` `A` `S` `D` / arrows | Pan the map |
| `Space` | Pause |
| `H` | Jump to your nation |
| `Esc` | Cancel |

## Buildings

| Building | Cost | Unlocked by | What it does |
| --- | --- | --- | --- |
| City | $2M | — | Houses 20K people, earns $20K/s, extends administration |
| Barracks | $1.8M | Military Drill | Recruiting +25%, 0.5% more people can serve |
| Fortress | $1.4M | — | Land within 9 tiles costs attackers double and falls half as fast |
| Harbor | $1.8M | — | Coast only. Trade income from every harbor in the world, +2 fleets |
| University | $2.2M | Printing Press | +4 research per second |
| Courthouse | $2.4M | Bureaucracy | Realistic only. Administers more land and brings it under control |
| Factory | $5M | Steam Power | Earns $50K/s, recruiting +15% |
| Air Defense | $5M | Radar | Shoots down one enemy missile aimed within 22 tiles every 12s |
| Missile Silo | $10M | Rocketry | Launches missiles (20s reload) |

Each additional building of the same type costs more.

## Hosting on GitHub Pages

The game is plain HTML, CSS and JavaScript with no build step, so GitHub Pages serves it straight from the repository. One-time setup:

1. Make sure the game files are on the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick **`main`** and **`/ (root)`**, then **Save**.
4. After a minute or two the game is live at https://gorzaweba.github.io/Borderfall/. Every push to `main` updates it.

## Run it locally

Serve the folder and open it in a browser (multiplayer needs a web server; single player also works from `index.html` directly):

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

To try multiplayer on one computer without the internet, open two tabs at `http://localhost:8000/?net=local`; they connect through the browser instead of the relays.

## Project layout

```
index.html      page structure, menus and HUD
style.css       interface styles
js/util.js      seeded random numbers, noise, colors, formatting
js/mapgen.js    procedural world generation and terrain
js/tech.js      game modes, eras and the technology tree
js/game.js      simulation: territory, combat, population, economy, technology,
                politics, fleets, missiles, diplomacy
js/ai.js        AI nations
js/render.js    canvas map renderer
js/ui.js        menus, HUD, input, tooltips
js/net.js       multiplayer: lobbies, quick match, host-run games
js/tutorial.js  guided first game
js/main.js      game loop
vendor/         bundled Trystero peer-to-peer library (MIT)
maps/*.js       real-world maps, one character per tile, loaded only when picked
```

## Map data

The real-world maps were generated from public-domain sources:

- Coastlines: [Natural Earth](https://www.naturalearthdata.com/), via the [world-atlas](https://github.com/topojson/world-atlas) package
- Elevation: NOAA ETOPO1 global relief
- Land cover: NASA Blue Marble imagery

The ETOPO1 and Blue Marble images come from the [basemap-data](https://pypi.org/project/basemap-data/) package. The Kyrenia range on the Cyprus map was added by hand, because it's too narrow for the source data.
