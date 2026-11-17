'use strict';
// Core simulation: territory, combat, economy, buildings, fleets, missiles, diplomacy.

const TPS = 10;                 // simulation ticks per second
const ATTACK_SPEED = 0.22;      // share of a front that tries to advance each tick
const NEUTRAL_COST = 5;         // troops per plains tile of unclaimed land
const START_TROOPS = 1500;
const START_GOLD = 300;
const SPAWN_RADIUS = 4;
const WIN_SHARE = 0.7;
const SHIP_SPEED = 1.5;         // tiles per tick
const MISSILE_BASE_COST = 4000;
const MISSILE_R_IN = 6;
const MISSILE_R_OUT = 12;
const FALLOUT_SECONDS = 35;
const BUILD_SPACING = 3;        // Chebyshev distance kept clear around buildings

const BUILDINGS = {
  city: { name: 'City', base: 1000, step: 650, key: '1', desc: '+10K troop cap and +12 gold/s.' },
  barracks: { name: 'Barracks', base: 900, step: 500, key: '2', desc: 'Troops grow 20% faster. +4K troop cap.' },
  fort: { name: 'Fortress', base: 700, step: 350, key: '3', radius: 9, desc: 'Land within 9 tiles costs attackers double and falls half as fast.' },
  harbor: { name: 'Harbor', base: 900, step: 450, key: '4', coastal: true, desc: 'Coast only. Earns trade gold from every harbor in the world. +2 fleets.' },
  aa: { name: 'Air Defense', base: 2500, step: 1250, key: '5', radius: 22, desc: 'Shoots down one enemy missile aimed within 22 tiles every 12s.' },
  silo: { name: 'Missile Silo', base: 5000, step: 2500, key: '6', desc: 'Launches missiles that wipe out troops and scorch land. 20s reload.' },
};
const BUILD_ORDER = ['city', 'barracks', 'fort', 'harbor', 'aa', 'silo'];
const SILO_RELOAD = 20 * TPS;
const AA_RELOAD = 12 * TPS;

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
    this.value = 0;
    this.focus = 0.5;               // 0 = all army, 1 = all economy
    this.counts = { city: 0, barracks: 0, fort: 0, harbor: 0, aa: 0, silo: 0 };
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
  }
}

class Game {
  constructor(map, settings) {
    this.map = map;
    this.W = map.W; this.H = map.H; this.N = map.N;
    this.settings = settings;
    this.rng = makeRng((map.seed ^ 0x5bd1e995) >>> 0);
    this.owner = new Uint16Array(this.N);
    this.bldAt = new Int32Array(this.N).fill(-1);
    this.fallout = new Uint8Array(this.N);
    this.falloutList = [];
    this.players = [null];
    this.buildings = [];
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
    this.started = false;
    this.idSeq = 1;
    this.totalHarbors = 0;
    this.bfsStamp = new Uint32Array(this.N);
    this.stamp = 0;
    this.bfsParent = new Int32Array(this.N);
    this.bfsQueue = new Int32Array(this.N);
    this._deferred = [];
    this.rel = null;
    this.P = 0;
  }

  get time() { return this.tick / TPS; }
  get human() { return this.players[1]; }

  // ---------- setup ----------
  setupPlayers(opts) {
    const rng = this.rng;
    const human = new Player(1, opts.playerName || 'You', opts.playerColor, true);
    this.players.push(human);
    const names = rng.shuffle(NATION_NAMES.slice());
    const colors = [];
    const hueStart = rng() * 360;
    for (let i = 0; colors.length < opts.numAI && i < 400; i++) {
      const h = hueStart + i * 137.508;
      const s = 0.45 + (i % 3) * 0.15;
      const l = 0.42 + ((i >> 1) % 3) * 0.08;
      const c = hslToRgb(h, s, l);
      if (colorDistance(c, human.color) < 40) continue;
      colors.push(c);
    }
    const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    for (let k = 0; k < opts.numAI; k++) {
      const p = new Player(k + 2, names[k % names.length], colors[k % colors.length], false);
      p.diffMult = diff.econ;
      p.ai = new AIController(this, p, PERSONALITIES[rng.int(PERSONALITIES.length)], diff);
      this.players.push(p);
    }
    this.P = this.players.length;
    this.rel = new Float32Array(this.P * this.P);
    for (let i = 0; i < this.rel.length; i++) this.rel[i] = rng.range(-5, 25);
    this.neighbors = this.players.map(() => new Map());
    this.spawnAIs();
  }

