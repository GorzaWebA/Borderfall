# Borderfall

A real-time world conquest strategy game that runs in your browser. Found a nation on an unclaimed world, grow it into an empire, and hold 70% of the land to win.

## Play

**[▶ Play Borderfall](https://gorzaweba.github.io/Strategy-game/)** — https://gorzaweba.github.io/Strategy-game/

No install, no account. Works on desktop and mobile browsers.

![A mid-game world with a dozen nations, the leaderboard, and the build dock](docs/screenshot.jpg)

## What you do

- **Expand.** Click land next to your border to send troops into it. Unclaimed land is cheap; enemy land costs troops based on how densely it's held, the terrain, and nearby fortresses.
- **Manage two resources.** Troops grow toward a cap set by your land and cities. Gold comes from land, cities and harbor trade. A slider trades troop growth for gold income.
- **Build.** Cities, barracks, fortresses, harbors, air defense and missile silos, each with a clear job.
- **Sail.** Click land across the water and a fleet carries your troops there to open a beachhead.
- **Strike.** Missiles wipe out troops and scorch land for a while. Air defense can shoot them down.
- **Negotiate.** Propose alliances, send gold to win favor, reinforce allies, or betray them at a cost. Nations remember who attacked them and gang up on whoever grows too big.

## Features

- Procedural worlds: Continents, Pangaea, Archipelago and Highlands, in three sizes. Share a seed to replay the same world.
- 3 to 40 AI rivals with distinct personalities (warlords, merchants, guardians, opportunists) and three difficulty levels.
- Six terrain types that change how fast fronts move, how costly land is, and how much it's worth.
- Pause and 1×, 2×, 4× speed.

## Controls

| Input | Action |
| --- | --- |
| Click | Attack, send a fleet, place a building, or fire a missile |
| Right-click / long-press | Options for that spot (build, alliance, gifts, missiles) |
| Drag, mouse wheel, pinch | Move and zoom the map |
| `1`–`6` | Choose a building to place (hold Shift to place several) |
| `M` | Aim a missile |
| `Q` / `E` | Lower or raise the share of troops sent per attack |
| `W` `A` `S` `D` / arrows | Pan the map |
| `Space` | Pause |
| `H` | Jump to your nation |
| `Esc` | Cancel |

## Buildings

| Building | Cost | What it does |
| --- | --- | --- |
| City | 1,000 | +10K troop cap, +12 gold/s |
| Barracks | 900 | Troops grow 20% faster, +4K troop cap |
| Fortress | 700 | Land within 9 tiles costs attackers double and falls half as fast |
| Harbor | 900 | Coast only. Earns trade gold from every harbor in the world, +2 fleets |
| Air Defense | 2,500 | Shoots down one enemy missile aimed within 22 tiles every 12s |
| Missile Silo | 5,000 | Launches missiles (20s reload) |

Each additional building of the same type costs more.

## Hosting on GitHub Pages

The game is plain HTML, CSS and JavaScript with no build step, so GitHub Pages serves it straight from the repository. One-time setup:

1. Make sure the game files are on the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick **`main`** and **`/ (root)`**, then **Save**.
4. After a minute or two the game is live at https://gorzaweba.github.io/Strategy-game/. Every push to `main` updates it.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Project layout

```
index.html      page structure, menus and HUD
style.css       interface styles
js/util.js      seeded random numbers, noise, colors, formatting
js/mapgen.js    procedural world generation and terrain
js/game.js      simulation: territory, combat, economy, fleets, missiles, diplomacy
js/ai.js        AI nations
js/render.js    canvas map renderer
js/ui.js        menus, HUD, input, tooltips
js/main.js      game loop
```
