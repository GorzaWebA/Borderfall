'use strict';
// Core simulation: territory, combat, population, economy, technology, politics,
// buildings, fleets, missiles and diplomacy.

const TPS = 10;                 // simulation ticks per second
const ATTACK_SPEED = 0.22;      // share of a front that tries to advance each tick
const NEUTRAL_COST = 3;         // troops per plains tile of unclaimed land
const NEUTRAL_SPEED = 0.75;     // settling is steady, so troops last instead of vanishing in a burst
const MAX_LEVEL = 5;            // buildings stack up to this level
const BLD_EARN = { city: 5, factory: 12.5 };  // earnings per level, before the income multiplier
// Trade: harbors earn from every foreign harbor that trades with them, and neighbours that both
// have a city, factory or harbor are joined by a road or railway across the border that pays
// both. Allies pay double.
const HARBOR_PARTNER_EARN = 0.8;   // per foreign harbor, up to 12 (and as much again for up to 8 allied ones)
const RAIL_LINK_EARN = 1.5;        // per neighbour linked across the border, up to RAIL_LINK_MAX
const RAIL_LINK_MAX = 6;
const TRADE_BAN_RESENTMENT = 20;   // how much a nation's opinion of you drops when you stop trading with it
const HARBOR_SNAP = 25;            // a harbor placed inland goes to the nearest coast within this many tiles
const RP_PRICE = 4000;          // dollars of research budget per research point
const TECH_KNOWN_COST = 0.065;  // each known technology raises the cost of the next by 6.5%
const TRIBE_NAMES = ['Ash Clan', 'Bramble Folk', 'Cinder Kin', 'Dune Riders', 'Elk Clan', 'Fen Dwellers', 'Grey Wolves',
  'Hearth Clan', 'Iron Hills', 'Juniper Folk', 'Kestrel Clan', 'Lake People', 'Moss Clan', 'Night Herders', 'Oak Clan',
  'Pine Folk', 'Quarry Clan', 'River Clan', 'Salt Clan', 'Thorn Clan', 'Umber Folk', 'Vale Clan', 'Willow Folk', 'Yew Clan',
  'Amber Clan', 'Boar Clan', 'Crow Clan', 'Deer Clan', 'Eagle Clan', 'Fox Clan', 'Hawk Clan', 'Lynx Clan', 'Otter Clan',
  'Ram Clan', 'Stag Clan', 'Swan Clan', 'Wren Clan', 'Bear Clan', 'Heron Clan', 'Viper Clan'];
const MONEY = 2000;             // dollars per old gold unit: a city costs about $2 million
const START_TROOPS = 2500;
const START_GOLD = 600 * MONEY;
const START_POP = 30000;
const POP_PER_VALUE = 250;      // people a fully controlled plains tile can feed
const CITY_POP = 20000;
const CAPITAL_POP = 10000;
const SPAWN_RADIUS = 5;
// The placement phase before a war: players pick (and may move) their starting spots while the
// computer nations shift theirs now and then, holding still for the last few seconds.
const PLACE_SECONDS = 15;          // single player
const PLACE_SETTLE = 4;            // seconds at the end when computer nations no longer move
const PLACE_MOVES = 2;             // most times one computer nation moves
const PLACE_MOVE_CHANCE = 0.06;    // chance each second that a computer nation moves
const PRE_START_COMMANDS = new Set(['spawn', 'research', 'focus', 'science']);
const WIN_SHARE = 0.7;
// How a relation reads in a sentence ("They feel wary toward you").
function relWord(v) { return v >= 40 ? 'friendly' : v >= 10 ? 'warm' : v > -10 ? 'neutral' : v > -40 ? 'wary' : 'hostile'; }
// Below this share of the troop limit, sending more troops away brings a warning.
const LOW_TROOPS = 0.15;
// Tribes: troops at most TRIBE_TROOPS plus a few per tile, and their stores fill at half the rate.
const TRIBE_TROOPS = 800;
const TRIBE_TROOPS_PER_TILE = 2.5;
const TRIBE_INCOME = 0.5;
// Stability from recent victories, at most; it fades by 0.08 a second.
const GLORY_MAX = 12;
// A nation or tribe beaten down to a scrap of its former size surrenders the rest to whoever has
// been taking its land, so nobody has to hunt down the last few pixels. Shares of its peak size:
const REMNANT_SHARE = { tribe: 0.3, nation: 0.05, human: 0.03 };
const REMNANT_MIN = 10;           // tiles: anything this small surrenders whatever its peak
const REMNANT_MAX = { tribe: 50, nation: 120, human: 50 };
const REMNANT_SECONDS = 20;       // the conqueror must have taken a tile from it this recently
const TREATY_AT = [0.8, 0.92];   // shares of the calendar when a general peace is proposed
const TREATY_SECONDS = 40;        // how long the proposal stays open
const SHIP_SPEED = 0.2;         // tiles per tick: 2 tiles a second before naval technology
const LANDING_TICKS = 15;       // a fleet rides at anchor for 1.5s before its troops go ashore
const MISSILE_BASE_COST = 4000 * MONEY;
const MISSILE_R_IN = 6;
const MISSILE_R_OUT = 12;
const FALLOUT_SECONDS = 35;
const BUILD_SPACING = 3;        // Chebyshev distance kept clear around buildings
const REBEL_SLOTS = 10;         // extra nation slots for breakaway states
// Every building brings order to the land around it, cities and courthouses most of all.
const ADMIN_RADIUS = { capital: 30, city: 18, courthouse: 34, fort: 16, barracks: 10, harbor: 10, university: 12, factory: 12, aa: 8, silo: 6 };
const PACIFY_RADIUS = 7;          // a finished building settles the land this close at once
// Seconds a building takes to go up; each level of an upgrade takes a quarter longer.
const BUILD_SECONDS = { city: 10, barracks: 6, fort: 8, harbor: 10, university: 12, courthouse: 12, factory: 15, aa: 10, silo: 20 };
const DEMOLISH_REFUND = 0.25;     // share of a building's base price paid back per level
const ALLIANCE_SECONDS = 300;     // alliances lapse after five minutes unless renewed
const RENEW_SECONDS = 120;        // an alliance can be renewed in its last two minutes
const TAX_RELIEF_INCOME = 0.75;   // income while tax relief is in force
const REVOLT_BELOW = 30;

// Silos and air defenses hold one shot per level and reload them one at a time. Each level also
// reaches further: a silo's missiles fly further, an air defense covers a wider circle.
const SILO_RELOAD = 20 * TPS;
const AA_RELOAD = 12 * TPS;
const SILO_RANGE = 90, SILO_RANGE_STEP = 45;
const AA_RADIUS = 22, AA_RADIUS_STEP = 5;
// Space missiles: launched from a silo of level 2 or more, they reach anywhere and pass over every
// air defense while in space; only defenses near the launch or the landing can shoot them down.
const SPACE_SILO_LEVEL = 2;
const SPACE_COST_MULT = 3;
const SPACE_EXPOSED = 0.15;        // share of the flight at each end within reach of air defense
const BUILDINGS = {
  city: { name: 'City', base: 1000 * MONEY, step: 650 * MONEY, key: '1', desc: 'Houses 20K people, earns $600K/min and extends your administration.' },
  barracks: { name: 'Barracks', base: 900 * MONEY, step: 500 * MONEY, key: '2', tech: 'drill', desc: 'Recruiting +25%. 0.5% more of your people can serve.' },
  fort: { name: 'Fortress', base: 700 * MONEY, step: 350 * MONEY, key: '3', radius: 9, desc: 'Land within 9 tiles costs attackers double and falls half as fast.' },
  harbor: { name: 'Harbor', base: 900 * MONEY, step: 450 * MONEY, key: '4', coastal: true, desc: 'Goes on the nearest coast. Earns trade income from the harbors of every nation that trades with you, double from allies. +2 fleets.' },
  university: { name: 'University', base: 1100 * MONEY, step: 600 * MONEY, key: '5', tech: 'printing', desc: '+2 research per second.' },
  courthouse: { name: 'Courthouse', base: 1200 * MONEY, step: 700 * MONEY, key: '6', tech: 'bureaucracy', politics: true, desc: 'Administers 350 more tiles and brings land within 34 tiles under full control.' },
  factory: { name: 'Factory', base: 2500 * MONEY, step: 1200 * MONEY, key: '7', tech: 'steam', desc: 'Earns $1.5M/min. Recruiting +15%.' },
  aa: { name: 'Air Defense', base: 2500 * MONEY, step: 1250 * MONEY, key: '8', tech: 'radar', radius: AA_RADIUS, desc: `Shoots down missiles flying at you or your allies within ${AA_RADIUS} tiles (+${AA_RADIUS_STEP} a level). One shot a level; reloads one every 12s.` },
  silo: { name: 'Missile Silo', base: 5000 * MONEY, step: 2500 * MONEY, key: '9', tech: 'rocketry', desc: `Launches missiles up to ${SILO_RANGE} tiles (+${SILO_RANGE_STEP} a level) that wipe out troops and scorch land. One missile a level; reloads one every 20s. Level ${SPACE_SILO_LEVEL} and up launch space missiles.` },
};
const BUILD_ORDER = ['city', 'barracks', 'fort', 'harbor', 'university', 'courthouse', 'factory', 'aa', 'silo'];

class Player {
  constructor(id, name, color, human) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.human = human;
    this.alive = true;
    this.spawned = false;
    this.troops = 0;
    this.gold = 0;
    this.tiles = 0;
    this.value = 0;                 // raw land value
    this.effValue = 0;              // land value weighted by control
    this.focus = 0.5;               // 0 = all army, 1 = all economy
    this.counts = {};
    this.pending = {};              // buildings under construction, by type
    for (const k of BUILD_ORDER) { this.counts[k] = 0; this.pending[k] = 0; }
    this.blds = [];
    this.allies = new Set();
    this.bbox = [1e9, 1e9, -1, -1];
    this.label = { x: 0, y: 0, size: 0, tile: -1 };
    this.traitorUntil = -1;
    this.missilesLaunched = 0;
    this.growth = 0;
    this.income = 0;
    this.diffMult = 1;
    this.coastal = 0;
    this.peakTiles = 0;
    this.kills = 0;
    this.ai = null;
    this.eliminatedAt = -1;
    this.lastHitBy = 0;             // who last took a tile from this nation, and when
    this.lastHitAt = -1e9;
    // Population
    this.pop = 0;
    this.popCap = 0;
    this.popGrowth = 0;
    this.field = 0;                 // troops out on attacks and fleets
    // Technology
    this.mods = defaultMods();
    this.techs = new Set();
    this.research = null;
    this.progress = {};
    this.rpRate = 0;
    // Politics
    this.capital = -1;
    this.stability = 65;
    this.stabTarget = 65;
    this.stabFactors = [];
    this.avgControl = 100;
    this.adminCap = 0;
    this.martial = false;
    this.boost = 0;
    this.shock = 0;
    this.weariness = 0;
    this.glory = 0;                 // recent victories: land, capitals and nations taken in war
    this.celebrateReadyAt = 0;
    this.rebelOf = 0;
    this.unrestWarnedAt = -1e9;
    this.unrest = -1;               // the tile where unrest is worst, if a revolt is brewing
    this.taxRelief = false;
    this.tradeHarbors = 0;          // harbors of nations that trade with this one
    this.allyHarbors = 0;           // ...of which allied
    this.railLinks = [];            // neighbours joined to this one by road or rail across the border
    this.tradeBan = new Set();      // nations this one has stopped trading with
    this.peer = null;              // multiplayer peer id for remote humans
    this.tribe = false;
    this.science = 0.2;            // share of income spent on research
    this.researchSpend = 0;
    // Ideology
    this.ideology = null;          // IDEOLOGIES id
    this.ideologyAt = -1e9;        // game time of the last change
    this.doctrines = new Set();    // DOCTRINE_BY_ID keys
    this.ideoStab = 0;             // stability from ideology and doctrines, shown on its own line
  }
}

class Game {
  constructor(map, settings) {
    this.map = map;
    this.W = map.W; this.H = map.H; this.N = map.N;
    this.settings = settings;
    this.modeKey = MODES[settings.mode] ? settings.mode : 'blitz';
    this.mode = MODES[this.modeKey];
    this.rng = makeRng((map.seed ^ 0x5bd1e995) >>> 0);
    this.owner = new Uint16Array(this.N);
    this.bldAt = new Int32Array(this.N).fill(-1);
    this.fallout = new Uint8Array(this.N);
    this.control = new Uint8Array(this.N);
    this.adminSlack = new Int8Array(this.N).fill(-128);
    this._buckets = [];
    this.falloutList = [];
    this.players = [null];
    this.buildings = [];
    this.sites = [];                // buildings under construction
    this.allyUntil = new Map();     // alliance pair key -> tick it lapses
    this.allyWarned = new Set();    // alliances whose players were told they end in a minute
    this.attacks = [];
    this.ships = [];
    this.missiles = [];
    this.effects = [];
    this.tick = 0;
    this.events = [];
    this.eventSeq = 0;
    this.requests = [];
    this.reqCooldown = new Map();
    this.trackDirty = true;
    this.dirty = new Uint8Array(this.N);
    this.dirtyList = [];
    this.neighbors = [];
    this.distField = new Float32Array(this.N);
    this.over = null;
    this.coached = false;           // a tutorial: it ends with the lesson, never with a win at 70%
    this.started = false;
    this.placement = !!settings.placement;   // single player: a countdown to pick and move a starting spot
    this.placeAcc = 0;
    this.idSeq = 1;
    this.totalHarbors = 0;
    this.bfsStamp = new Uint32Array(this.N);
    this.stamp = 0;
    this.bfsParent = new Int32Array(this.N);
    this.bfsQueue = new Int32Array(this.N);
    this._deferred = [];
    this.rel = null;
    this.P = 0;
    this.lastEra = 0;
    this.announced = new Set();
    this.treaty = null;              // the general peace proposed near the end, see updateTreaty
    this.treatyRound = 0;
    this.spareNames = [];
    this.spareColors = [];
    this.unrestWarnedAt = -1e9;
    this.adminScale = Math.max(0.6, map.landCount / 60000);
    this.multiplayer = !!settings.multiplayer;
    this.net = null;               // host-side change log for multiplayer
  }

  // Host-side change log; the multiplayer host drains it into network packets.
  enableNetLog() {
    this.net = { own: [], ctl: [], fo: [], bld: new Set(), ships: [], missiles: [], fx: [] };
  }

  get time() { return this.tick / TPS; }
  get human() { return this.players[1]; }
  get year() { return START_YEAR + Math.floor(this.time / this.mode.secPerYear); }
  get politics() { return this.mode.politics; }

  // ---------- setup ----------
  setupPlayers(opts) {
    const rng = this.rng;
    // opts.humans: [{name, color, peer}] for multiplayer; otherwise a single local human.
    const humans = opts.humans || [{ name: opts.playerName || 'You', color: opts.playerColor, skin: opts.playerSkin }];
    for (const h of humans) {
      const p = new Player(this.players.length, h.name, h.color, true);
      p.peer = h.peer || null;
      p.skin = h.skin || 'plain';   // land pattern from the shop
      this.players.push(p);
    }
    const human = this.players[1];
    const used = new Set(humans.map((h) => h.name));
    const names = rng.shuffle(NATION_NAMES.filter((n) => !used.has(n)));
    const colors = [];
    const hueStart = rng() * 360;
    const need = opts.numAI + REBEL_SLOTS;
    for (let i = 0; colors.length < need && i < 600; i++) {
      const h = hueStart + i * 137.508;
      // Atlas tints: clear but not neon, so the terrain still reads through them.
      const s = 0.38 + (i % 3) * 0.1;
      const l = 0.45 + ((i >> 1) % 3) * 0.07;
      const c = hslToRgb(h, s, l);
      if (humans.some((h) => colorDistance(c, h.color) < 40)) continue;
      colors.push(c);
    }
    const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.diff = diff;
    for (let k = 0; k < opts.numAI; k++) {
      const p = new Player(this.players.length, names[k % names.length], colors[k % colors.length], false);
      p.diffMult = diff.econ;
      p.ai = new AIController(this, p, PERSONALITIES[rng.int(PERSONALITIES.length)], diff);
      this.players.push(p);
    }
    const tribeNames = rng.shuffle(TRIBE_NAMES.slice());
    for (let k = 0; k < (opts.numTribes || 0); k++) {
      const hue = rng() * 360;
      // Tribes are grey, a shade lighter or darker each, so they never pass for nations.
      const p = new Player(this.players.length, tribeNames[k % tribeNames.length], hslToRgb(hue, 0.05, 0.4 + rng() * 0.2), false);
      p.tribe = true;
      p.diffMult = 0.6;
      p.science = 0;
      p.ai = new TribeAI(this, p);
      this.players.push(p);
    }
    this.fixedSpawns = opts.spawns || null;   // tiles for the computer players, nations first (the tutorial)
    this.spareNames = names.slice(opts.numAI);
    this.spareColors = colors.slice(opts.numAI);
    this.P = this.players.length + REBEL_SLOTS;
    this.rel = new Float32Array(this.P * this.P);
    for (let i = 0; i < this.rel.length; i++) this.rel[i] = rng.range(-5, 25);
    this.neighbors = [];
    for (let i = 0; i < this.P; i++) this.neighbors.push(new Map());
    for (const p of this.players) if (p) this.initPlayer(p);
    this.spawnAIs();
  }