  spawnAIs() {
    const rng = this.rng, W = this.W, H = this.H, T = this.map.terrain;
    const ais = this.players.filter((p) => p && !p.human);
    let minDist = Math.sqrt(this.map.landCount / (ais.length + 1)) * 0.75;
    const placed = [];
    for (const p of ais) {
      let done = false;
      for (let attempt = 0; attempt < 4000 && !done; attempt++) {
        if (attempt > 0 && attempt % 800 === 0) minDist *= 0.8;
        const i = rng.int(this.N);
        const t = T[i];
        if (t <= T_SEA || t === T_MOUNTAIN || this.owner[i]) continue;
        const x = i % W, y = (i - x) / W;
        let ok = true;
        for (const q of placed) {
          const dx = q[0] - x, dy = q[1] - y;
          if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
        }
        if (!ok) continue;
        this.claimSpawn(p, i);
        placed.push([x, y]);
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
    const r = SPAWN_RADIUS;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = y * W + x;
        if (this.map.terrain[t] > T_SEA && this.owner[t] === 0) this.setOwner(t, p.id);
      }
    }
    p.troops = START_TROOPS;
    p.gold = START_GOLD;
    p.spawned = true;
    p.label = { x: x0 + 0.5, y: y0 + 0.5, size: 3, tile: i };
  }

  spawnHuman(i) {
    if (!this.canSpawnAt(i)) return false;
    this.claimSpawn(this.human, i);
    this.started = true;
    this.scanNeighbors();
    this.computeLabels();
    this.log('Your nation is founded. Expand into the wilds to grow.', 'good');
    return true;
  }

  // ---------- helpers ----------
  isWater(i) { return this.map.terrain[i] <= T_SEA; }
  isAllied(a, b) { return a > 0 && b > 0 && a !== b && this.players[a].allies.has(b); }
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
  markDirtyAround(i) {
    const W = this.W, x = i % W;
    this.markDirty(i);
    if (x > 0) this.markDirty(i - 1);
    if (x < W - 1) this.markDirty(i + 1);
    if (i >= W) this.markDirty(i - W);
    if (i + W < this.N) this.markDirty(i + W);
  }
  log(text, kind = 'info') {
    this.events.push({ id: ++this.eventSeq, text, kind, time: this.time });
    if (this.events.length > 80) this.events.shift();
  }
  troopCap(p) {
    return 3000 + p.value * 30 + p.counts.city * 10000 + p.counts.barracks * 4000;
  }
  landShare(p) { return p.tiles / this.map.landCount; }
  fleetCap(p) { return 3 + p.counts.harbor * 2; }
  fleetsOf(pid) { let n = 0; for (const s of this.ships) if (!s.dead && s.owner === pid) n++; return n; }
  missileCost(p) { return Math.min(MISSILE_BASE_COST + p.missilesLaunched * 400, 9000); }
  readySilo(p) {
    for (const b of p.blds) if (b.type === 'silo' && b.cooldown <= 0) return b;
    return null;
  }
  buildCost(p, type) {
    const b = BUILDINGS[type];
    return b.base + b.step * p.counts[type];
  }

  // ---------- ownership ----------
  setOwner(t, newOwner) {
    const old = this.owner[t];
    if (old === newOwner) return;
    const v = T_VALUE[this.map.terrain[t]];
    const po = old ? this.players[old] : null;
    const pn = newOwner ? this.players[newOwner] : null;
    this.owner[t] = newOwner;
    if (po) { po.tiles--; po.value -= v; }
    if (pn) {
      pn.tiles++; pn.value += v;
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
        po.counts[b.type]--;
        const k = po.blds.indexOf(b);
        if (k >= 0) po.blds.splice(k, 1);
      }
      if (pn) {
        b.owner = newOwner;
        pn.counts[b.type]++;
        pn.blds.push(b);
        b.cooldown = Math.max(b.cooldown, 5 * TPS);
      } else {
        b.alive = false;
        this.bldAt[t] = -1;
      }
    }
    this.markDirtyAround(t);
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
    for (const q of this.players) if (q) q.allies.delete(p.id);
    p.allies.clear();
    if (by) { by.gold += p.gold; by.kills++; }
    p.gold = 0;
    p.troops = 0;
    if (p.human) this.log(`Your nation has fallen${by ? ' to ' + by.name : ''}.`, 'bad');
    else if (by && by.human) this.log(`You conquered ${p.name}! Their treasury is yours.`, 'good');
    else this.log(`${p.name} was destroyed${by ? ' by ' + by.name : ''}.`, 'info');
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
    if (tId && (!this.players[tId].alive || this.isAllied(aId, tId))) return false;
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
        return true;
      }
    }
    const atk = {
      id: this.idSeq++, attacker: aId, target: tId, troops: amount, frontier: [], inF: new Set(),
      seeded: opts.seed !== undefined, dead: false, taken: 0, refreshAt: 0, startedAt: this.tick,
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
      for (const o of this.attacks) {
        if (o.dead || o.attacker !== tId || o.target !== aId) continue;
        const m = Math.min(o.troops, atk.troops);
        o.troops -= m; atk.troops -= m;
        if (o.troops < 1) { o.dead = true; }
        if (atk.troops < 1) break;
      }
      this.addRel(tId, aId, -8);
      const D = this.players[tId];
      if (D.human && atk.troops >= 1) this.log(`${A.name} is attacking you with ${fmt(atk.troops)} troops!`, 'bad');
      if (atk.troops < 1) return true;
    }
    this.attacks.push(atk);
    return true;
  }

  fortMult(t, D) {
    if (D.counts.fort === 0) return 1;
    const W = this.W, x = t % W, y = (t - x) / W;
    const R2 = BUILDINGS.fort.radius * BUILDINGS.fort.radius;
    for (const b of D.blds) {
      if (b.type !== 'fort') continue;
      const dx = b.x - x, dy = b.y - y;
      if (dx * dx + dy * dy <= R2) return 2;
    }
    return 1;
  }

  stepAttack(atk) {
    const A = this.players[atk.attacker];
    if (!A.alive) { atk.dead = true; return; }
    const aId = atk.attacker, tId = atk.target;
    const D = tId ? this.players[tId] : null;
    if (D && (!D.alive || this.isAllied(aId, tId))) { A.troops += atk.troops; atk.dead = true; return; }
    const F = atk.frontier;
    if (F.length === 0 && !atk.seeded && atk.refreshAt <= this.tick) {
      this.buildFrontier(atk);
      atk.refreshAt = this.tick + 10;
    }
    if (F.length === 0) { A.troops += atk.troops; atk.dead = true; return; }

    const own = this.owner, ter = this.map.terrain, W = this.W, H = this.H, rng = this.rng;
    let tries = Math.ceil(F.length * ATTACK_SPEED) + 1;
    const density = D ? D.troops / Math.max(1, D.tiles) : 0;
    const traitor = D && D.traitorUntil > this.tick ? 0.8 : 1;
    const deferred = this._deferred;
    deferred.length = 0;
    let exhausted = false;
    while (tries-- > 0 && F.length > 0) {
      const k = (rng() * F.length) | 0;
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
      const tt = ter[t];
      let speed = T_SPEED[tt] * (adj >= 2 ? 1 : 0.45);
      let fortM = 1;
      if (D) {
        fortM = this.fortMult(t, D);
        if (fortM > 1) speed *= 0.5;
      }
      if (rng() > speed) { deferred.push(t); continue; }
      const cost = D ? (density * 1.1 + 5) * T_DEF[tt] * fortM * traitor : NEUTRAL_COST * T_COST[tt];
      if (atk.troops < cost) { deferred.push(t); exhausted = true; break; }
      atk.troops -= cost;
      if (D) D.troops = Math.max(0, D.troops - density);
      atk.inF.delete(t);
      atk.taken++;
      this.setOwner(t, aId);
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
    this.players[pid].troops += atk.troops * 0.8;
    atk.troops = 0;
    atk.dead = true;
    return true;
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
    const ship = {
      id: this.idSeq++, owner: aId, troops: amount, path: route.path, pos: 0, landing, target: tOwner, dead: false,
    };
    this.ships.push(ship);
    if (tOwner) {
      const D = this.players[tOwner];
      this.addRel(tOwner, aId, -10);
      if (D.human) this.log(`${A.name} sent a fleet with ${fmt(amount)} troops toward your coast!`, 'bad');
    }
    return '';
  }

  stepShips() {
    for (const s of this.ships) {
      if (s.dead) continue;
      s.pos += SHIP_SPEED;
      if (s.pos >= s.path.length - 1) { s.dead = true; this.landShip(s); }
    }
  }

  landShip(s) {
    const A = this.players[s.owner];
    if (!A.alive) return;
    const L = s.landing;
    const o = this.owner[L];
    if (o === s.owner || this.isAllied(s.owner, o) || (o === 0 && this.fallout[L])) { A.troops += s.troops; return; }
    const D = o ? this.players[o] : null;
    const density = D ? D.troops / Math.max(1, D.tiles) : 0;
    const tt = this.map.terrain[L];
    const cost = D ? (density * 1.1 + 5) * T_DEF[tt] * this.fortMult(L, D) : NEUTRAL_COST * T_COST[tt];
    if (s.troops < cost) {
      if (A.human) this.log(`Your fleet was repelled at the shore of ${D ? D.name : 'the wilds'}.`, 'bad');
      if (D) D.troops = Math.max(0, D.troops - s.troops * 0.5);
      return;
    }
    let troops = s.troops - cost;
    if (D) D.troops = Math.max(0, D.troops - density);
    this.setOwner(L, s.owner);
    if (D && D.human) this.log(`${A.name} landed on your shore!`, 'bad');
    if (troops >= 1) {
      const ok = this.launchAttack(s.owner, o, troops, { seed: L, fromPool: false });
      if (!ok) A.troops += troops;
    }
  }

  // ---------- buildings ----------
  // Returns '' when the building can go here, otherwise the reason it can't.
  canBuild(p, type, t, ignoreGold) {
    const def = BUILDINGS[type];
    if (!def) return 'Unknown building.';
    if (t < 0 || t >= this.N || this.owner[t] !== p.id) return 'Build on your own land.';
    if (def.coastal && !this.map.coast[t]) return 'Harbors must touch the sea.';
    const W = this.W, H = this.H, x0 = t % W, y0 = (t - x0) / W, r = BUILD_SPACING;
    for (let y = Math.max(0, y0 - r); y <= Math.min(H - 1, y0 + r); y++) {
      for (let x = Math.max(0, x0 - r); x <= Math.min(W - 1, x0 + r); x++) {
        if (this.bldAt[y * W + x] >= 0) return 'Too close to another building.';
      }
    }
    if (!ignoreGold && p.gold < this.buildCost(p, type)) return `Needs ${fmt(this.buildCost(p, type))} gold.`;
    return '';
  }

  build(pid, type, t) {
    const p = this.players[pid];
    const err = this.canBuild(p, type, t);
    if (err) return err;
    p.gold -= this.buildCost(p, type);
    const x = t % this.W, y = (t - x) / this.W;
    const b = { id: this.buildings.length, type, tile: t, x, y, owner: pid, cooldown: 0, alive: true, builtAt: this.tick };
    this.buildings.push(b);
    this.bldAt[t] = b.id;
    p.counts[type]++;
    p.blds.push(b);
    return '';
  }

  // ---------- missiles ----------
  launchMissile(aId, t) {
    const A = this.players[aId];
    if (!A.alive) return 'You have no nation.';
    if (A.counts.silo === 0) return 'Build a missile silo first.';
    const silo = this.readySilo(A);
    if (!silo) return 'Every silo is reloading.';
    const cost = this.missileCost(A);
    if (A.gold < cost) return `A missile costs ${fmt(cost)} gold.`;
    if (t < 0 || t >= this.N) return 'Out of range.';
    A.gold -= cost;
    A.missilesLaunched++;
    silo.cooldown = SILO_RELOAD;
    const W = this.W, tx = t % W, ty = (t - tx) / W;
    const dist = Math.hypot(tx - silo.x, ty - silo.y);
    const dur = Math.round(25 + dist / 3.5);
    const m = { id: this.idSeq++, owner: aId, sx: silo.x, sy: silo.y, tx, ty, tile: t, t: 0, dur, interceptAt: -1, dead: false };

    // Victims: anyone owning land in the blast zone.
    const victims = new Set();
    const R = MISSILE_R_OUT;
    for (let dy = -R; dy <= R; dy += 2) {
      for (let dx = -R; dx <= R; dx += 2) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = tx + dx, y = ty + dy;
        if (x < 0 || y < 0 || x >= W || y >= this.H) continue;
        const o = this.owner[y * W + x];
        if (o && o !== aId) victims.add(o);
      }
    }
    // Air defense of any non-allied victim nation or bystander covering the target.
    for (const b of this.buildings) {
      if (!b.alive || b.type !== 'aa' || b.cooldown > 0 || b.owner === aId || this.isAllied(b.owner, aId)) continue;
      const dx = b.x - tx, dy = b.y - ty, rr = BUILDINGS.aa.radius;
      if (dx * dx + dy * dy <= rr * rr) {
        b.cooldown = AA_RELOAD;
        m.interceptAt = Math.floor(dur * 0.82);
        m.interceptedBy = b.owner;
        break;
      }
    }
    for (const q of this.players) if (q && q.id !== aId) this.addRel(q.id, aId, -6);
    for (const v of victims) {
      this.addRel(v, aId, -40);
      if (this.players[v].human) this.log(`${A.name} launched a missile at you!`, 'bad');
    }
    this.missiles.push(m);
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
        const by = this.players[m.interceptedBy];
        if (by && by.human) this.log(`Your air defense shot down a missile from ${this.players[m.owner].name}.`, 'good');
        else if (this.players[m.owner].human) this.log(`Your missile was shot down by ${by ? by.name : 'air defense'}.`, 'bad');
        continue;
      }
      if (m.t >= m.dur) { m.dead = true; this.detonate(m); }
    }
  }

  detonate(m) {
    const W = this.W, H = this.H, R = MISSILE_R_OUT, Ri = MISSILE_R_IN;
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
      P.troops -= P.troops * Math.min(0.65, f * 2.2 + 0.08);
      if (P.human && o !== m.owner) this.log(`A missile from ${this.players[m.owner].name} struck your land.`, 'bad');
    }
    for (const i of inner) {
      if (this.owner[i]) this.setOwner(i, 0);
      if (!this.fallout[i]) this.falloutList.push(i);
      this.fallout[i] = FALLOUT_SECONDS;
      this.markDirty(i);
    }
    // Fleets caught in the blast sink.
    for (const s of this.ships) {
      if (s.dead) continue;
      const pi = s.path[Math.min(s.path.length - 1, Math.floor(s.pos))];
      const sx = pi % W, sy = (pi - sx) / W;
      if ((sx - m.tx) ** 2 + (sy - m.ty) ** 2 <= R * R) s.dead = true;
    }
    this.effects.push({ type: 'blast', x: m.tx + 0.5, y: m.ty + 0.5, r: R, at: this.time });
  }

  // ---------- diplomacy ----------
  requestAlliance(from, to) {
    const A = this.players[from], B = this.players[to];
    if (!A || !B || !A.alive || !B.alive || from === to) return 'Not possible.';
    if (this.isAllied(from, to)) return `Already allied with ${B.name}.`;
    const key = from * 1000 + to;
    const cd = this.reqCooldown.get(key) || 0;
    if (cd > this.tick) return `Wait ${Math.ceil((cd - this.tick) / TPS)}s before asking ${B.name} again.`;
    this.reqCooldown.set(key, this.tick + 30 * TPS);
    if (B.human) {
      if (this.requests.some((r) => r.from === from)) return '';
      this.requests.push({ id: this.idSeq++, from, expires: this.tick + 20 * TPS });
      return '';
    }
    const ok = B.ai.considerAlliance(from);
    if (ok) {
      this.formAlliance(from, to);
    } else if (A.human) {
      this.log(`${B.name} declined your alliance (relation ${Math.round(this.getRel(to, from))}).`, 'info');
    }
    return '';
  }

  respondRequest(reqId, accept) {
    const k = this.requests.findIndex((r) => r.id === reqId);
    if (k < 0) return;
    const r = this.requests[k];
    this.requests.splice(k, 1);
    const A = this.players[r.from];
    if (!A.alive) return;
    if (accept) this.formAlliance(r.from, 1);
    else { this.addRel(r.from, 1, -8); this.log(`You turned down ${A.name}.`, 'info'); }
  }

  formAlliance(a, b) {
    const A = this.players[a], B = this.players[b];
    A.allies.add(b); B.allies.add(a);
    this.addRel(a, b, 15); this.addRel(b, a, 15);
    for (const x of this.attacks) {
      if (x.dead) continue;
      if ((x.attacker === a && x.target === b) || (x.attacker === b && x.target === a)) {
        this.players[x.attacker].troops += x.troops; x.troops = 0; x.dead = true;
      }
    }
    if (A.human || B.human) this.log(`You are now allied with ${A.human ? B.name : A.name}.`, 'good');
    else if (this.concernsHuman(a, b)) this.log(`${A.name} and ${B.name} formed an alliance.`, 'info');
  }

  breakAlliance(a, b) {
    const A = this.players[a], B = this.players[b];
    if (!this.isAllied(a, b)) return;
    A.allies.delete(b); B.allies.delete(a);
    A.traitorUntil = this.tick + 45 * TPS;
    for (const q of this.players) if (q && q.id !== a) this.addRel(q.id, a, -18);
    this.addRel(b, a, -50);
    if (A.human) this.log(`You broke your alliance with ${B.name}. Others will trust you less, and your land is easier to take for 45s.`, 'bad');
    else if (B.human) this.log(`${A.name} betrayed your alliance!`, 'bad');
    else if (this.concernsHuman(a, b)) this.log(`${A.name} broke its alliance with ${B.name}.`, 'info');
  }

  // Worth telling the player about: a neighbor of theirs, or a bloc that dominates the map.
  concernsHuman(a, b) {
    const nb = this.neighbors[1];
    if (nb && (nb.has(a) || nb.has(b))) return true;
    return (this.players[a].tiles + this.players[b].tiles) > this.map.landCount * 0.3;
  }

  sendTroops(from, to, amount) {
    const A = this.players[from], B = this.players[to];
    if (!this.isAllied(from, to)) return 'You can only reinforce allies.';
    amount = Math.floor(Math.min(amount, A.troops));
    if (amount < 1) return 'No troops to send.';
    A.troops -= amount; B.troops += amount;
    this.addRel(to, from, Math.min(25, 5 + amount / Math.max(500, B.troops) * 20));
    if (A.human) this.log(`Sent ${fmt(amount)} troops to ${B.name}.`, 'good');
    else if (B.human) this.log(`${A.name} sent you ${fmt(amount)} troops.`, 'good');
    return '';
  }

  sendGold(from, to, amount) {
    const A = this.players[from], B = this.players[to];
    if (!B || !B.alive) return 'Not possible.';
    amount = Math.floor(Math.min(amount, A.gold));
    if (amount < 1) return 'No gold to send.';
    A.gold -= amount; B.gold += amount;
    const gain = clamp((amount / Math.max(400, B.gold * 0.5)) * 25, 1, 35);
    this.addRel(to, from, gain);
    if (A.human) this.log(`Sent ${fmt(amount)} gold to ${B.name}. Relation +${Math.round(gain)}.`, 'good');
    return '';
  }

  // ---------- periodic ----------
  economy() {
    const dt = 1 / TPS;
    for (let k = 1; k < this.players.length; k++) {
      const p = this.players[k];
      if (!p.alive || !p.spawned) continue;
      const cap = this.troopCap(p);
      const b = p.counts.barracks;
      const mult = (1.3 - 0.6 * p.focus) * (1 + 0.2 * Math.min(b, 5) + 0.06 * Math.max(0, b - 5)) * p.diffMult;
      let g = (12 + Math.pow(Math.max(p.troops, 0), 0.72) * 0.95) * (1 - p.troops / cap) * mult;
      if (p.troops > cap) g = (cap - p.troops) * 0.05;
      p.troops += g * dt;
      p.growth = g;
      const others = Math.min(12, this.totalHarbors - p.counts.harbor);
      const harborIncome = p.counts.harbor * (6 + 1.5 * Math.max(0, others));
      const inc = (5 + p.value * 0.06 + p.counts.city * 12 + harborIncome) * (0.4 + 1.2 * p.focus) * p.diffMult;
      p.gold += inc * dt;
      p.income = inc;
    }
  }

  perSecond() {
    const P = this.P;
    // Relations drift.
    const fighting = new Set();
    for (const a of this.attacks) {
      if (a.dead || !a.target) continue;
      fighting.add(a.attacker * P + a.target);
      fighting.add(a.target * P + a.attacker);
      this.addRel(a.target, a.attacker, -1.2);
    }
    for (let i = 1; i < P; i++) {
      const pi = this.players[i];
      if (!pi.alive) continue;
      const nb = this.neighbors[i];
      for (let j = 1; j < P; j++) {
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
        this.falloutList[k] = this.falloutList[this.falloutList.length - 1];
        this.falloutList.pop();
      }
    }
    this.totalHarbors = 0;
    for (const p of this.players) if (p && p.alive) this.totalHarbors += p.counts.harbor;
    this.scanNeighbors();
    // Expire requests.
    this.requests = this.requests.filter((r) => r.expires > this.tick && this.players[r.from].alive);
    // Prune old effects.
    this.effects = this.effects.filter((e) => this.time - e.at < 4);
    this.checkGameOver();
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
    const W = this.W, H = this.H, N = this.N, own = this.owner, d = this.distField;
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

  checkGameOver() {
    if (this.over || !this.started) return;
    const h = this.human;
    if (!h.alive) { this.over = { won: false, time: this.time }; return; }
    const share = this.landShare(h);
    if (share >= WIN_SHARE) { this.over = { won: true, time: this.time, reason: 'share' }; return; }
    let rivals = 0;
    for (const p of this.players) if (p && p.alive && !p.human && !h.allies.has(p.id)) rivals++;
    if (rivals === 0) this.over = { won: true, time: this.time, reason: 'rivals' };
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
    for (const b of this.buildings) if (b.alive && b.cooldown > 0) b.cooldown--;
    this.economy();
    if (this.tick % TPS === 0) this.perSecond();
    if (this.tick % (TPS * 2) === 5) this.computeLabels();
    for (let k = 2; k < this.players.length; k++) {
      const p = this.players[k];
      if (p.alive && p.ai) p.ai.update();
    }
  }
}