  initPlayer(p) {
    p.mods = defaultMods();
    if (!this.politics) p.mods.mobil += 0.04;
  }

  spawnAIs() {
    const rng = this.rng, W = this.W, T = this.map.terrain;
    // Nations first so they get the roomiest spots; tribes fill the gaps.
    const ais = this.players.filter((p) => p && !p.human).sort((a, b) => a.tribe - b.tribe);
    if (this.fixedSpawns) {
      ais.forEach((p, k) => { const t = this.fixedSpawns[k]; if (t !== undefined && this.canSpawnAt(t)) this.claimSpawn(p, t); else p.alive = false; });
      return;
    }
    let minDist = Math.sqrt(this.map.landCount / (ais.length + 1)) * 0.75;
    const placed = [];
    for (const p of ais) {
      let done = false;
      for (let attempt = 0; attempt < 4000 && !done; attempt++) {
        if (attempt > 0 && attempt % 800 === 0) minDist *= 0.8;
        const i = rng.int(this.N);
        const t = T[i];
        if (t <= T_SEA || t === T_MOUNTAIN || this.owner[i]) continue;
        // Prefer fertile ground; accept harsher land only if nothing else fits.
        if (attempt < 2400 && (t === T_TUNDRA || t === T_DESERT)) continue;
        const x = i % W, y = (i - x) / W;
        let ok = true;
        for (const q of placed) {
          const dx = q[0] - x, dy = q[1] - y;
          if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
        }
        if (!ok) continue;
        this.claimSpawn(p, i);
        if (!p.tribe) placed.push([x, y]);
        done = true;
      }
      if (!done) { p.alive = false; }
    }
  }

  canSpawnAt(i) {
    if (i < 0 || i >= this.N) return false;
    return this.map.terrain[i] > T_SEA && this.owner[i] === 0;
  }

  claimSpawn(p, i) {
    const W = this.W, H = this.H, x0 = i % W, y0 = (i - x0) / W;
    const r = p.tribe ? 3 : SPAWN_RADIUS;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = y * W + x;
        if (this.map.terrain[t] > T_SEA && this.owner[t] === 0) {
          this.setOwner(t, p.id);
          this.setControl(t, 100);
        }
      }
    }
    // Tribes are weak but sit on a store of treasure that goes to whoever absorbs them.
    p.troops = p.tribe ? 550 : START_TROOPS;
    p.gold = p.tribe ? (900 + this.rng.int(1300)) * MONEY : START_GOLD + (p.tutorialBonus ? 1500 * MONEY : 0);
    p.pop = p.tribe ? 9000 : START_POP;
    p.spawned = true;
    p.capital = i;
    p.label = { x: x0 + 0.5, y: y0 + 0.5, size: 3, tile: i };
  }

  // Lift a nation's starting land during the placement phase, so it can be founded elsewhere.
  // (Not through setOwner, which would count the empty nation as destroyed.)
  unclaimSpawn(p) {
    const own = this.owner;
    for (let t = 0; t < this.N; t++) {
      if (own[t] !== p.id) continue;
      own[t] = 0;
      this.control[t] = 0;
      this.markDirtyAround(t);
      if (this.net) this.net.own.push(t, 0);
    }
    p.tiles = 0; p.value = 0; p.effValue = 0; p.peakTiles = 0;
    p.bbox = [1e9, 1e9, -1, -1];
    p.spawned = false;
  }

  spawnHuman(i) { return this.spawnPlayer(1, i); }

  spawnPlayer(pid, i) {
    const p = this.players[pid];
    if (!p || i < 0 || i >= this.N || this.isWater(i)) return false;
    // Until the war begins, a player may move their starting spot.
    if (p.spawned) {
      if (this.started || (this.owner[i] && this.owner[i] !== pid)) return false;
      this.unclaimSpawn(p);
    }
    if (!this.canSpawnAt(i)) return false;
    this.claimSpawn(p, i);
    if (!p.founded) {
      p.founded = true;
      this.log(`Your nation is founded. Click empty land to expand toward it.`, 'good', pid);
      if (this.mode.endYear) {
        this.log(`The game ends in ${this.mode.endYear}, about ${this.mode.minutes} minutes from now. Hold 70% of the land before then, or be the largest nation when it ends.`, 'info', pid);
      }
    }
    if (!this.multiplayer && !this.placement) this.begin();
    else { this.scanNeighbors(); this.computeLabels(); }
    return true;
  }

  // The placement phase, called with the seconds passed and the seconds left: now and then a
  // computer nation moves its starting spot, as a player in a lobby would, until the last
  // few seconds.
  placementTick(dt, left) {
    if (this.started) return;
    this.placeAcc += dt;
    let moved = false;
    while (this.placeAcc >= 1) {
      this.placeAcc -= 1;
      if (left <= PLACE_SETTLE) continue;
      for (const p of this.players) {
        if (!p || p.human || p.tribe || !p.alive || !p.spawned || (p.moves || 0) >= PLACE_MOVES) continue;
        if (this.rng() < PLACE_MOVE_CHANCE && this.relocateNation(p)) { p.moves = (p.moves || 0) + 1; moved = true; }
      }
    }
    if (moved) { this.scanNeighbors(); this.computeLabels(); }
  }

  // A new starting spot for a computer nation: fertile, unclaimed land clear of the other
  // nations and of the players.
  relocateNation(p) {
    const rng = this.rng, W = this.W, T = this.map.terrain;
    const others = this.players.filter((q) => q && q !== p && q.spawned && q.alive && !q.tribe).map((q) => [q.label.x, q.label.y]);
    let minDist = Math.sqrt(this.map.landCount / (others.length + 2)) * 0.75;
    for (let attempt = 0; attempt < 1500; attempt++) {
      if (attempt > 0 && attempt % 500 === 0) minDist *= 0.8;
      const i = rng.int(this.N), t = T[i];
      if (t <= T_SEA || t === T_MOUNTAIN || this.owner[i]) continue;
      if (attempt < 1000 && (t === T_TUNDRA || t === T_DESERT)) continue;
      const x = i % W + 0.5, y = (i - (i % W)) / W + 0.5;
      if (others.some(([ox, oy]) => (ox - x) * (ox - x) + (oy - y) * (oy - y) < minDist * minDist)) continue;
      this.unclaimSpawn(p);
      this.claimSpawn(p, i);
      return true;
    }
    return false;
  }

  // Place any human who hasn't picked a spot yet, then start the clock.
  begin() {
    for (const p of this.players) {
      if (!p || !p.human || p.spawned) continue;
      for (let k = 0; k < 20000; k++) {
        const i = this.rng.int(this.N);
        const t = this.map.terrain[i];
        if (this.canSpawnAt(i) && t !== T_MOUNTAIN && (k > 8000 || (t !== T_TUNDRA && t !== T_DESERT))) { this.spawnPlayer(p.id, i); break; }
      }
    }
    this.started = true;
    this.scanNeighbors();
    this.computeLabels();
    if (this.politics) this.computeAdmin();
  }

  // ---------- helpers ----------
  isWater(i) { return this.map.terrain[i] <= T_SEA; }
  isAllied(a, b) { return a > 0 && b > 0 && a !== b && this.players[a].allies.has(b); }
  // Allies never attack each other.
  isFriendly(a, b) { return this.isAllied(a, b); }
  // The other nations (not tribes) fighting a nation right now, by land or with a fleet on its way.
  attackersOf(qId, except = 0) {
    const s = new Set();
    for (const a of this.attacks) {
      if (!a.dead && a.target === qId && a.attacker !== except && !this.players[a.attacker].tribe) s.add(a.attacker);
    }
    for (const sh of this.ships) {
      if (!sh.dead && sh.target === qId && sh.owner !== except && !this.players[sh.owner].tribe) s.add(sh.owner);
    }
    return s;
  }
  // The ally of pId that qId is attacking, if any: the war pId would join to defend a friend.
  allyUnderAttack(pId, qId) {
    const P = this.players[pId];
    if (!P || !P.allies.size) return 0;
    for (const a of this.attacks) if (!a.dead && a.attacker === qId && P.allies.has(a.target)) return a.target;
    return 0;
  }
  // ", Altuq's ally," when the attacker is defending a friend the target is at war with.
  allyNote(aId, tId) {
    const f = this.allyUnderAttack(aId, tId);
    return f ? `, ${this.players[f].name}'s ally,` : '';
  }
  // When a nation is attacked, its allies take it badly; the attacker hears who might join in.
  angerAllies(aId, tId) {
    const D = this.players[tId], A = this.players[aId];
    if (!D || D.tribe || !D.allies.size) return;
    const names = [];
    for (const k of D.allies) {
      if (k === aId) continue;
      // Resentment only goes so far on a friend's behalf: wary, not hostile.
      if (this.getRel(k, aId) > -30) this.addRel(k, aId, -6);
      names.push(this.players[k].name);
    }
    if (!A.human || !names.length) return;
    A.alliesWarned = A.alliesWarned || new Map();
    if (this.time - (A.alliesWarned.get(tId) ?? -1e9) < 90) return;
    A.alliesWarned.set(tId, this.time);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    this.log(`${D.name} is allied with ${list}. ${names.length > 1 ? 'They' : 'It'} may come to its defense.`, 'warn', aId, null, { alert: 'allies', who: tId });
  }
  isTarget(i, t) {
    return this.owner[i] === t && (t !== 0 || (this.map.terrain[i] > T_SEA && this.fallout[i] === 0));
  }
  getRel(i, j) { return this.rel[i * this.P + j]; }
  addRel(i, j, d) {
    if (i === j || !i || !j) return;
    const k = i * this.P + j;
    this.rel[k] = clamp(this.rel[k] + d, -100, 100);
  }
  markDirty(i) {
    if (!this.trackDirty) return;
    if (!this.dirty[i]) { this.dirty[i] = 1; this.dirtyList.push(i); }
  }
  // The renderer paints a two-tile colour band inside every border, so an ownership change
  // repaints every tile within two steps of it.
  markDirtyAround(i) {
    if (!this.trackDirty) return;
    const W = this.W, N = this.N, x = i % W;
    for (let dy = -2; dy <= 2; dy++) {
      const r = 2 - Math.abs(dy);
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, j = i + dy * W + dx;
        if (xx >= 0 && xx < W && j >= 0 && j < N) this.markDirty(j);
      }
    }
  }
  // to: 0 for everyone or a player id; skip: player ids who get their own version. extra marks
  // messages that also raise an alert card: { alert: its type (see ALERTS in ui.js), at: a tile
  // to show, who: the other nation involved }.
  log(text, kind = 'info', to = 0, skip = null, extra = null) {
    const x = extra || {};
    this.events.push({ id: ++this.eventSeq, text, kind, time: this.time, to, skip, at: x.at === undefined ? -1 : x.at, alert: x.alert || '', who: x.who || 0 });
    if (this.events.length > 200) this.events.shift();
  }
  humans() { return this.players.filter((p) => p && p.human); }
  controlFactor(c) { return 0.3 + 0.007 * c; }
  setControl(t, c) {
    const o = this.owner[t];
    const old = this.control[t];
    if (o) {
      const v = T_VALUE[this.map.terrain[t]];
      this.players[o].effValue += v * (this.controlFactor(c) - this.controlFactor(old));
    }
    if ((old < 50) !== (c < 50)) { this.markDirty(t); if (this.net) this.net.ctl.push(t, c); }
    this.control[t] = c;
  }
  stabFactor(p) { return this.politics ? 0.6 + 0.8 * p.stability / 100 : 1; }
  // Dollars per second per unit of earnings, after focus, technology, stability and martial law.
  incomeMult(p) {
    return MONEY * (0.4 + 1.2 * p.focus) * (1 + p.mods.gold) * this.stabFactor(p) * (p.martial ? 0.75 : 1) *
      (p.taxRelief ? TAX_RELIEF_INCOME : 1) * (p.diffMult || 1) * (p.tribe ? TRIBE_INCOME : 1);
  }
  // A harbor earns a little on its own and more for every foreign harbor that trades with it;
  // allied harbors pay double.
  harborEarn(p) {
    return (3 + HARBOR_PARTNER_EARN * (Math.min(12, p.tradeHarbors || 0) + Math.min(8, p.allyHarbors || 0))) * (1 + p.mods.trade);
  }
  // Roads and railways across the border to trading neighbours; allies pay double.
  railEarn(p) {
    const links = p.railLinks || [];
    if (!links.length) return 0;
    const allied = links.filter((id) => this.isAllied(p.id, id)).length;
    return RAIL_LINK_EARN * (Math.min(RAIL_LINK_MAX, links.length) + Math.min(RAIL_LINK_MAX, allied)) * (1 + p.mods.trade);
  }
  hasStation(p) { return p.counts.city + p.counts.factory + p.counts.harbor > 0; }
  // At war: either side has an offensive running against the other.
  atWar(a, b) {
    for (const x of this.attacks) if (!x.dead && ((x.attacker === a && x.target === b) || (x.attacker === b && x.target === a))) return true;
    return false;
  }
  // Nations that have stopped trading with you, that are hostile toward you, or that are at war
  // with you, refuse your trade. Allies always trade unless one of them stops it.
  refusesTrade(q, p) {
    if (!q || !p || q === p || q.tribe) return false;
    if (q.tradeBan && q.tradeBan.has(p.id)) return true;
    if (this.isAllied(q.id, p.id)) return false;
    return this.getRel(q.id, p.id) <= -20 || this.atWar(q.id, p.id);
  }
  // Trade needs both sides willing.
  trades(p, q) { return !this.refusesTrade(q, p) && !this.refusesTrade(p, q); }

  // Stop (or resume) trading with a nation, by sea and across the border. It resents it.
  setTradeBan(pid, to, on) {
    const p = this.players[pid], q = this.players[to];
    if (!q || !q.alive || q === p || q.tribe) return 'Not possible.';
    if (on === p.tradeBan.has(to)) return '';
    if (on) {
      p.tradeBan.add(to);
      this.addRel(to, pid, -TRADE_BAN_RESENTMENT);
      if (q.human) this.log(`${p.name} stopped trading with you.`, 'bad', to, null, { alert: 'embargo', who: pid });
    } else {
      p.tradeBan.delete(to);
      if (q.human) this.log(`${p.name} is trading with you again.`, 'good', to);
    }
    this.updateTrade();
    return '';
  }

  // Once a second: which harbors each nation trades with, and which neighbours it is linked to
  // across the border.
  updateTrade() {
    for (const p of this.players) {
      if (!p) continue;
      p.tradeHarbors = 0; p.allyHarbors = 0; p.railLinks = [];
      if (!p.alive || p.tribe) continue;
      const nb = this.neighbors[p.id], station = this.hasStation(p);
      // Players hear when a partner stops trading with them; refusals that were already there
      // when the game began are noted quietly.
      const first = p.human && !p.embargoes;
      if (first) p.embargoes = new Set();
      for (const q of this.players) {
        if (!q || !q.alive || q === p || q.tribe) continue;
        const ok = this.trades(p, q);
        if (ok && p.counts.harbor && q.counts.harbor) {
          p.tradeHarbors += q.counts.harbor;
          if (this.isAllied(p.id, q.id)) p.allyHarbors += q.counts.harbor;
        }
        if (ok && station && nb && nb.has(q.id) && this.hasStation(q)) p.railLinks.push(q.id);
        if (!p.human) continue;
        // Only their refusal is news; a ban of your own you already know about.
        const shut = this.refusesTrade(q, p) && !(q.tradeBan && q.tradeBan.has(p.id));
        if (shut && !p.embargoes.has(q.id)) {
          p.embargoes.add(q.id);
          const partner = (p.counts.harbor && q.counts.harbor) || (nb && nb.has(q.id));
          // The same nation's refusal is told at most once every 90 seconds, as wars start and stop.
          const told = p.embargoTold || (p.embargoTold = new Map());
          if (!first && partner && this.time - (told.get(q.id) ?? -1e9) > 90) {
            told.set(q.id, this.time);
            this.log(`${q.name} stopped trading with you.${this.atWar(q.id, p.id) ? ' You are at war.' : ''}`, 'bad', p.id, null, { alert: 'embargo', who: q.id });
          }
        } else if (!shut) p.embargoes.delete(q.id);
      }
    }
  }
  // What one building brings in, in dollars per second.
  buildingIncome(p, b) {
    const per = b.type === 'harbor' ? this.harborEarn(p) : BLD_EARN[b.type] || 0;
    return per * (b.level || 1) * this.incomeMult(p);
  }
  troopCap(p) {
    const cap = (500 + p.pop * (p.mods.mobil + 0.005 * Math.min(p.counts.barracks, 6))) * Math.max(0.5, 1 + p.mods.troopCap);
    // Tribes spread over as much land as they can settle, but their war bands stay small.
    return p.tribe ? Math.min(cap, TRIBE_TROOPS + p.tiles * TRIBE_TROOPS_PER_TILE) : cap;
  }
  popCapOf(p) {
    const capitalOk = p.capital >= 0 && this.owner[p.capital] === p.id;
    return Math.max(2000, p.effValue * POP_PER_VALUE * (1 + p.mods.popCap) +
      p.counts.city * CITY_POP * (1 + p.mods.popCap * 0.5) + (capitalOk ? CAPITAL_POP : 0));
  }
  adminCapOf(p) {
    return (1500 + p.counts.city * 160 + p.counts.courthouse * 600) * this.adminScale * (1 + p.mods.admin);
  }
  landShare(p) { return p.tiles / this.map.landCount; }
  fleetCap(p) { return 3 + p.counts.harbor * 2 + p.mods.fleetCap; }
  fleetsOf(pid) { let n = 0; for (const s of this.ships) if (!s.dead && s.owner === pid) n++; return n; }
  missileCost(p, kind) {
    const c = nicePrice(Math.min(MISSILE_BASE_COST + p.missilesLaunched * 400 * MONEY, 9000 * MONEY));
    return kind === 'space' ? nicePrice(c * SPACE_COST_MULT) : c;
  }
  missileRadii(p) { const m = 1 + p.mods.missile; return [Math.round(MISSILE_R_IN * m), Math.round(MISSILE_R_OUT * m)]; }
  // Shots a silo or air defense holds, how far a silo reaches, and how wide an air defense covers.
  shotsOf(b) { return b.level || 1; }
  siloRange(b) { return SILO_RANGE + SILO_RANGE_STEP * ((b.level || 1) - 1); }
  aaRadius(b) { return AA_RADIUS + AA_RADIUS_STEP * ((b.level || 1) - 1); }
  hasSpaceSilo(p) { return p.blds.some((b) => b.alive && b.type === 'silo' && (b.level || 1) >= SPACE_SILO_LEVEL); }
  // A silo with a missile loaded, if any.
  readySilo(p, kind) {
    for (const b of p.blds) if (b.type === 'silo' && b.ammo > 0 && (kind !== 'space' || (b.level || 1) >= SPACE_SILO_LEVEL)) return b;
    return null;
  }
  buildCost(p, type) {
    const b = BUILDINGS[type];
    return nicePrice((b.base + b.step * (p.counts[type] + (p.pending[type] || 0))) * Math.max(0.5, 1 + p.mods.buildCost));
  }
  buildingAvailable(type) { return !BUILDINGS[type].politics || this.politics; }
  buildingUnlocked(p, type) {
    const d = BUILDINGS[type];
    return this.buildingAvailable(type) && (!d.tech || this.mode.openBuildings || p.techs.has(d.tech));
  }
  casualties(p, n) {
    if (n <= 0) return;
    p.pop = Math.max(0, p.pop - n);
    p.weariness += n;
  }

  // ---------- technology ----------
  techState(p, t) {
    if (p.techs.has(t.id)) return 'done';
    if (!t.req.every((r) => p.techs.has(r))) return 'req';
    if (this.mode.timeGate && this.year < t.year) return 'year';
    return 'avail';
  }
  // Every technology you already know makes the next one dearer, so leaders can't sweep the tree.
  techCost(p, t) { return Math.round(t.cost * (1 + TECH_KNOWN_COST * p.techs.size)); }
  availableTechs(p) { return TECHS.filter((t) => this.techState(p, t) === 'avail'); }
  setResearch(pid, id) {
    const p = this.players[pid], t = TECH_BY_ID[id];
    if (!t) return 'Unknown technology.';
    const st = this.techState(p, t);
    if (st === 'done') return `${t.name} is already known.`;
    if (st === 'req') return `${t.name} needs ${t.req.filter((r) => !p.techs.has(r)).map((r) => TECH_BY_ID[r].name).join(' and ')} first.`;
    if (st === 'year') return `${t.name} can't be researched before ${t.year}.`;
    p.research = id;
    p.autoResearch = false;
    return '';
  }
  // ---------- ideology ----------
  addFx(p, fx, sign) {
    for (const k in fx) {
      p.mods[k] += sign * fx[k];
      if (k === 'stability') p.ideoStab += sign * fx[k];
    }
  }
  doctrineCost(d) { return nicePrice(DOCTRINE_COST[d.tier] * MONEY); }
  doctrineState(p, d) {
    if (p.doctrines.has(d.key)) return 'done';
    if (p.ideology !== d.ideology) return 'other';
    if (d.req.some((r) => !p.doctrines.has(r))) return 'req';
    return 'avail';
  }
  setIdeology(pid, id) {
    const p = this.players[pid], I = IDEOLOGY_BY_ID[id];
    if (!I) return 'Unknown ideology.';
    if (p.tribe) return 'Tribes have no ideology.';
    if (p.ideology === id) return `${I.name} is already your ideology.`;
    if (p.ideology && this.time - p.ideologyAt < 60) return 'Your government only just changed. Wait a minute before changing it again.';
    const prev = p.ideology ? IDEOLOGY_BY_ID[p.ideology] : null;
    if (prev) {
      this.addFx(p, prev.fx, -1);
      for (const key of p.doctrines) this.addFx(p, DOCTRINE_BY_ID[key].fx, -1);
      p.doctrines.clear();
      if (this.politics) p.shock += IDEOLOGY_CHANGE_SHOCK;
    }
    p.ideology = id;
    p.ideologyAt = this.time;
    this.addFx(p, I.fx, 1);
    if (p.human) this.log(prev ? `Your nation turned from ${prev.name} to ${I.name}. Its old doctrines are gone.` : `Your nation embraced ${I.name}.`, 'good', p.id);
    return '';
  }
  adoptDoctrine(pid, key) {
    const p = this.players[pid], d = DOCTRINE_BY_ID[key];
    if (!d) return 'Unknown doctrine.';
    const st = this.doctrineState(p, d);
    if (st === 'done') return `${d.name} is already adopted.`;
    if (st === 'other') return `${d.name} belongs to ${IDEOLOGY_BY_ID[d.ideology].name}.`;
    if (st === 'req') return `${d.name} needs ${d.req.filter((r) => !p.doctrines.has(r)).map((r) => DOCTRINE_BY_ID[r].name).join(' and ')} first.`;
    const cost = this.doctrineCost(d);
    if (p.gold < cost) return `${d.name} costs ${fmtMoney(cost)}. You have ${fmtMoney(p.gold)}.`;
    p.gold -= cost;
    p.doctrines.add(key);
    this.addFx(p, d.fx, 1);
    if (p.human) this.log(`Adopted ${d.name}. ${fxSplit(d.fx).pros.concat(fxSplit(d.fx).cons).join('. ')}.`, 'good', p.id);
    return '';
  }

  completeTech(p, t) {
    p.techs.add(t.id);
    delete p.progress[t.id];
    const fx = techFx(t, this.mode);
    if (fx) for (const k in fx) p.mods[k] += fx[k];
    p.research = null;
    if (p.human) this.log(`Researched ${t.name}. ${techDesc(t, this.mode)}`, 'good', p.id);
  }
  autoPickResearch(p) {
    const av = this.availableTechs(p);
    if (!av.length) return null;
    av.sort((a, b) => (a.cost - (p.progress[a.id] || 0)) - (b.cost - (p.progress[b.id] || 0)) || a.year - b.year);
    return av[0].id;
  }

  // ---------- ownership ----------
  setOwner(t, newOwner) {
    const old = this.owner[t];
    if (old === newOwner) return;
    const v = T_VALUE[this.map.terrain[t]];
    const po = old ? this.players[old] : null;
    const pn = newOwner ? this.players[newOwner] : null;
    const oldC = this.control[t];
    const newC = !this.politics ? 100 : old ? 10 : 55;
    this.owner[t] = newOwner;
    if (po) {
      po.tiles--; po.value -= v; po.effValue -= v * this.controlFactor(oldC);
      if (newOwner) { po.lastHitBy = newOwner; po.lastHitAt = this.tick; }
      // Winning a war lifts spirits at home.
      if (pn && this.politics) pn.glory = Math.min(GLORY_MAX, pn.glory + (po.tribe ? 0.01 : 0.03));
    }
    this.control[t] = newOwner ? newC : 0;
    if (pn) {
      pn.tiles++; pn.value += v; pn.effValue += v * this.controlFactor(newC);
      if (pn.tiles > pn.peakTiles) pn.peakTiles = pn.tiles;
      const x = t % this.W, y = (t - x) / this.W, bb = pn.bbox;
      if (x < bb[0]) bb[0] = x;
      if (y < bb[1]) bb[1] = y;
      if (x > bb[2]) bb[2] = x;
      if (y > bb[3]) bb[3] = y;
    }
    const bi = this.bldAt[t];
    if (bi >= 0) {
      const b = this.buildings[bi];
      if (po) {
        po.counts[b.type] -= b.level || 1;
        const k = po.blds.indexOf(b);
        if (k >= 0) po.blds.splice(k, 1);
      }
      if (pn) {
        b.owner = newOwner;
        pn.counts[b.type] += b.level || 1;
        pn.blds.push(b);
        b.cooldown = Math.max(b.cooldown, 5 * TPS);
        // A captured silo or air defense starts empty and reloads for its new owner.
        if (b.type === 'silo' || b.type === 'aa') { b.ammo = 0; b.cooldown = b.type === 'silo' ? SILO_RELOAD : AA_RELOAD; }
      } else {
        b.alive = false;
        this.bldAt[t] = -1;
      }
    }
    this.markDirtyAround(t);
    if (this.net) { this.net.own.push(t, newOwner); if (bi >= 0) this.net.bld.add(bi); }
    if (po && po.tiles <= 0 && po.alive) this.eliminate(po, newOwner);
  }

  eliminate(p, byId) {
    p.alive = false;
    p.eliminatedAt = this.time;
    const by = byId ? this.players[byId] : null;
    for (const a of this.attacks) {
      if (a.dead) continue;
      if (a.attacker === p.id) { a.dead = true; a.troops = 0; }
      else if (a.target === p.id) { this.players[a.attacker].troops += a.troops; a.troops = 0; a.dead = true; }
    }
    for (const s of this.ships) if (s.owner === p.id) s.dead = true;
    for (const q of this.players) if (q) { q.allies.delete(p.id); this.allyUntil.delete(this.allyKey(p.id, q.id)); }
    p.allies.clear();
    const loot = p.gold;
    if (by) { by.gold += p.gold; by.kills++; if (this.politics) by.glory = Math.min(GLORY_MAX, by.glory + (p.tribe ? 2 : 8)); }
    p.gold = 0;
    p.troops = 0;
    p.pop = 0;
    if (p.human) this.log(`Your nation has fallen${by ? ' to ' + by.name : ''}.`, 'bad', p.id);
    if (p.tribe) { if (by && by.human) this.log(`You absorbed the ${p.name} and took ${fmtMoney(nicePrice(loot))} from its stores.`, 'good', by.id); return; }
    if (by && by.human) this.log(`You conquered ${p.name} and seized ${fmtMoney(nicePrice(loot))} from its treasury.`, 'good', by.id, null, { alert: 'conquest', who: p.id });
    this.log(`${p.name} was destroyed${by ? ' by ' + by.name : ''}.`, 'info', 0, [p.id, by ? by.id : 0]);
  }

  // ---------- land attacks ----------
  _addF(atk, n) {
    if (!atk.inF.has(n) && this.isTarget(n, atk.target)) { atk.inF.add(n); atk.frontier.push(n); }
  }

  buildFrontier(atk) {
    const a = atk.attacker, own = this.owner, W = this.W, H = this.H;
    const bb = this.players[a].bbox;
    atk.frontier.length = 0;
    atk.inF.clear();
    for (let y = bb[1]; y <= bb[3]; y++) {
      const row = y * W;
      for (let x = bb[0]; x <= bb[2]; x++) {
        const i = row + x;
        if (own[i] !== a) continue;
        if (x > 0 && own[i - 1] !== a) this._addF(atk, i - 1);
        if (x < W - 1 && own[i + 1] !== a) this._addF(atk, i + 1);
        if (y > 0 && own[i - W] !== a) this._addF(atk, i - W);
        if (y < H - 1 && own[i + W] !== a) this._addF(atk, i + W);
      }
    }
  }

  // Returns true when troops were committed.
  launchAttack(aId, tId, amount, opts = {}) {
    const A = this.players[aId];
    if (!A || !A.alive || aId === tId) return false;
    if (tId && (!this.players[tId].alive || this.isFriendly(aId, tId))) return false;
    const fromPool = opts.fromPool !== false;
    amount = Math.floor(fromPool ? Math.min(amount, A.troops) : amount);
    if (amount < 1) return false;

    if (opts.seed === undefined) {
      const existing = this.attacks.find((x) => !x.dead && x.attacker === aId && x.target === tId && !x.seeded);
      if (existing) {
        this.buildFrontier(existing);
        if (existing.frontier.length === 0) return false;
        if (fromPool) A.troops -= amount;
        existing.troops += amount;
        if (opts.focus) existing.focus = opts.focus;
        return true;
      }
    }
    const atk = {
      id: this.idSeq++, attacker: aId, target: tId, troops: amount, frontier: [], inF: new Set(),
      seeded: opts.seed !== undefined, dead: false, taken: 0, refreshAt: 0, startedAt: this.tick,
      focus: opts.focus || null,
    };
    if (atk.seeded) {
      const s = opts.seed, W = this.W, x = s % W;
      if (x > 0) this._addF(atk, s - 1);
      if (x < W - 1) this._addF(atk, s + 1);
      if (s >= W) this._addF(atk, s - W);
      if (s + W < this.N) this._addF(atk, s + W);
    } else {
      this.buildFrontier(atk);
    }
    if (atk.frontier.length === 0) return false;
    if (fromPool) A.troops -= amount;

    // Opposing attacks meet in the field and cancel out.
    if (tId) {
      const D = this.players[tId];
      for (const o of this.attacks) {
        // Troops already ashore from a fleet fight for their beachhead tile by tile instead.
        if (o.dead || o.attacker !== tId || o.target !== aId || o.seeded) continue;
        const m = Math.min(o.troops, atk.troops);
        o.troops -= m; atk.troops -= m;
        this.casualties(A, m);
        this.casualties(D, m);
        if (o.troops < 1) { o.dead = true; }
        if (atk.troops < 1) break;
      }
      this.addRel(tId, aId, -8);
      if (!A.tribe) this.angerAllies(aId, tId);
      if (D.human && atk.troops >= 1) this.log(`${A.name}${this.allyNote(aId, tId)} attacks with ${fmt(atk.troops)} troops.`, 'bad', D.id, null, A.tribe ? null : { alert: 'attack', who: aId });
      if (atk.troops < 1) return true;
    }
    this.attacks.push(atk);
    return true;
  }

  fortMult(t, D) {
    if (D.counts.fort === 0) return 1;
    const W = this.W, x = t % W, y = (t - x) / W;
    const r = BUILDINGS.fort.radius + D.mods.fortRadius;
    const R2 = r * r;
    for (const b of D.blds) {
      if (b.type !== 'fort') continue;
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy <= R2) return 2 + D.mods.fort + 0.3 * ((b.level || 1) - 1);
    }
    return 1;
  }

  tileCost(t, A, D, density) {
    const tt = this.map.terrain[t];
    if (!D) return NEUTRAL_COST * T_COST[tt] * Math.max(0.4, 1 + A.mods.neutral);
    const traitor = D.traitorUntil > this.tick ? 0.8 : 1;
    // Long-held, well-governed heartland resists harder than freshly taken land.
    const core = this.politics && this.control[t] >= 90 ? 1.6 : 1;
    return (density * 1.1 + 5) * T_DEF[tt] * this.fortMult(t, D) * traitor * core * Math.max(0.3, 1 + D.mods.def) * (1 - Math.min(0.5, A.mods.atk)) * this.mode.defense;
  }

  // Taking a tile from a nation kills its garrison and moves some of its people.
  takeTile(t, A, D, density) {
    if (D) {
      const kill = Math.min(D.troops, density);
      D.troops -= kill;
      this.casualties(D, kill);
      const civ = Math.max(0, (D.pop - D.troops - D.field) / Math.max(1, D.tiles));
      D.pop = Math.max(0, D.pop - civ);
      A.pop += civ * this.mode.absorb;
    }
    this.setOwner(t, A.id);
  }

  stepAttack(atk) {
    const A = this.players[atk.attacker];
    if (!A.alive) { atk.dead = true; return; }
    const aId = atk.attacker, tId = atk.target;
    const D = tId ? this.players[tId] : null;
    if (D && (!D.alive || this.isFriendly(aId, tId))) { A.troops += atk.troops; atk.dead = true; return; }
    const F = atk.frontier;
    if (F.length === 0 && !atk.seeded && atk.refreshAt <= this.tick) {
      this.buildFrontier(atk);
      atk.refreshAt = this.tick + 10;
    }
    if (F.length === 0) { A.troops += atk.troops; atk.dead = true; return; }
    // Offensives against nations bleed troops to supply problems; railroads and engines help.
    if (D) {
      const lost = atk.troops * this.mode.attrition * (1 - 0.6 * Math.min(0.5, A.mods.speed)) * Math.max(0.25, 1 + A.mods.attrition) / TPS;
      atk.troops -= lost;
      this.casualties(A, lost);
    }

    const own = this.owner, ter = this.map.terrain, W = this.W, H = this.H, rng = this.rng;
    const pace = D ? this.mode.attackSpeed * (1 + A.mods.speed) : NEUTRAL_SPEED;
    let tries = Math.ceil(F.length * ATTACK_SPEED * pace) + 1;
    const focus = atk.focus;
    const density = D ? D.troops / Math.max(1, D.tiles) : 0;
    const deferred = this._deferred;
    deferred.length = 0;
    let exhausted = false;
    while (tries-- > 0 && F.length > 0) {
      let k = (rng() * F.length) | 0;
      if (focus) {
        // Lean toward the spot the player clicked: keep the closest of a few picks.
        let bd = 1e18;
        for (let s = 0; s < 3; s++) {
          const c = s ? (rng() * F.length) | 0 : k;
          const ct = F[c], cx = ct % W - focus[0], cy = (ct - (ct % W)) / W - focus[1];
          const d = cx * cx + cy * cy;
          if (d < bd) { bd = d; k = c; }
        }
      }
      const t = F[k];
      F[k] = F[F.length - 1];
      F.pop();
      if (!this.isTarget(t, tId)) { atk.inF.delete(t); continue; }
      const x = t % W, y = (t - x) / W;
      let adj = 0;
      if (x > 0 && own[t - 1] === aId) adj++;
      if (x < W - 1 && own[t + 1] === aId) adj++;
      if (y > 0 && own[t - W] === aId) adj++;
      if (y < H - 1 && own[t + W] === aId) adj++;
      if (adj === 0) { atk.inF.delete(t); continue; }
      let speed = T_SPEED[ter[t]] * (adj >= 2 ? 1 : 0.45);
      if (D && this.fortMult(t, D) > 1) speed *= 0.5;
      if (rng() > speed) { deferred.push(t); continue; }
      const cost = this.tileCost(t, A, D, density);
      if (atk.troops < cost) { deferred.push(t); exhausted = true; break; }
      atk.troops -= cost;
      if (D) this.casualties(A, cost);
      atk.inF.delete(t);
      atk.taken++;
      this.takeTile(t, A, D, density);
      if (atk.dead) break;
      if (x > 0) this._addF(atk, t - 1);
      if (x < W - 1) this._addF(atk, t + 1);
      if (y > 0) this._addF(atk, t - W);
      if (y < H - 1) this._addF(atk, t + W);
    }
    for (let i = 0; i < deferred.length; i++) F.push(deferred[i]);
    if (atk.dead) return;
    if (exhausted || atk.troops < 1) {
      A.troops += Math.max(0, atk.troops);
      atk.troops = 0;
      atk.dead = true;
    }
  }

  retreat(atkId, pid) {
    const atk = this.attacks.find((a) => a.id === atkId && !a.dead);
    if (!atk || atk.attacker !== pid) return false;
    const p = this.players[pid];
    p.troops += atk.troops * 0.8;
    this.casualties(p, atk.troops * 0.2);
    atk.troops = 0;
    atk.dead = true;
    return true;
  }

  // ---------- player commands ----------
  // Is the clicked region connected over land to pid's border?
  // Whether the owner of a tile borders pid over land, searching through that owner's land
  // (and, with viaEmpty, through unclaimed land as well).
  landReachable(pid, tile, viaEmpty) {
    const W = this.W, H = this.H, own = this.owner;
    const t = own[tile];
    const st = this.nextStamp(), S = this.bfsStamp, Q = this.bfsQueue;
    let qh = 0, qt = 0;
    Q[qt++] = tile; S[tile] = st;
    while (qh < qt) {
      if (qh > 150000) return true;
      const i = Q[qh++];
      const x = i % W, y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nb) {
        if (n < 0) continue;
        if (own[n] === pid) return true;
        if (S[n] === st || !(this.isTarget(n, t) || (viaEmpty && this.isTarget(n, 0)))) continue;
        S[n] = st; Q[qt++] = n;
      }
    }
    return false;
  }

  // Click on a tile with a share of troops: march over land, or sail if there's no land route.
  attackTile(pid, tile, ratio) {
    const me = this.players[pid];
    if (!me || !me.alive) return { msg: 'Your nation has fallen.', bad: true };
    if (tile < 0 || tile >= this.N || this.isWater(tile)) return { msg: '' };
    const o = this.owner[tile];
    if (o === pid) return { msg: 'Your land. Right-click it to build.' };
    if (this.isAllied(pid, o)) return { msg: `${this.players[o].name} is your ally. Right-click to reinforce them.` };
    if (o === 0 && this.fallout[tile]) return { msg: 'That land is scorched and can\'t be taken yet.', bad: true };
    const amount = Math.floor(me.troops * clamp(ratio, 0.01, 1));
    if (amount < 1) return { msg: 'You have no troops to send.', bad: true };
    const who = o ? this.players[o].name : 'unclaimed land';
    const x = tile % this.W, focus = [x, (tile - x) / this.W];
    if (this.landReachable(pid, tile) && this.launchAttack(pid, o, amount, { focus })) {
      return { msg: o ? `Attacking ${who} with ${fmt(amount)} troops.` : `Settling toward that spot with ${fmt(amount)} troops.`, warn: this.lowTroops(me) };
    }
    // A nation beyond empty land on your own landmass: settle the land in between, toward them.
    if (o && this.landReachable(pid, tile, true) && this.launchAttack(pid, 0, amount, { focus })) {
      return { msg: `Settling toward ${who} with ${fmt(amount)} troops. Attack them once your borders meet.`, warn: this.lowTroops(me) };
    }
    const err = this.launchNaval(pid, tile, amount);
    return err ? { msg: err, bad: true } : { msg: `Fleet sailing to ${who} with ${fmt(amount)} troops.`, warn: this.lowTroops(me) };
  }

  // A warning when sending troops has left too few at home to defend or to regrow quickly.
  lowTroops(p) {
    const cap = this.troopCap(p);
    if (p.troops >= cap * LOW_TROOPS) return '';
    return `Only ${fmt(p.troops)} troops left at home. They regrow fastest at about 40% of your limit.`;
  }

  // Every player action enters here, from the local UI, a tutorial, or a remote client.
  command(pid, name, a = {}) {
    const p = this.players[pid];
    if (!p) return { msg: 'Unknown player.', bad: true };
    const r = (err, ok) => (err ? { msg: err, bad: true } : { msg: ok || '' });
    if (!this.started && !PRE_START_COMMANDS.has(name)) return r('The war begins when the countdown ends.');
    switch (name) {
      case 'spawn':
        if (this.started && !this.multiplayer) return r('Already started.');
        return this.spawnPlayer(pid, a.tile) ? r('', '') : r('Pick a spot on unclaimed land.');
      case 'attack': return this.attackTile(pid, a.tile, a.ratio);
      case 'fleet': {
        const amount = Math.floor(p.troops * clamp(Number(a.ratio) || 0, 0.01, 1));
        const err = this.launchNaval(pid, a.tile, amount);
        const o = this.owner[a.tile];
        if (err) return r(err);
        return { msg: `Fleet sailing to ${o ? this.players[o].name : 'unclaimed land'} with ${fmt(amount)} troops.`, warn: this.lowTroops(p) };
      }
      case 'build': {
        const err = this.build(pid, a.type, a.tile);
        if (err || !BUILDINGS[a.type]) return r(err);
        const lb = this.lastBuild, name = BUILDINGS[a.type].name;
        return r('', lb.upgraded ? `${name} upgraded to level ${lb.level}.` : `${name} under construction: ready in ${lb.seconds}s.`);
      }
      case 'demolish': {
        const err = this.demolish(pid, a.tile);
        const d = this.lastDemolish;
        return r(err, d ? `${d.site ? `${d.name} cancelled` : `${d.name} demolished`}. ${fmtMoney(nicePrice(d.refund))} recovered.` : '');
      }
      case 'taxrelief': return r(this.setTaxRelief(pid, !!a.on));
      case 'missile': {
        const kind = a.kind === 'space' ? 'space' : 'missile';
        return r(this.launchMissile(pid, a.tile, kind), kind === 'space' ? 'Space missile away.' : 'Missile away.');
      }
      case 'retreat': return this.retreat(a.id, pid) ? r('', 'Troops pulled back. 20% were lost in the retreat.') : r('That offensive has already ended.');
      case 'ally': return r(this.requestAlliance(pid, a.to));
      case 'treaty': {
        if (!this.treaty || !this.treaty.open || this.treaty.id !== a.id) return r('That proposal has closed.');
        this.treaty.votes.set(pid, !!a.accept);
        this.updateTreaty();
        return r('', a.accept ? (this.multiplayer ? 'You signed. Waiting for the other players.' : '') : 'You refused. The war goes on.');
      }
      case 'unally': this.breakAlliance(pid, a.to); return r('');
      case 'troops': return r(this.sendTroops(pid, a.to, Math.floor(p.troops * (a.ratio || 0.25))));
      case 'gold': return r(this.sendGold(pid, a.to, Math.floor(p.gold * (a.ratio || 0.25))));
      case 'trade': {
        const q = this.players[a.to], err = this.setTradeBan(pid, a.to, !!a.stop);
        return r(err, q ? (a.stop ? `You stopped trading with ${q.name}. They resent it.` : `You are trading with ${q.name} again.`) : '');
      }
      case 'respond': this.respondRequest(a.id, !!a.accept, pid); return r('');
      case 'research': {
        const err = this.setResearch(pid, a.id);
        return r(err, TECH_BY_ID[a.id] ? `Researching ${TECH_BY_ID[a.id].name}.` : '');
      }
      case 'martial': return r(this.setMartial(pid, !!a.on));
      case 'ideology': {
        const err = this.setIdeology(pid, a.id);
        return r(err, IDEOLOGY_BY_ID[a.id] ? `${IDEOLOGY_BY_ID[a.id].name} adopted.` : '');
      }
      case 'doctrine': {
        const err = this.adoptDoctrine(pid, a.id);
        return r(err, DOCTRINE_BY_ID[a.id] ? `${DOCTRINE_BY_ID[a.id].name} adopted.` : '');
      }
      case 'celebrate': return r(this.celebrate(pid));
      case 'focus': p.focus = clamp(Number(a.v) || 0, 0, 1); return r('');
      case 'science': p.science = clamp(Number(a.v) || 0, 0, 0.8); return r('');
      default: return r('Unknown command.');
    }
  }

  // ---------- naval ----------
  nextStamp() {
    this.stamp++;
    if (this.stamp >= 0xfffffff0) { this.bfsStamp.fill(0); this.stamp = 1; }
    return this.stamp;
  }

  // Nearest coastal tile of the clicked owner's land, starting from the clicked tile.
  findLanding(tile, tOwner) {
    if (this.map.coast[tile] && this.isTarget(tile, tOwner)) return tile;
    const W = this.W, H = this.H, st = this.nextStamp(), Q = this.bfsQueue, S = this.bfsStamp;
    let qh = 0, qt = 0;
    Q[qt++] = tile; S[tile] = st;
    while (qh < qt && qh < 20000) {
      const i = Q[qh++];
      if (this.map.coast[i] && this.isTarget(i, tOwner)) return i;
      const x = i % W, y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nb) {
        if (n < 0 || S[n] === st || this.owner[n] !== tOwner || this.isWater(n)) continue;
        S[n] = st; Q[qt++] = n;
      }
    }
    return -1;
  }

  nearCoast(tile, r) {
    const W = this.W, H = this.H, x0 = tile % W, y0 = (tile - x0) / W;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) if (this.isWater(y * W + x)) return true;
    }
    return false;
  }

  // The nearest coastal land within r tiles of a spot, not owned by pid or an ally: where a
  // fleet ordered "here" from a right-click on the sea would land.
  nearestForeignCoast(pid, tile, r = 8) {
    const W = this.W, H = this.H, x0 = tile % W, y0 = (tile - x0) / W;
    let best = -1, bd = 1e9;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) {
        const t = y * W + x;
        if (!this.map.coast[t] || this.isWater(t)) continue;
        const o = this.owner[t];
        if (o === pid || this.isAllied(pid, o) || (o === 0 && this.fallout[t])) continue;
        const d = (x - x0) * (x - x0) + (y - y0) * (y - y0);
        if (d < bd) { bd = d; best = t; }
      }
    }
    return best;
  }

  // BFS across water from the landing site back to any shore owned by aId.
  findSeaRoute(landing, aId) {
    const W = this.W, H = this.H, st = this.nextStamp(), Q = this.bfsQueue, S = this.bfsStamp, Par = this.bfsParent;
    const own = this.owner;
    let qh = 0, qt = 0;
    const lx = landing % W, ly = (landing - lx) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = lx + dx, y = ly + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const n = y * W + x;
        if (!this.isWater(n) || S[n] === st) continue;
        S[n] = st; Par[n] = -1; Q[qt++] = n;
      }
    }
    while (qh < qt) {
      const i = Q[qh++];
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const n = yy * W + xx;
          if (own[n] === aId && (dx === 0 || dy === 0)) {
            const path = [];
            for (let c = i; c !== -1; c = Par[c]) path.push(c);
            return { path, launch: n };
          }
          if (S[n] === st || !this.isWater(n)) continue;
          S[n] = st; Par[n] = i; Q[qt++] = n;
        }
      }
    }
    return null;
  }

  // Returns '' on success or an explanation.
  launchNaval(aId, tile, amount) {
    const A = this.players[aId];
    if (!A.alive) return 'You have no nation.';
    if (this.isWater(tile)) return 'Pick a landing spot on land.';
    const tOwner = this.owner[tile];
    if (tOwner === aId) return 'That is already your land.';
    if (this.isAllied(aId, tOwner)) return `${this.players[tOwner].name} is your ally.`;
    if (tOwner === 0 && this.fallout[tile]) return 'That land is still scorched.';
    if (A.coastal === 0) return 'You need a coastline to launch a fleet.';
    if (this.fleetsOf(aId) >= this.fleetCap(A)) return `All ${this.fleetCap(A)} fleets are at sea. Build harbors for more.`;
    amount = Math.floor(Math.min(amount, A.troops));
    if (amount < 10) return 'Not enough troops to crew a fleet.';
    const landing = this.findLanding(tile, tOwner);
    if (landing < 0) return 'That land has no reachable coast.';
    const route = this.findSeaRoute(landing, aId);
    if (!route) return 'No sea route from your coast to there.';
    A.troops -= amount;
    A.fleetsLaunched = (A.fleetsLaunched || 0) + 1;
    const ship = {
      id: this.idSeq++, owner: aId, troops: amount, path: route.path, pos: 0, landing, target: tOwner, dead: false,
      speed: SHIP_SPEED * (1 + A.mods.fleetSpeed),
    };
    this.ships.push(ship);
    if (this.net) this.net.ships.push(ship);
    if (tOwner) {
      const D = this.players[tOwner];
      this.addRel(tOwner, aId, -10);
      this.angerAllies(aId, tOwner);
      if (D.human) this.log(`A fleet from ${A.name}${this.allyNote(aId, tOwner)} sails for your coast with ${fmt(amount)} troops.`, 'bad', D.id, null, { alert: 'fleet', at: landing, who: aId });
    }
    return '';
  }

  stepShips() {
    for (const s of this.ships) {
      if (s.dead) continue;
      if (s.pos < s.path.length - 1) { s.pos = Math.min(s.path.length - 1, s.pos + s.speed); continue; }
      if (s.dock === undefined) s.dock = this.tick + LANDING_TICKS;
      else if (this.tick >= s.dock) { s.dead = true; this.landShip(s); }
    }
  }

  landShip(s) {
    const A = this.players[s.owner];
    if (!A.alive) return;
    const L = s.landing;
    const o = this.owner[L];
    if (o === s.owner || this.isFriendly(s.owner, o) || (o === 0 && this.fallout[L])) { A.troops += s.troops; return; }
    const D = o ? this.players[o] : null;
    const density = D ? D.troops / Math.max(1, D.tiles) : 0;
    const cost = this.tileCost(L, A, D, density);
    if (s.troops < cost) {
      if (A.human) this.log(`Your fleet was repelled at the shore of ${D ? D.name : 'the wilds'}.`, 'bad', A.id);
      this.casualties(A, s.troops);
      if (D) { const k = Math.min(D.troops, s.troops * 0.5); D.troops -= k; this.casualties(D, k); }
      return;
    }
    const troops = s.troops - cost;
    if (D) this.casualties(A, cost);
    this.takeTile(L, A, D, density);
    if (D && D.human) this.log(`${A.name} landed troops on your coast.`, 'bad', D.id);
    if (troops >= 1) {
      const ok = this.launchAttack(s.owner, o, troops, { seed: L, fromPool: false });
      if (!ok) A.troops += troops;
    }
  }

  // ---------- buildings ----------
  // Returns '' when the building can go here, otherwise the reason it can't.
  // Clicking on or right next to your own building of the same type stacks it instead.
  stackTarget(p, type, t) {
    if (t < 0 || t >= this.N) return null;
    const W = this.W, H = this.H, x0 = t % W, y0 = (t - x0) / W;
    let best = null, bd = 1e9;
    for (let y = Math.max(0, y0 - 2); y <= Math.min(H - 1, y0 + 2); y++) {
      for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x0 + 2); x++) {
        const bi = this.bldAt[y * W + x];
        if (bi < 0) continue;
        const b = this.buildings[bi];
        if (!b.alive || b.owner !== p.id || b.type !== type) continue;
        const d = Math.abs(x - x0) + Math.abs(y - y0);
        if (d < bd) { bd = d; best = b; }
      }
    }
    return best;
  }

  // Where a building clicked at t would go: a harbor placed inland goes to the nearest stretch of
  // your own coast.
  placeTile(p, type, t) {
    const def = BUILDINGS[type];
    if (!def || !def.coastal || t < 0 || t >= this.N || this.stackTarget(p, type, t)) return t;
    const coast = this.map.coast, own = this.owner;
    if (own[t] === p.id && coast[t] && this.spacingOk(t)) return t;
    const W = this.W, H = this.H, x0 = t % W, y0 = (t - x0) / W, R = HARBOR_SNAP;
    let best = -1, bd = Infinity;
    for (let y = Math.max(0, y0 - R); y <= Math.min(H - 1, y0 + R); y++) {
      for (let x = Math.max(0, x0 - R); x <= Math.min(W - 1, x0 + R); x++) {
        const i = y * W + x;
        if (own[i] !== p.id || !coast[i]) continue;
        const d = (x - x0) * (x - x0) + (y - y0) * (y - y0);
        if (d < bd && d <= R * R && (this.spacingOk(i) || this.stackTarget(p, type, i))) { bd = d; best = i; }
      }
    }
    return best >= 0 ? best : t;
  }
  // No building or construction site too close.
  spacingOk(t) {
    const W = this.W, H = this.H, x0 = t % W, y0 = (t - x0) / W, r = BUILD_SPACING;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) {
        if (this.bldAt[y * W + x] >= 0) return false;
      }
    }
    for (const x of this.sites) {
      if (x.upgrade < 0 && Math.max(Math.abs(x.tile % W - x0), Math.abs(Math.floor(x.tile / W) - y0)) <= r) return false;
    }
    return true;
  }

  canBuild(p, type, t, ignoreGold) {
    const def = BUILDINGS[type];
    if (!def || !this.buildingAvailable(type)) return 'Unknown building.';
    t = this.placeTile(p, type, t);
    if (!this.buildingUnlocked(p, type)) return `Research ${TECH_BY_ID[def.tech].name} first.`;
    const stack = this.stackTarget(p, type, t);
    if (stack) {
      if (this.sites.some((x) => x.upgrade === stack.id)) return `This ${def.name.toLowerCase()} is already being upgraded.`;
      if (stack.level >= MAX_LEVEL) return `This ${def.name.toLowerCase()} is already at level ${MAX_LEVEL}.`;
      if (!ignoreGold && p.gold < this.buildCost(p, type)) return `Needs ${fmtMoney(this.buildCost(p, type))}.`;
      return '';
    }
    if (def.coastal && (t < 0 || t >= this.N || this.owner[t] !== p.id || !this.map.coast[t])) return 'No coast of yours nearby.';
    if (t < 0 || t >= this.N || this.owner[t] !== p.id) return 'Build on your own land.';
    if (!this.spacingOk(t)) return 'Too close to another building.';
    if (!ignoreGold && p.gold < this.buildCost(p, type)) return `Needs ${fmtMoney(this.buildCost(p, type))}.`;
    return '';
  }

  // A new building starts a construction site, paid for up front, and starts working when it's
  // finished. Stacking another level onto a building of yours takes effect at once.
  build(pid, type, t) {
    const p = this.players[pid];
    const err = this.canBuild(p, type, t);
    if (err) return err;
    t = this.placeTile(p, type, t);
    const cost = this.buildCost(p, type);
    p.gold -= cost;
    const stack = this.stackTarget(p, type, t);
    if (stack) {
      const site = { id: this.idSeq++, owner: pid, type, tile: stack.tile, upgrade: stack.id, level: stack.level + 1, left: 0, total: 0, cost };
      p.pending[type]++;
      this.finishSite(site);
      this.lastBuild = { upgraded: true, level: site.level, seconds: 0, tile: stack.tile };
      return '';
    }
    const total = Math.round(BUILD_SECONDS[type] * TPS);
    const site = { id: this.idSeq++, owner: pid, type, tile: t, upgrade: -1, level: 1, left: total, total, cost };
    this.sites.push(site);
    p.pending[type]++;
    this.lastBuild = { upgraded: false, level: 1, seconds: Math.round(total / TPS), tile: t };
    return '';
  }

  // Every tick: work on the construction sites. A site whose land is lost is lost with it.
  stepSites() {
    if (!this.sites.length) return;
    let done = false;
    for (const x of this.sites) {
      const p = this.players[x.owner];
      const b = x.upgrade >= 0 ? this.buildings[x.upgrade] : null;
      if (!p.alive || this.owner[x.tile] !== x.owner || (b && (!b.alive || b.owner !== x.owner))) {
        x.dead = true; done = true;
        p.pending[x.type] = Math.max(0, p.pending[x.type] - 1);
        if (p.human && p.alive) this.log(`The ${BUILDINGS[x.type].name.toLowerCase()} you were building was lost with its land.`, 'bad', p.id);
        continue;
      }
      if (--x.left <= 0) { this.finishSite(x); x.dead = true; done = true; }
    }
    if (done) this.sites = this.sites.filter((x) => !x.dead);
  }

  finishSite(x) {
    const p = this.players[x.owner], type = x.type;
    p.pending[type] = Math.max(0, p.pending[type] - 1);
    if (x.upgrade >= 0) {
      const b = this.buildings[x.upgrade];
      b.level++;
      p.counts[type]++;
      // The new level comes with its shot loaded.
      if (type === 'silo' || type === 'aa') b.ammo = Math.min(this.shotsOf(b), (b.ammo || 0) + 1);
      if (this.net) this.net.bld.add(b.id);
    } else {
      const t = x.tile, cx = t % this.W, cy = (t - cx) / this.W;
      const b = { id: this.buildings.length, type, tile: t, x: cx, y: cy, owner: p.id, cooldown: 0, alive: true, builtAt: this.tick, level: 1, ammo: type === 'silo' || type === 'aa' ? 1 : 0 };
      this.buildings.push(b);
      this.bldAt[t] = b.id;
      p.counts[type]++;
      p.blds.push(b);
      if (this.net) this.net.bld.add(b.id);
    }
    if (this.politics) { this.pacify(x.tile, x.owner); this.computeAdmin(); }
    if (p.human) this.log(x.upgrade >= 0 ? `${BUILDINGS[type].name} upgraded to level ${x.level}.` : `${BUILDINGS[type].name} finished.`, 'good', p.id);
  }

  // A new building settles the land around it: restless and occupied tiles nearby calm down at once.
  pacify(t, pid) {
    const W = this.W, H = this.H, x0 = t % W, y0 = (t - x0) / W, R = PACIFY_RADIUS;
    for (let y = Math.max(0, y0 - R); y <= Math.min(H - 1, y0 + R); y++) {
      for (let x = Math.max(0, x0 - R); x <= Math.min(W - 1, x0 + R); x++) {
        const i = y * W + x;
        if (this.owner[i] !== pid || (x - x0) ** 2 + (y - y0) ** 2 > R * R) continue;
        const c = this.control[i];
        if (c < 100) this.setControl(i, Math.min(100, c + 30));
      }
    }
  }

  // Tear down one of your buildings, or call off one under construction, for part of its price.
  demolish(pid, t) {
    const p = this.players[pid];
    if (t < 0 || t >= this.N) return 'Nothing to demolish there.';
    const W = this.W, x0 = t % W, y0 = (t - x0) / W;
    const near = (tile) => Math.max(Math.abs(tile % W - x0), Math.abs(Math.floor(tile / W) - y0)) <= 1;
    const k = this.sites.findIndex((x) => x.owner === pid && near(x.tile));
    if (k >= 0) {
      const x = this.sites[k];
      this.sites.splice(k, 1);
      p.pending[x.type] = Math.max(0, p.pending[x.type] - 1);
      const back = Math.round(x.cost * 0.5);
      p.gold += back;
      this.lastDemolish = { name: BUILDINGS[x.type].name, refund: back, site: true };
      return '';
    }
    let b = null;
    for (let y = y0 - 1; y <= y0 + 1 && !b; y++) {
      for (let x = x0 - 1; x <= x0 + 1 && !b; x++) {
        const bi = y >= 0 && x >= 0 && x < W && y < this.H ? this.bldAt[y * W + x] : -1;
        if (bi >= 0 && this.buildings[bi].alive && this.buildings[bi].owner === pid) b = this.buildings[bi];
      }
    }
    if (!b) return 'There is no building of yours there.';
    const back = Math.round(BUILDINGS[b.type].base * b.level * DEMOLISH_REFUND);
    p.counts[b.type] -= b.level;
    const i = p.blds.indexOf(b);
    if (i >= 0) p.blds.splice(i, 1);
    b.alive = false;
    this.bldAt[b.tile] = -1;
    p.gold += back;
    if (this.net) this.net.bld.add(b.id);
    if (this.politics && ADMIN_RADIUS[b.type]) this.computeAdmin();
    this.lastDemolish = { name: BUILDINGS[b.type].name, refund: back, site: false };
    return '';
  }

  // ---------- missiles ----------
  // Silos and air defenses load one shot at a time up to their level; other buildings only use
  // the timer for the pause after they're captured.
  stepReloads() {
    for (const b of this.buildings) {
      if (!b.alive) continue;
      if (b.type !== 'silo' && b.type !== 'aa') { if (b.cooldown > 0) b.cooldown--; continue; }
      const cap = this.shotsOf(b);
      if ((b.ammo || 0) >= cap) { b.cooldown = 0; continue; }
      if (b.cooldown <= 0) b.cooldown = b.type === 'silo' ? SILO_RELOAD : AA_RELOAD;
      if (--b.cooldown <= 0) {
        b.ammo = (b.ammo || 0) + 1;
        b.cooldown = b.ammo < cap ? (b.type === 'silo' ? SILO_RELOAD : AA_RELOAD) : 0;
        if (this.net) this.net.bld.add(b.id);
      }
    }
  }

  // Where an air defense at (ax, ay) covering r tiles first reaches a missile flying straight from
  // (sx, sy) to (tx, ty), as a share of the flight (0 to 1), within the given windows; -1 if never.
  aaReach(ax, ay, r, sx, sy, tx, ty, windows) {
    const dx = tx - sx, dy = ty - sy, L2 = dx * dx + dy * dy;
    let lo, hi;
    if (L2 < 1e-6) {
      if ((ax - sx) ** 2 + (ay - sy) ** 2 > r * r) return -1;
      lo = 0; hi = 1;
    } else {
      const s0 = ((ax - sx) * dx + (ay - sy) * dy) / L2;
      const px = sx + dx * s0 - ax, py = sy + dy * s0 - ay, d2 = px * px + py * py;
      if (d2 > r * r) return -1;
      const h = Math.sqrt((r * r - d2) / L2);
      lo = s0 - h; hi = s0 + h;
    }
    let best = -1;
    for (const [a, b] of windows) {
      const from = Math.max(lo, a, 0), to = Math.min(hi, b, 1);
      if (from <= to && (best < 0 || from < best)) best = from;
    }
    return best;
  }

  // How a missile from p to tile t would go: the silo that fires it, the nations it would hit,
  // and the air defense (if any) that would shoot it down, and where. kind is 'missile' or
  // 'space'. Air defense guards its owner and its owner's allies, never the attacker's side.
  missilePlan(p, t, kind = 'missile') {
    const space = kind === 'space';
    if (!p.counts.silo) return { err: 'Build a missile silo first.' };
    if (t < 0 || t >= this.N) return { err: 'Out of range.' };
    if (space && !this.hasSpaceSilo(p)) return { err: `Space missiles need a silo of level ${SPACE_SILO_LEVEL} or more.` };
    const W = this.W, tx = t % W, ty = (t - tx) / W;
    let silo = null, bd = Infinity, inRange = false;
    for (const b of p.blds) {
      if (b.type !== 'silo' || !b.alive || (space && (b.level || 1) < SPACE_SILO_LEVEL)) continue;
      const d = Math.hypot(tx - b.x, ty - b.y);
      if (!space && d > this.siloRange(b)) continue;
      inRange = true;
      if (b.ammo > 0 && d < bd) { bd = d; silo = b; }
    }
    if (!silo) return { err: !inRange ? 'Out of range of your silos. Stack a silo to reach further, or use a space missile.' : 'Every silo that can reach it is reloading.' };
    const [rIn, rOut] = this.missileRadii(p);
    const victims = new Set();
    for (let dy = -rOut; dy <= rOut; dy += 2) {
      for (let dx = -rOut; dx <= rOut; dx += 2) {
        if (dx * dx + dy * dy > rOut * rOut) continue;
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= W || y >= this.H) continue;
        const o = this.owner[y * W + x];
        if (o && o !== p.id) victims.add(o);
      }
    }
    const dist = Math.hypot(tx - silo.x, ty - silo.y);
    const dur = space ? Math.round(60 + dist / 6) : Math.round(25 + dist / 3.5);
    const windows = space ? [[0, SPACE_EXPOSED], [1 - SPACE_EXPOSED, 1]] : [[0, 1]];
    let aa = null, at = 2;
    for (const b of this.buildings) {
      if (!b.alive || b.type !== 'aa' || !(b.ammo > 0)) continue;
      const o = b.owner;
      if (o === p.id || this.isAllied(o, p.id)) continue;
      let guards = victims.has(o);
      if (!guards) for (const v of victims) if (this.isAllied(o, v)) { guards = true; break; }
      if (!guards) continue;
      const f = this.aaReach(b.x, b.y, this.aaRadius(b), silo.x, silo.y, tx, ty, windows);
      if (f >= 0 && f < at) { at = f; aa = b; }
    }
    return { err: '', silo, kind, tx, ty, dur, rIn, rOut, victims, aa, at: aa ? at : -1 };
  }

  launchMissile(aId, t, kind = 'missile') {
    const A = this.players[aId];
    if (!A.alive) return 'You have no nation.';
    const tgt = t >= 0 && t < this.N ? this.owner[t] : 0;
    if (tgt && this.isFriendly(aId, tgt)) return `You can't strike ${this.players[tgt].name}: they are your ally.`;
    const plan = this.missilePlan(A, t, kind);
    if (plan.err) return plan.err;
    const cost = this.missileCost(A, kind);
    if (A.gold < cost) return `A ${kind === 'space' ? 'space missile' : 'missile'} costs ${fmtMoney(cost)}.`;
    A.gold -= cost;
    A.missilesLaunched++;
    const silo = plan.silo;
    silo.ammo--;
    if (this.net) this.net.bld.add(silo.id);
    const { tx, ty, dur, rIn, rOut } = plan;
    const m = { id: this.idSeq++, owner: aId, kind, sx: silo.x, sy: silo.y, tx, ty, tile: t, t: 0, dur, interceptAt: -1, dead: false, rIn, rOut, power: 1 + A.mods.missile };
    if (plan.aa) {
      const b = plan.aa;
      b.ammo--;
      if (this.net) this.net.bld.add(b.id);
      // Shot down a moment after it comes within reach.
      m.interceptAt = clamp(Math.round(plan.at * dur) + 3, 2, dur - 1);
      m.interceptedBy = b.owner;
    }
    for (const q of this.players) if (q && q.id !== aId) this.addRel(q.id, aId, -6);
    for (const v of plan.victims) {
      this.addRel(v, aId, -40);
      if (this.players[v].human) this.log(`${A.name} launched a ${kind === 'space' ? 'space missile' : 'missile'} at you.`, 'bad', v, null, { alert: 'missile', at: t, who: aId });
    }
    this.missiles.push(m);
    if (this.net) this.net.missiles.push(m);
    return '';
  }

  stepMissiles() {
    for (const m of this.missiles) {
      if (m.dead) continue;
      m.t++;
      if (m.interceptAt >= 0 && m.t >= m.interceptAt) {
        m.dead = true;
        const f = m.t / m.dur;
        this.effects.push({ type: 'intercept', x: lerp(m.sx, m.tx, f), y: lerp(m.sy, m.ty, f), arc: f, m, at: this.time });
        if (this.net) this.net.fx.push({ type: 'intercept', mid: m.id, arc: f });
        const by = this.players[m.interceptedBy];
        const what = m.kind === 'space' ? 'space missile' : 'missile';
        if (by && by.human) this.log(`Your air defense shot down a ${what} from ${this.players[m.owner].name}.`, 'good', by.id);
        if (this.players[m.owner].human) this.log(`Your ${what} was shot down by ${by ? by.name : 'air defense'}.`, 'bad', m.owner);
        continue;
      }
      if (m.t >= m.dur) { m.dead = true; this.detonate(m); }
    }
  }

  detonate(m) {
    const W = this.W, H = this.H, R = m.rOut, Ri = m.rIn;
    const hits = new Map();
    const inner = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > R * R) continue;
        const x = m.tx + dx, y = m.ty + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        if (this.isWater(i)) continue;
        const o = this.owner[i];
        if (o) hits.set(o, (hits.get(o) || 0) + 1);
        if (d2 <= Ri * Ri + this.rng() * 8) inner.push(i);
      }
    }
    for (const [o, h] of hits) {
      const P = this.players[o];
      const f = h / Math.max(1, P.tiles);
      const lost = P.troops * Math.min(0.75, (f * 2.2 + 0.08) * m.power);
      P.troops -= lost;
      this.casualties(P, lost + Math.max(0, P.pop - P.troops) * Math.min(0.5, f * 0.6 * m.power));
      if (P.human && o !== m.owner) this.log(`A missile from ${this.players[m.owner].name} struck your land.`, 'bad', o);
    }
    for (const i of inner) {
      if (this.owner[i]) this.setOwner(i, 0);
      if (!this.fallout[i]) this.falloutList.push(i);
      this.fallout[i] = FALLOUT_SECONDS;
      this.markDirty(i);
      if (this.net) this.net.fo.push(i, 1);
    }
    for (const s of this.ships) {
      if (s.dead) continue;
      const pi = s.path[Math.min(s.path.length - 1, Math.floor(s.pos))];
      const sx = pi % W, sy = (pi - sx) / W;
      if ((sx - m.tx) ** 2 + (sy - m.ty) ** 2 <= R * R) { s.dead = true; this.casualties(this.players[s.owner], s.troops); }
    }
    const hit = [...hits.keys()];
    this.effects.push({ type: 'blast', x: m.tx + 0.5, y: m.ty + 0.5, r: R, at: this.time, hit, by: m.owner });
    if (this.net) this.net.fx.push({ type: 'blast', x: m.tx + 0.5, y: m.ty + 0.5, r: R, hit, by: m.owner });
  }

  // ---------- diplomacy ----------
  requestAlliance(from, to) {
    const A = this.players[from], B = this.players[to];
    if (!A || !B || !A.alive || !B.alive || from === to) return 'Not possible.';
    if (this.isAllied(from, to)) {
      const left = this.allianceLeft(from, to);
      if (left > RENEW_SECONDS) return `Your alliance with ${B.name} has ${fmtTime(left)} to run. You can renew it in its last two minutes.`;
    }
    const key = from * 1000 + to;
    const cd = this.reqCooldown.get(key) || 0;
    if (cd > this.tick) return `Wait ${Math.ceil((cd - this.tick) / TPS)}s before asking ${B.name} again.`;
    this.reqCooldown.set(key, this.tick + 30 * TPS);
    if (B.human) {
      if (this.requests.some((r) => r.from === from && r.to === to)) return '';
      this.requests.push({ id: this.idSeq++, from, to, kind: 'ally', expires: this.tick + 20 * TPS });
      if (A.human) this.log(`Alliance offer sent to ${B.name}.`, 'info', from);
      return '';
    }
    const ok = !B.tribe && B.ai.considerAlliance(from);
    if (ok) {
      this.formAlliance(from, to);
    } else if (A.human) {
      this.log(`${B.name} declined your alliance. They feel ${relWord(this.getRel(to, from))} toward you; gifts and peace warm them.`, 'info', from, null, { alert: 'declined', who: to });
    }
    return '';
  }

  respondRequest(reqId, accept, pid = 1) {
    const k = this.requests.findIndex((r) => r.id === reqId && r.to === pid);
    if (k < 0) return;
    const r = this.requests[k];
    this.requests.splice(k, 1);
    const A = this.players[r.from];
    if (!A.alive || !this.players[pid].alive) return;
    if (accept) this.formAlliance(r.from, pid);
    else {
      this.addRel(r.from, pid, -8);
      this.log(`You turned down ${A.name}.`, 'info', pid);
      if (A.human) this.log(`${this.players[pid].name} declined your alliance.`, 'info', A.id, null, { alert: 'declined', who: pid });
    }
  }

  allyKey(a, b) { return Math.min(a, b) * this.P + Math.max(a, b); }
  // Seconds an alliance has left to run.
  allianceLeft(a, b) {
    const until = this.allyUntil.get(this.allyKey(a, b));
    return until === undefined ? 0 : Math.max(0, Math.ceil((until - this.tick) / TPS));
  }
  // Once a second: alliances lapse after five minutes unless they have been renewed.
  expireAlliances() {
    for (const [k, until] of this.allyUntil) {
      // A minute before an alliance lapses, players in it are told, with a way to renew.
      if (this.tick < until) {
        if (until - this.tick <= 60 * TPS && !this.allyWarned.has(k)) {
          this.allyWarned.add(k);
          const a = Math.floor(k / this.P), b = k % this.P, A = this.players[a], B = this.players[b];
          if (A && A.human && A.alive) this.log(`Your alliance with ${B.name} ends in a minute. Renew it to keep it.`, 'info', a, null, { alert: 'expiring', who: b });
          if (B && B.human && B.alive) this.log(`Your alliance with ${A.name} ends in a minute. Renew it to keep it.`, 'info', b, null, { alert: 'expiring', who: a });
        }
        continue;
      }
      this.allyUntil.delete(k);
      const a = Math.floor(k / this.P), b = k % this.P, A = this.players[a], B = this.players[b];
      if (!A || !B || !A.allies.has(b)) continue;
      A.allies.delete(b); B.allies.delete(a);
      this.allyWarned.delete(k);
      if (A.human) this.log(`Your alliance with ${B.name} has expired. Propose a new one to renew it.`, 'info', a, null, { alert: 'expired', who: b });
      if (B.human) this.log(`Your alliance with ${A.name} has expired. Propose a new one to renew it.`, 'info', b, null, { alert: 'expired', who: a });
    }
  }

  formAlliance(a, b) {
    const A = this.players[a], B = this.players[b];
    const renewal = this.isAllied(a, b);
    this.allyUntil.set(this.allyKey(a, b), this.tick + ALLIANCE_SECONDS * TPS);
    this.allyWarned.delete(this.allyKey(a, b));
    if (renewal) {
      if (A.human) this.log(`You renewed your alliance with ${B.name} for another five minutes.`, 'good', a, null, { alert: 'allied', who: b });
      if (B.human) this.log(`You renewed your alliance with ${A.name} for another five minutes.`, 'good', b, null, { alert: 'allied', who: a });
      return;
    }
    A.allies.add(b); B.allies.add(a);
    this.addRel(a, b, 15); this.addRel(b, a, 15);
    for (const x of this.attacks) {
      if (x.dead) continue;
      if ((x.attacker === a && x.target === b) || (x.attacker === b && x.target === a)) {
        this.players[x.attacker].troops += x.troops; x.troops = 0; x.dead = true;
      }
    }
    if (A.human) this.log(`You are now allied with ${B.name} for five minutes.`, 'good', a, null, { alert: 'allied', who: b });
    if (B.human) this.log(`You are now allied with ${A.name} for five minutes.`, 'good', b, null, { alert: 'allied', who: a });
    if (this.concernsHuman(a, b)) this.log(`${A.name} and ${B.name} formed an alliance.`, 'info', 0, [a, b]);
  }

  breakAlliance(a, b) {
    const A = this.players[a], B = this.players[b];
    if (!this.isAllied(a, b)) return;
    A.allies.delete(b); B.allies.delete(a);
    this.allyUntil.delete(this.allyKey(a, b));
    this.allyWarned.delete(this.allyKey(a, b));
    A.traitorUntil = this.tick + 45 * TPS;
    for (const q of this.players) if (q && q.id !== a) this.addRel(q.id, a, -18);
    this.addRel(b, a, -50);
    if (this.politics) A.shock += 8;
    if (A.human) this.log(`You broke your alliance with ${B.name}. Others will trust you less, and your land is easier to take for 45s.`, 'bad', a);
    if (B.human) this.log(`${A.name} broke its alliance with you.`, 'bad', b, null, { alert: 'betrayed', who: a });
    if (this.concernsHuman(a, b)) this.log(`${A.name} broke its alliance with ${B.name}.`, 'info', 0, [a, b]);
  }

  // Worth telling the player about: a neighbor of theirs, or a bloc that dominates the map.
  concernsHuman(a, b) {
    for (const h of this.players) {
      if (!h || !h.human || !h.alive) continue;
      const nb = this.neighbors[h.id];
      if (nb && (nb.has(a) || nb.has(b))) return true;
    }
    return (this.players[a].tiles + this.players[b].tiles) > this.map.landCount * 0.3;
  }

  sendTroops(from, to, amount) {
    const A = this.players[from], B = this.players[to];
    if (!this.isAllied(from, to)) return 'You can only reinforce allies.';
    amount = Math.floor(Math.min(amount, A.troops));
    if (amount < 1) return 'No troops to send.';
    A.troops -= amount; B.troops += amount;
    A.pop = Math.max(0, A.pop - amount); B.pop += amount;
    this.addRel(to, from, Math.min(25, 5 + amount / Math.max(500, B.troops) * 20));
    if (A.human) this.log(`Sent ${fmt(amount)} troops to ${B.name}.`, 'good', from);
    if (B.human) this.log(`${A.name} sent you ${fmt(amount)} troops.`, 'good', to);
    return '';
  }

  sendGold(from, to, amount) {
    const A = this.players[from], B = this.players[to];
    if (!B || !B.alive) return 'Not possible.';
    amount = Math.floor(Math.min(amount, A.gold));
    if (amount < 1) return 'No money to send.';
    A.gold -= amount; B.gold += amount;
    const gain = clamp((amount / Math.max(400 * MONEY, B.gold * 0.5)) * 25, 1, 35);
    this.addRel(to, from, gain);
    if (A.human) this.log(`Sent ${fmtMoney(amount)} to ${B.name}.${B.human ? '' : ` Relation +${Math.round(gain)}.`}`, 'good', from);
    if (B.human) this.log(`${A.name} sent you ${fmtMoney(amount)}.`, 'good', to);
    return '';
  }

  // ---------- politics ----------
  setMartial(pid, on) {
    const p = this.players[pid];
    if (!this.politics) return 'There are no politics in Blitz.';
    p.martial = !!on;
    if (p.human) this.log(on ? 'Martial law declared. Order improves, but trade and growth suffer.' : 'Martial law lifted.', 'info', pid);
    return '';
  }
  // Tax relief: less income, more contentment, and families grow faster.
  setTaxRelief(pid, on) {
    const p = this.players[pid];
    if (!this.politics) return 'There are no politics in Blitz.';
    p.taxRelief = !!on;
    if (p.human) this.log(on ? 'Taxes lowered. Your people are happier and families grow faster, but income falls.' : 'Taxes restored.', 'info', pid);
    return '';
  }
  celebrateCost(p) { return nicePrice(Math.max(400 * MONEY, p.income * 25)); }
  celebrate(pid) {
    const p = this.players[pid];
    if (!this.politics) return 'There are no politics in Blitz.';
    if (p.celebrateReadyAt > this.tick) return `Your people are still recovering from the last festival (${Math.ceil((p.celebrateReadyAt - this.tick) / TPS)}s).`;
    const cost = this.celebrateCost(p);
    if (p.gold < cost) return `A celebration costs ${fmt(cost)} gold.`;
    p.gold -= cost;
    p.boost = Math.min(30, p.boost + 15);
    p.celebrateReadyAt = this.tick + 60 * TPS;
    if (p.human) this.log('Festivals across the land. Stability rises for a while.', 'good', pid);
    return '';
  }

  // Spread administrative reach outward from the capital, cities and courthouses.
  computeAdmin() {
    const W = this.W, own = this.owner, S = this.adminSlack;
    const OFF = 64, MIN = -40, MAX = 60;
    S.fill(-128);
    const B = this._buckets;
    for (let k = 0; k <= OFF + MAX; k++) { if (B[k]) B[k].length = 0; else B[k] = []; }
    const seed = (t, r) => { r = Math.min(r, MAX); if (r > S[t]) { S[t] = r; B[r + OFF].push(t); } };
    for (const p of this.players) {
      if (!p || !p.alive) continue;
      if (p.capital >= 0 && own[p.capital] === p.id) seed(p.capital, ADMIN_RADIUS.capital);
      for (const b of p.blds) {
        const r = ADMIN_RADIUS[b.type];
        if (r) seed(b.tile, r + 3 * ((b.level || 1) - 1));
      }
    }
    for (let s = MAX; s > MIN; s--) {
      const L = B[s + OFF];
      const ns = s - 1;
      for (let k = 0; k < L.length; k++) {
        const t = L[k];
        if (S[t] !== s) continue;
        const o = own[t], x = t % W;
        if (x > 0 && own[t - 1] === o && S[t - 1] < ns) { S[t - 1] = ns; B[ns + OFF].push(t - 1); }
        if (x < W - 1 && own[t + 1] === o && S[t + 1] < ns) { S[t + 1] = ns; B[ns + OFF].push(t + 1); }
        if (t >= W && own[t - W] === o && S[t - W] < ns) { S[t - W] = ns; B[ns + OFF].push(t - W); }
        if (t + W < this.N && own[t + W] === o && S[t + W] < ns) { S[t + W] = ns; B[ns + OFF].push(t + W); }
      }
      L.length = 0;
    }
  }

  maxControl(t) {
    const s = this.adminSlack[t];
    if (s >= 0) return 100;
    if (s === -128) return 15;
    return Math.max(16, 100 + s * 3);
  }

  // Land drifts toward the control its distance from administration allows.
  updateControl() {
    const C = this.control, own = this.owner, T = this.map.terrain, N = this.N;
    const P = this.players.length;
    const sum = new Float64Array(P), eff = new Float64Array(P);
    for (let t = 0; t < N; t++) {
      const o = own[t];
      if (!o) continue;
      const target = this.maxControl(t);
      let c = C[t];
      if (c < target) {
        // Land well inside the reach of a capital or building integrates twice as fast.
        const nc = Math.min(target, c + (this.adminSlack[t] >= 6 ? 2 : 1));
        if (c < 50 && nc >= 50) { this.markDirty(t); if (this.net) this.net.ctl.push(t, nc); }
        c = nc;
      } else if (c > target) {
        const nc = Math.max(target, c - 1);
        if (c >= 50 && nc < 50) { this.markDirty(t); if (this.net) this.net.ctl.push(t, nc); }
        c = nc;
      }
      C[t] = c;
      sum[o] += c;
      eff[o] += T_VALUE[T[t]] * (0.3 + 0.007 * c);
    }
    for (let k = 1; k < P; k++) {
      const p = this.players[k];
      if (!p.alive) continue;
      p.avgControl = p.tiles ? sum[k] / p.tiles : 100;
      p.effValue = eff[k];
    }
  }

  updateStability(p) {
    const over = p.tiles > p.adminCap ? Math.min(30, (p.tiles / p.adminCap - 1) * 35) : 0;
    const ctrl = (1 - p.avgControl / 100) * 28;
    const war = Math.min(20, (p.weariness / Math.max(5000, p.pop)) * 160 * Math.max(0.2, 1 + p.mods.weariness));
    const burden = Math.abs(p.focus - 0.5) * 20;
    const share = this.landShare(p);
    // Strain climbs steeply past half the world, so runaway empires stall short of 70%.
    const size = Math.min(55, share * 56 + Math.max(0, share - 0.45) * 80 + Math.max(0, share - 0.55) * 100);
    // Troops at home keep order; a nation that has sent its army away feels it.
    const ranks = p.troops / Math.max(1, this.troopCap(p));
    const garrison = clamp((ranks - 0.35) * 14, -5, 6);
    // People with room to grow (new land, new cities) are content; a nation that has lost the
    // land or cities that fed its people is overcrowded and restless.
    const crowd = p.pop / Math.max(1, p.popCap);
    const fed = crowd <= 1 ? clamp((1 - crowd) / 0.15 * 4, 0, 4) : -clamp((crowd - 1.03) * 60, 0, 12);
    const f = [['Base', 58]];
    const techStab = p.mods.stability - p.ideoStab;
    if (Math.abs(techStab) >= 0.5) f.push(['Technology', techStab]);
    if (Math.abs(p.ideoStab) >= 0.5) f.push([p.ideology ? IDEOLOGY_BY_ID[p.ideology].name : 'Ideology', p.ideoStab]);
    if (p.martial) f.push(['Martial law', 15]);
    if (p.taxRelief) f.push(['Tax relief', 8]);
    if (Math.abs(garrison) >= 0.5) f.push([garrison > 0 ? 'Garrisons at home' : 'Army away from home', garrison]);
    if (Math.abs(fed) >= 0.5) f.push([fed > 0 ? 'Room to grow' : 'Overcrowding', fed]);
    if (p.boost >= 0.5) f.push(['Celebrations', p.boost]);
    if (p.glory >= 0.5) f.push(['Victories', p.glory]);
    if (over >= 0.5) f.push(['Overextension', -over]);
    if (ctrl >= 0.5) f.push(['Unintegrated land', -ctrl]);
    if (size >= 0.5) f.push(['Imperial strain', -size]);
    if (war >= 0.5) f.push(['War weariness', -war]);
    if (burden >= 0.5) f.push(['Taxes and levies', -burden]);
    if (p.shock >= 0.5) f.push(['Turmoil', -p.shock]);
    let target = 0;
    for (const [, v] of f) target += v;
    p.stabTarget = clamp(target, 0, 100);
    p.stabFactors = f;
    p.stability += clamp(p.stabTarget - p.stability, -1.5, 1.5);
    p.boost = Math.max(0, p.boost - 0.25);
    p.shock = Math.max(0, p.shock - 0.25);
    p.glory = Math.max(0, p.glory - 0.08);
  }

  // The most restless spot: poorly controlled land far from the capital. Sampled, so it is cheap.
  findUnrest(p) {
    const W = this.W, own = this.owner, C = this.control, bb = p.bbox, rng = this.rng;
    const bw = bb[2] - bb[0] + 1, bh = bb[3] - bb[1] + 1;
    if (bw <= 0 || bh <= 0) return -1;
    // Keep warning about the same place while it stays restless.
    if (p.unrest >= 0 && own[p.unrest] === p.id && C[p.unrest] < 70) return p.unrest;
    const cx = p.capital % W, cy = Math.floor(p.capital / W);
    let seed = -1, best = -1e9;
    for (let k = 0; k < 400; k++) {
      const t = (bb[1] + rng.int(bh)) * W + bb[0] + rng.int(bw);
      if (own[t] !== p.id || C[t] >= 80 || t === p.capital) continue;
      const x = t % W, y = (t - x) / W;
      const s = -C[t] + Math.hypot(x - cx, y - cy) * 0.3;
      if (s > best) { best = s; seed = t; }
    }
    return seed;
  }

  // Which way a tile lies from a nation's capital, as a reader would say it: "north-east".
  compass(p, t) {
    const W = this.W, cx = p.capital % W, cy = Math.floor(p.capital / W), dx = t % W - cx, dy = Math.floor(t / W) - cy;
    if (Math.hypot(dx, dy) < 8) return 'heartland';
    const a = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360;
    return ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'][Math.round(a / 45) % 8];
  }

  // A restless, poorly controlled region breaks away as a new nation.
  revolt(p) {
    const W = this.W, own = this.owner, C = this.control, bb = p.bbox, rng = this.rng;
    const bw = bb[2] - bb[0] + 1, bh = bb[3] - bb[1] + 1;
    if (bw <= 0 || bh <= 0) return false;
    // The region players were warned about, if it's still restless.
    let seed = p.unrest >= 0 && own[p.unrest] === p.id && C[p.unrest] < 80 && p.unrest !== p.capital ? p.unrest : this.findUnrest(p);
    if (seed < 0) return false;
    const sx = seed % W, sy = (seed - sx) / W, R2 = 14 * 14;
    const st = this.nextStamp(), Q = this.bfsQueue, S = this.bfsStamp;
    let qh = 0, qt = 0;
    Q[qt++] = seed; S[seed] = st;
    while (qh < qt && qt < 1200) {
      const i = Q[qh++];
      const x = i % W, y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i + W < this.N ? i + W : -1];
      for (const n of nb) {
        if (n < 0 || S[n] === st || own[n] !== p.id || C[n] >= 85 || n === p.capital) continue;
        const nx = n % W, ny = (n - nx) / W;
        if ((nx - sx) ** 2 + (ny - sy) ** 2 > R2) continue;
        S[n] = st; Q[qt++] = n;
      }
    }
    if (qt < 25) return false;
    const region = Array.from(Q.subarray(0, qt));
    const frac = region.length / Math.max(1, p.tiles);
    const civ = Math.max(0, p.pop - p.troops - p.field) * frac;
    const defect = p.troops * frac * 0.6;
    p.troops -= defect;
    p.pop = Math.max(0, p.pop - civ - defect);
    p.stability = Math.min(100, p.stability + 12);

    if (this.players.length < this.P && this.spareNames.length) {
      const id = this.players.length;
      const r = new Player(id, this.spareNames.shift(), this.spareColors.shift() || hslToRgb(rng() * 360, 0.6, 0.5), false);
      this.initPlayer(r);
      for (const tid of p.techs) { r.techs.add(tid); const fx = techFx(TECH_BY_ID[tid], this.mode); if (fx) for (const k in fx) r.mods[k] += fx[k]; }
      r.diffMult = this.diff.econ;
      r.rebelOf = p.id;
      this.players.push(r);
      r.ai = new AIController(this, r, PERSONALITIES[3], this.diff);
      r.spawned = true;
      r.capital = seed;
      r.stability = 70;
      r.troops = defect + civ * 0.05;
      r.pop = civ + r.troops;
      r.gold = Math.floor(p.gold * frac);
      p.gold -= r.gold;
      for (const t of region) { this.setOwner(t, id); this.setControl(t, 75); }
      this.rel[id * this.P + p.id] = -90;
      this.rel[p.id * this.P + id] = -90;
      r.label = { x: sx + 0.5, y: sy + 0.5, size: 3, tile: seed };
      if (p.human) this.log(`Revolt! ${r.name} rose up in the ${this.compass(p, seed)} and broke away from your nation, taking ${fmt(region.length)} tiles.`, 'revolt', p.id, null, { alert: 'revolt', at: seed, who: id });
      if (this.concernsHuman(p.id, p.id)) this.log(`${r.name} broke away from ${p.name} in a revolt.`, 'info', 0, [p.id]);
    } else {
      for (const t of region) this.setOwner(t, 0);
      if (p.human) this.log(`Revolt! A region in the ${this.compass(p, seed)} rose up and fell into anarchy.`, 'revolt', p.id, null, { alert: 'revolt', at: seed });
    }
    this.computeAdmin();
    return true;
  }

  // ---------- encirclement ----------
  // Any patch of land touched only by one other nation (no sea, no third party) is annexed by it,
  // unless it belongs to an ally. Large cut-off pockets of a nation hold out.
  annexEnclaves() {
    const W = this.W, H = this.H, N = this.N, own = this.owner, T = this.map.terrain, fo = this.fallout;
    const st = this.nextStamp(), S = this.bfsStamp, Q = this.bfsQueue;
    for (let s = 0; s < N; s++) {
      if (S[s] === st || T[s] <= T_SEA) continue;
      const X = own[s];
      let qh = 0, qt = 0, enc = -1, open = false, bad = false;
      Q[qt++] = s; S[s] = st;
      while (qh < qt) {
        const i = Q[qh++];
        if (fo[i]) bad = true;
        const x = i % W, y = (i - x) / W;
        for (let k = 0; k < 4; k++) {
          let n;
          if (k === 0) { if (x === 0) { open = true; continue; } n = i - 1; }
          else if (k === 1) { if (x === W - 1) { open = true; continue; } n = i + 1; }
          else if (k === 2) { if (y === 0) { open = true; continue; } n = i - W; }
          else { if (y === H - 1) { open = true; continue; } n = i + W; }
          if (T[n] <= T_SEA) { open = true; continue; }
          const o = own[n];
          if (o === X) { if (S[n] !== st) { S[n] = st; Q[qt++] = n; } continue; }
          if (enc === -1) enc = o; else if (enc !== o) open = true;
        }
      }
      if (open || bad || enc <= 0) continue;
      const P = this.players[enc];
      if (!P.alive || (X && this.isFriendly(X, enc))) continue;
      if (X) {
        const D = this.players[X];
        let hasCap = false;
        for (let k = 0; k < qt; k++) if (Q[k] === D.capital) { hasCap = true; break; }
        if (qt > Math.max(60, D.tiles * 0.1) || (hasCap && qt > 60)) continue;
      }
      this.annexRegion(P, X ? this.players[X] : null, Array.from(Q.subarray(0, qt)));
    }
  }

  // The most land a beaten nation can hold and still surrender, from its peak size.
  remnantSize(p) {
    const k = p.tribe ? 'tribe' : p.human ? 'human' : 'nation';
    return Math.max(REMNANT_MIN, Math.min(REMNANT_MAX[k], Math.round(p.peakTiles * REMNANT_SHARE[k])));
  }

  // Every few seconds: any nation or tribe down to a remnant, with an enemy still taking its land,
  // surrenders everything it has left to that enemy, who also takes its treasury.
  surrenderRemnants() {
    const W = this.W, own = this.owner;
    for (const D of this.players) {
      if (!D || !D.alive || !D.spawned || D.tiles <= 0 || D.tiles > this.remnantSize(D)) continue;
      const P = this.players[D.lastHitBy];
      if (!P || !P.alive || P === D || this.tick - D.lastHitAt > REMNANT_SECONDS * TPS || this.isFriendly(D.id, P.id)) continue;
      const [x0, y0, x1, y1] = D.bbox, region = [];
      for (let y = Math.max(0, y0); y <= y1 && region.length < D.tiles; y++) {
        for (let x = Math.max(0, x0), t = y * W + x; x <= x1; x++, t++) if (own[t] === D.id) region.push(t);
      }
      if (P.human) this.log(`The last of ${D.tribe ? 'the ' : ''}${D.name} surrendered to you.`, 'good', P.id);
      if (D.human) this.log(`Your last ${fmt(D.tiles)} tiles surrendered to ${P.name}.`, 'bad', D.id);
      const density = D.troops / Math.max(1, D.tiles);
      for (const t of region) this.takeTile(t, P, D, density);
    }
  }

  annexRegion(P, D, region) {
    const density = D ? D.troops / Math.max(1, D.tiles) : 0;
    for (const t of region) this.takeTile(t, P, D, density);
    const n = region.length;
    // Fronts pinch off tiny pockets all the time; only announce real encirclements.
    if (P.human && n >= (D ? 25 : 60)) this.log(`You annexed ${fmt(n)} encircled tiles${D ? ' from ' + D.name : ''}.`, 'good', P.id);
    if (D && D.human && n >= 25) this.log(`${P.name} annexed ${fmt(n)} of your tiles that were cut off.`, 'bad', D.id);
    if (D && !D.tribe && !P.tribe && n >= 25) this.addRel(D.id, P.id, -6);
  }

  // ---------- periodic ----------
  economy() {
    const dt = 1 / TPS, M = this.mode;
    for (let k = 1; k < this.players.length; k++) {
      const p = this.players[k];
      if (!p.alive || !p.spawned) continue;
      const sf = this.stabFactor(p);
      // Population grows toward what the land can feed.
      const cap = this.popCapOf(p);
      p.popCap = cap;
      let pg;
      if (p.pop < cap) {
        pg = (5 + M.popGrowth * (1 + p.mods.popGrowth) * p.pop * (1 - p.pop / cap)) *
          (M.politics ? 0.5 + p.stability / 100 : 1) * (p.martial ? 0.7 : 1) * (p.taxRelief ? 1.25 : 1) * p.diffMult;
      } else {
        pg = (cap - p.pop) * 0.03;
      }
      p.pop = Math.max(0, p.pop + pg * dt);
      p.popGrowth = pg;
      // Recruits come from the population, up to the mobilization limit.
      const tcap = this.troopCap(p);
      const b = p.counts.barracks;
      const mult = (1.3 - 0.6 * p.focus) * (1 + 0.25 * Math.min(b, 5) + 0.08 * Math.max(0, b - 5) + 0.15 * p.counts.factory) *
        (1 + p.mods.recruit) * sf * p.diffMult;
      let g = (12 + Math.pow(Math.max(p.troops, 0), 0.72) * 0.95) * (1 - p.troops / tcap) * mult;
      if (p.troops > tcap) g = (tcap - p.troops) * 0.05;
      p.troops += g * dt;
      if (p.troops > p.pop) p.troops = p.pop;
      p.growth = g;
      // Workers pay taxes; cities, harbors and factories add their own earnings.
      const workers = Math.max(0, p.pop - p.troops - p.field);
      const inc = (3 + workers * 0.0002 + p.counts.city * BLD_EARN.city + p.counts.harbor * this.harborEarn(p) +
        p.counts.factory * BLD_EARN.factory + this.railEarn(p)) * this.incomeMult(p);
      // Research is funded from income; nothing is spent while there's nothing to research.
      const spend = p.research ? inc * p.science : 0;
      p.gold += (inc - spend) * dt;
      p.income = inc - spend;
      p.grossIncome = inc;
      p.researchSpend = spend;
      // Research: a base from people and universities, plus whatever the budget buys.
      const rp = ((0.6 + Math.sqrt(p.pop) * 0.0045 + p.counts.university * 2) * p.diffMult + spend / RP_PRICE) *
        (1 + p.mods.research) * sf * M.research;
      p.rpRate = rp;
      if (p.research) {
        const t = TECH_BY_ID[p.research];
        const v = (p.progress[t.id] || 0) + rp * dt;
        if (v >= this.techCost(p, t)) this.completeTech(p, t);
        else p.progress[t.id] = v;
      }
    }
  }

  perSecond() {
    const P = this.P, NP = this.players.length;
    // Relations drift.
    const fighting = new Set();
    for (const a of this.attacks) {
      if (a.dead || !a.target) continue;
      fighting.add(a.attacker * P + a.target);
      fighting.add(a.target * P + a.attacker);
      this.addRel(a.target, a.attacker, -1.2);
    }
    for (let i = 1; i < NP; i++) {
      const pi = this.players[i];
      if (!pi.alive) continue;
      const nb = this.neighbors[i];
      for (let j = 1; j < NP; j++) {
        if (i === j) continue;
        const k = i * P + j;
        this.rel[k] *= 0.997;
        if (fighting.has(k)) continue;
        if (pi.allies.has(j)) this.rel[k] = Math.min(100, this.rel[k] + 0.35);
        else if (nb.has(j)) this.rel[k] = Math.min(60, this.rel[k] + 0.12);
      }
    }
    // Fallout clears.
    for (let k = this.falloutList.length - 1; k >= 0; k--) {
      const i = this.falloutList[k];
      if (--this.fallout[i] <= 0) {
        this.fallout[i] = 0;
        this.markDirty(i);
        if (this.net) this.net.fo.push(i, 0);
        this.falloutList[k] = this.falloutList[this.falloutList.length - 1];
        this.falloutList.pop();
      }
    }
    this.totalHarbors = 0;
    for (const p of this.players) if (p && p.alive) { this.totalHarbors += p.counts.harbor; p.field = 0; }
    for (const a of this.attacks) if (!a.dead) this.players[a.attacker].field += a.troops;
    for (const s of this.ships) if (!s.dead) this.players[s.owner].field += s.troops;
    this.scanNeighbors();

    // Capitals, research and the calendar.
    for (let k = 1; k < NP; k++) {
      const p = this.players[k];
      if (!p.alive || !p.spawned) continue;
      if (p.capital < 0 || this.owner[p.capital] !== p.id) this.relocateCapital(p);
      if (p.human && !p.ideology && !p.ideologyHinted && this.time > 45) {
        p.ideologyHinted = true;
        this.log('Your nation has no ideology yet. Press G or open Government to choose one.', 'info', p.id);
      }
      if (!p.research) {
        const pick = p.ai ? p.ai.pickResearch() : this.autoPickResearch(p);
        if (pick) {
          p.research = pick;
          if (p.human && !p.autoResearch) {
            p.autoResearch = true;
            this.log(`Now researching ${TECH_BY_ID[pick].name}. Open Technology to choose another.`, 'info', p.id);
          }
        }
      }
    }
    this.updateTreaty();
    if (this.mode.endYear) {
      const left = this.mode.endYear - this.year;
      const warnAt = this.mode.endYear - START_YEAR > 300 ? [50, 10] : [25, 5];
      for (const w of warnAt) {
        if (left === w && !this.announced.has('end' + w)) {
          this.announced.add('end' + w);
          this.log(`${w} years remain. When ${this.mode.endYear} arrives, the largest nation wins.`, 'bad');
        }
      }
    }
    const era = eraIndex(this.year);
    if (era !== this.lastEra) {
      this.lastEra = era;
      this.log(`A new era begins: ${ERAS[era].name}.`, 'good');
    }
    if (this.mode.timeGate) {
      const fresh = TECHS.filter((t) => t.year <= this.year && t.year > START_YEAR && !this.announced.has(t.id));
      for (const t of fresh) this.announced.add(t.id);
      for (const h of this.humans()) {
        if (!h.alive) continue;
        const usable = fresh.filter((t) => this.techState(h, t) === 'avail');
        if (usable.length) this.log(`New technology available: ${usable.map((t) => t.name).join(', ')}.`, 'info', h.id);
      }
    }

    if (this.politics) {
      if (this.tick % (3 * TPS) === 0) this.computeAdmin();
      this.updateControl();
      for (let k = 1; k < NP; k++) {
        const p = this.players[k];
        if (!p.alive || !p.spawned || p.tribe) continue;
        p.adminCap = this.adminCapOf(p);
        p.weariness *= 0.985;
        this.updateStability(p);
        if (p.stability < REVOLT_BELOW && p.tiles > 120 && this.time > 120 && this.tick - (p.lastRevolt || -1e9) > 90 * TPS) {
          const chance = (REVOLT_BELOW - p.stability) / REVOLT_BELOW * 0.04;
          if (this.rng() < chance && this.revolt(p)) p.lastRevolt = this.tick;
        }
      }
      // Where a revolt would break out, found ahead of time so players can be warned and act.
      if (this.tick % (5 * TPS) === 0) {
        for (let k = 1; k < NP; k++) {
          const p = this.players[k];
          if (!p.alive || !p.spawned || p.tribe) continue;
          p.unrest = p.stability < REVOLT_BELOW + 12 && p.tiles > 120 ? this.findUnrest(p) : -1;
        }
      }
      for (const h of this.humans()) {
        if (h.alive && h.unrest >= 0 && h.stability < REVOLT_BELOW + 6 && this.time - h.unrestWarnedAt > 45) {
          h.unrestWarnedAt = this.time;
          this.log(`Unrest is spreading in the ${this.compass(h, h.unrest)} (stability ${Math.round(h.stability)}). Below ${REVOLT_BELOW}, that region may break away. A building there settles the land around it.`, 'warn', h.id, null, { alert: 'unrest', at: h.unrest });
        }
      }
    }

    this.updateTrade();
    this.expireAlliances();
    this.requests = this.requests.filter((r) => r.expires > this.tick && this.players[r.from].alive);
    this.effects = this.effects.filter((e) => this.time - e.at < 4);
    this.checkGameOver();
  }

  relocateCapital(p) {
    const had = p.capital >= 0;
    let best = -1, bestD = -1;
    for (const b of p.blds) {
      if (b.type !== 'city') continue;
      const d = this.distField[b.tile];
      if (d > bestD) { bestD = d; best = b.tile; }
    }
    if (best < 0 && p.label.tile >= 0 && this.owner[p.label.tile] === p.id) best = p.label.tile;
    if (best < 0) {
      const bb = p.bbox;
      for (let k = 0; k < 2000 && best < 0; k++) {
        const t = (bb[1] + this.rng.int(bb[3] - bb[1] + 1)) * this.W + bb[0] + this.rng.int(bb[2] - bb[0] + 1);
        if (this.owner[t] === p.id) best = t;
      }
    }
    p.capital = best;
    if (!had || best < 0) return;
    if (this.politics) {
      // The first fall shakes the country; losing the new seat soon after adds less.
      p.shock = Math.min(30, p.shock + (p.shock > 10 ? 6 : 15));
      const by = this.players[p.lastHitBy];
      if (by && by.alive && this.tick - p.lastHitAt < 5 * TPS) by.glory = Math.min(GLORY_MAX, by.glory + 4);
    }
    if (p.human && this.time - (p.capitalLogAt || -1e9) > 20) {
      p.capitalLogAt = this.time;
      this.log(this.politics ? 'Your capital fell. The government moved, and the country is in turmoil.' : 'Your capital fell. The government moved to safer ground.', 'bad', p.id, null, { alert: 'capital', at: best });
    }
    if (this.politics) this.computeAdmin();
  }

  scanNeighbors() {
    const W = this.W, H = this.H, own = this.owner, T = this.map.terrain, coast = this.map.coast, fo = this.fallout;
    const NB = this.neighbors;
    for (const m of NB) m.clear();
    for (const p of this.players) if (p) p.coastal = 0;
    const inc = (a, b) => { const m = NB[a]; m.set(b, (m.get(b) || 0) + 1); };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const oi = own[i];
        if (oi && coast[i]) this.players[oi].coastal++;
        if (x < W - 1) {
          const j = i + 1, oj = own[j];
          if (oi !== oj) {
            if (oi && oj) { inc(oi, oj); inc(oj, oi); }
            else if (oi) { if (T[j] > T_SEA && !fo[j]) inc(oi, 0); }
            else if (T[i] > T_SEA && !fo[i]) inc(oj, 0);
          }
        }
        if (y < H - 1) {
          const j = i + W, oj = own[j];
          if (oi !== oj) {
            if (oi && oj) { inc(oi, oj); inc(oj, oi); }
            else if (oi) { if (T[j] > T_SEA && !fo[j]) inc(oi, 0); }
            else if (T[i] > T_SEA && !fo[i]) inc(oj, 0);
          }
        }
      }
    }
  }

  // Distance-to-border field: places name labels and helps the AI pick building spots.
  computeLabels() {
    const W = this.W, H = this.H, own = this.owner, d = this.distField;
    const P = this.players.length;
    const bb = this.players.map(() => [1e9, 1e9, -1, -1]);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, o = own[i];
        if (!o) { d[i] = 0; continue; }
        const b = bb[o];
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
            own[i - 1] !== o || own[i + 1] !== o || own[i - W] !== o || own[i + W] !== o) { d[i] = 1; continue; }
        let v = d[i - 1] + 1;
        const u = d[i - W] + 1; if (u < v) v = u;
        const ul = d[i - W - 1] + 1.414; if (ul < v) v = ul;
        const ur = d[i - W + 1] + 1.414; if (ur < v) v = ur;
        d[i] = v;
      }
    }
    const best = new Float32Array(P), bestI = new Int32Array(P).fill(-1);
    for (let y = H - 1; y >= 0; y--) {
      for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x, o = own[i];
        if (!o) continue;
        let v = d[i];
        if (v > 1) {
          const r = d[i + 1] + 1; if (r < v) v = r;
          const dn = d[i + W] + 1; if (dn < v) v = dn;
          const dr = d[i + W + 1] + 1.414; if (dr < v) v = dr;
          const dl = d[i + W - 1] + 1.414; if (dl < v) v = dl;
          d[i] = v;
        }
        if (v > best[o]) { best[o] = v; bestI[o] = i; }
      }
    }
    for (let k = 1; k < P; k++) {
      const p = this.players[k];
      if (!p.alive) continue;
      if (bb[k][2] >= 0) p.bbox = bb[k];
      if (bestI[k] < 0) continue;
      const old = p.label.tile;
      if (old >= 0 && own[old] === k && d[old] >= best[k] * 0.85) {
        p.label.size = d[old];
        continue;
      }
      const i = bestI[k];
      p.label = { x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, size: best[k], tile: i };
    }
  }

  largestNation() {
    let top = null;
    for (const p of this.players) if (p && p.alive && !p.tribe && (!top || p.tiles > top.tiles)) top = p;
    return top || this.players.find((p) => p && p.alive) || this.players[1];
  }

  // Near the end of the calendar the great powers propose a general peace. If every player still
  // in the game signs, the game ends there and the largest nation wins; one refusal and the war
  // goes on. It is offered twice, at 80% and 92% of the way to the final year.
  updateTreaty() {
    const T = this.treaty;
    if (T && T.open) {
      const voters = this.humans().filter((h) => h.alive);
      if (voters.some((h) => T.votes.get(h.id) === false) || this.tick >= T.closesAt) {
        T.open = false;
        const no = voters.find((h) => T.votes.get(h.id) === false);
        const msg = !no ? 'The general peace went unsigned. The war goes on.'
          : this.multiplayer ? `${no.name} refused the general peace. The war goes on.` : 'You refused the general peace. The war goes on.';
        for (const h of voters) this.log(msg, 'info', h.id);
      } else if (voters.length && voters.every((h) => T.votes.get(h.id) === true)) {
        T.open = false;
        T.signed = true;
      }
      return;
    }
    if (!this.mode.endYear || this.over || this.coached || this.treatyRound >= TREATY_AT.length) return;
    const progress = (this.year - START_YEAR) / (this.mode.endYear - START_YEAR);
    if (progress < TREATY_AT[this.treatyRound]) return;
    this.treatyRound++;
    this.treaty = { id: this.idSeq++, open: true, closesAt: this.tick + TREATY_SECONDS * TPS, votes: new Map() };
    for (const h of this.humans()) if (h.alive) this.log('Envoys of the great powers propose a general peace. Sign it to end the game now.', 'info', h.id);
  }

  checkGameOver() {
    if (this.over || !this.started) return;
    const end = (winner, reason) => { this.over = { winner, reason, time: this.time, year: this.year }; };
    let top = null;
    for (const p of this.players) {
      if (!p || !p.alive) continue;
      if (!top || p.tiles > top.tiles) top = p;
      if (!this.coached && this.landShare(p) >= WIN_SHARE) { end(p.id, 'share'); return; }
    }
    const humans = this.humans();
    if (!humans.some((h) => h.alive)) { end(top ? top.id : 0, 'fallen'); return; }
    if (this.coached) return;
    if (this.treaty && this.treaty.signed) { end(this.largestNation().id, 'treaty'); return; }
    if (this.mode.endYear && this.year >= this.mode.endYear) end(top.id, 'year');
  }

  step() {
    if (!this.started) return;
    this.tick++;
    for (let k = 0; k < this.attacks.length; k++) {
      const a = this.attacks[k];
      if (!a.dead) this.stepAttack(a);
    }
    if (this.attacks.some((a) => a.dead)) this.attacks = this.attacks.filter((a) => !a.dead);
    this.stepShips();
    if (this.ships.some((s) => s.dead)) this.ships = this.ships.filter((s) => !s.dead);
    this.stepMissiles();
    if (this.missiles.some((m) => m.dead)) this.missiles = this.missiles.filter((m) => !m.dead);
    this.stepReloads();
    this.stepSites();
    this.economy();
    if (this.tick % TPS === 0) this.perSecond();
    if (this.tick % (TPS * 2) === 5) this.computeLabels();
    if (this.tick % (TPS * 3) === 15) this.annexEnclaves();
    if (this.tick % TPS === 7) this.surrenderRemnants();
    for (let k = 2; k < this.players.length; k++) {
      const p = this.players[k];
      if (p.alive && p.ai) p.ai.update();
    }
  }
}
