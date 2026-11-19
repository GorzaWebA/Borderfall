'use strict';
// Computer-controlled nations.

const PERSONALITIES = [
  { key: 'warlord', label: 'Warlord', aggression: 1.35, expandAt: 0.32, expandRatio: 0.45, attackAt: 0.5, attackRatio: 0.45, build: 0.8, fortBias: 0.6, siloBias: 1.4, loyalty: 0.6, focus: 0.35, science: 0.12, techs: { mil: 3, eco: 1, sci: 1, gov: 1 }, ideologies: ['militarism', 'militarism', 'frontier'] },
  { key: 'merchant', label: 'Merchant', aggression: 0.75, expandAt: 0.38, expandRatio: 0.4, attackAt: 0.72, attackRatio: 0.35, build: 1.4, fortBias: 1.0, siloBias: 0.7, loyalty: 1.2, focus: 0.7, science: 0.3, techs: { mil: 1, eco: 3, sci: 2, gov: 1.5 }, ideologies: ['commerce', 'commerce', 'reason'] },
  { key: 'guardian', label: 'Guardian', aggression: 0.85, expandAt: 0.42, expandRatio: 0.38, attackAt: 0.75, attackRatio: 0.32, build: 1.1, fortBias: 1.8, siloBias: 0.8, loyalty: 1.4, focus: 0.5, science: 0.2, techs: { mil: 2, eco: 1, sci: 1, gov: 2.5 }, ideologies: ['crown', 'crown', 'moderation'] },
  { key: 'opportunist', label: 'Opportunist', aggression: 1.1, expandAt: 0.34, expandRatio: 0.5, attackAt: 0.6, attackRatio: 0.4, build: 1.0, fortBias: 0.8, siloBias: 1.0, loyalty: 0.8, focus: 0.5, science: 0.2, techs: { mil: 1.5, eco: 1.5, sci: 1.5, gov: 1.5 }, ideologies: ['moderation', 'frontier', 'reason'] },
];

const DIFFICULTY = {
  easy: { label: 'Easy', econ: 0.85, think: 24, aggression: 0.75, humanBias: 0.6, missiles: false, graceVsHuman: 150 },
  normal: { label: 'Normal', econ: 1.0, think: 16, aggression: 1.0, humanBias: 1.0, missiles: true, graceVsHuman: 75 },
  hard: { label: 'Hard', econ: 1.2, think: 10, aggression: 1.25, humanBias: 1.3, missiles: true, graceVsHuman: 40 },
};

class AIController {
  constructor(game, p, pers, diff) {
    this.g = game;
    this.p = p;
    this.pers = pers;
    this.diff = diff;
    const r = game.rng;
    this.next = 5 + r.int(diff.think);
    this.nextNaval = (35 + r.int(40)) * TPS;
    this.nextDiplo = (30 + r.int(60)) * TPS;
    this.nextMissile = 0;
    this.saving = null;
    this.savingSince = 0;
    this.enemy = 0;
    p.focus = pers.focus;
    p.science = pers.science;
    this.ideologyAt = 40 + r.int(90);   // seconds into the game before choosing an ideology
    this.reactLand = (3 + r.int(4)) * TPS;
    this.reactSea = (8 + r.int(6)) * TPS;
  }

  update() {
    if (--this.next > 0) return;
    this.next = this.diff.think + this.g.rng.int(8);
    this.think();
  }

  think() {
    const g = this.g, p = this.p, P = this.pers, D = this.diff, rng = g.rng;
    if (!p.alive || !p.spawned || !g.started) return;
    const cap = g.troopCap(p);
    const ratio = p.troops / cap;
    const nb = g.neighbors[p.id];
    const neutral = nb.get(0) || 0;
    let landWars = 0, expanding = false, underAttack = false;
    for (const a of g.attacks) {
      if (a.dead) continue;
      if (a.attacker === p.id) { if (a.target === 0) expanding = true; else landWars++; }
      if (a.target === p.id) underAttack = true;
    }
    p.focus = underAttack || landWars ? Math.min(P.focus, 0.35) : P.focus;
    const unstable = g.politics && p.stability < 38;
    const overextended = g.politics && p.tiles > p.adminCap * 1.1;
    if (g.politics) this.managePolitics();
    this.manageIdeology();

    // Answer incoming attacks when we can, once word has reached the capital and the army has
    // mustered: a few seconds for a border attack, longer for troops landed from the sea.
    for (const a of g.attacks) {
      if (a.dead || a.target !== p.id) continue;
      if (g.tick - (a.startedAt || 0) < (a.seeded ? this.reactSea : this.reactLand)) continue;
      if (p.troops > a.troops * 1.3 && ratio > 0.2 &&
          !g.attacks.some((x) => !x.dead && x.attacker === p.id && x.target === a.attacker)) {
        if (g.launchAttack(p.id, a.attacker, Math.min(p.troops * 0.45, a.troops * 1.6))) return;
      }
    }

    if (neutral > 0 && !expanding && ratio > P.expandAt * (overextended ? 2 : 1)) {
      g.launchAttack(p.id, 0, p.troops * P.expandRatio * (0.85 + rng() * 0.3));
    }

    const boxed = neutral === 0;
    const attackAt = (boxed ? P.attackAt - 0.12 : P.attackAt + 0.12) / D.aggression;
    if (g.time > 30 && ratio > attackAt && landWars < 2 && !unstable) {
      const t = this.pickTarget(nb, boxed);
      if (t) g.launchAttack(p.id, t, p.troops * P.attackRatio * (0.8 + rng() * 0.4));
    }

    if (g.tick >= this.nextNaval) this.naval(ratio, neutral);
    this.manageBuildings();
    this.useMissiles();
    if (g.tick >= this.nextDiplo) this.diplomacy();
  }

  pickTarget(nb, boxed) {
    const g = this.g, p = this.p, D = this.diff, P = this.pers;
    let best = 0, bestScore = 0;
    for (const [o, border] of nb) {
      if (o === 0) continue;
      const q = g.players[o];
      if (!q.alive || g.isFriendly(p.id, o)) continue;
      if (q.human && g.time < D.graceVsHuman) continue;
      const rel = g.getRel(p.id, o);
      if (!boxed && rel > 20 && P.key !== 'warlord') continue;
      if (rel > 10 && P.key !== 'warlord') continue;
      const strength = p.troops / (q.troops + 50);
      if (strength < 0.7 / (P.aggression * D.aggression) && rel > -40) continue;
      let score = strength * (1 + Math.min(border, 300) / 150) * (1 - rel / 120);
      if (q.human) score *= D.humanBias;
      if (g.landShare(q) > 0.25) score *= 1.4;
      if (g.attacks.some((a) => !a.dead && a.attacker === o && a.target === p.id)) score *= 1.5;
      if (o === this.enemy) score *= 1.8;
      score *= 0.8 + g.rng() * 0.4;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    if (bestScore > (boxed ? 0.5 : 1.0)) { this.enemy = best; return best; }
    return 0;
  }

  naval(ratio, neutral) {
    const g = this.g, p = this.p, D = this.diff, rng = g.rng;
    this.nextNaval = g.tick + (20 + rng.int(30)) * TPS;
    if (p.coastal === 0 || ratio < 0.45) return;
    if (g.fleetsOf(p.id) >= g.fleetCap(p)) return;
    if (neutral > 0 && rng() > 0.2) return;
    const cx = p.label.x, cy = p.label.y;
    const cands = [];
    for (let k = 0; k < 80; k++) {
      const i = rng.int(g.N);
      if (g.isWater(i)) continue;
      const o = g.owner[i];
      if (o === p.id || g.isFriendly(p.id, o)) continue;
      if (o === 0 && g.fallout[i]) continue;
      if (o) {
        const q = g.players[o];
        if (q.troops > p.troops * 0.8) continue;
        if (q.human && g.time < D.graceVsHuman) continue;
      }
      const x = i % g.W, y = (i - x) / g.W;
      let d = Math.hypot(x - cx, y - cy);
      if (o) d *= 1.6;
      cands.push([d, i]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < Math.min(2, cands.length); k++) {
      if (g.launchNaval(p.id, cands[k][1], p.troops * 0.3) === '') return;
    }
  }

  // Choose an ideology that suits the personality, then buy doctrines with spare money.
  manageIdeology() {
    const g = this.g, p = this.p;
    if (!p.ideology) {
      if (g.time < this.ideologyAt) return;
      const opts = this.pers.ideologies || ['moderation'];
      g.setIdeology(p.id, opts[g.rng.int(opts.length)]);
      return;
    }
    if (g.rng() > 0.25) return;
    const av = IDEOLOGY_BY_ID[p.ideology].tree.filter((d) => g.doctrineState(p, d) === 'avail');
    if (!av.length) return;
    const d = av[g.rng.int(av.length)];
    const reserve = this.saving ? g.buildCost(p, this.saving) * 0.5 : 0;
    if (p.gold > g.doctrineCost(d) * 1.4 + reserve) g.adoptDoctrine(p.id, d.key);
  }

  pickResearch() {
    const g = this.g, p = this.p, W = this.pers.techs;
    const av = g.availableTechs(p);
    if (!av.length) return null;
    let best = null, bestS = -1;
    for (const t of av) {
      let w = W[t.kind] || 1;
      if (g.politics && t.kind === 'gov' && p.stability < 50) w *= 2;
      if (t.unlock && t.unlock.includes('courthouse') && g.politics && p.tiles > p.adminCap * 0.8) w *= 3;
      const s = w / (g.techCost(p, t) - (p.progress[t.id] || 0) + 200) * (0.7 + g.rng() * 0.6);
      if (s > bestS) { bestS = s; best = t.id; }
    }
    return best;
  }

  managePolitics() {
    const g = this.g, p = this.p;
    if (!p.martial && p.stability < 36) g.setMartial(p.id, true);
    else if (p.martial && p.stability > 62) g.setMartial(p.id, false);
    if (p.stability < 34 && p.gold > g.celebrateCost(p) * 1.5) g.celebrate(p.id);
    // Calm down taxes and levies when things get shaky.
    if (p.stability < 45) p.focus = 0.5;
  }

  threatLevel() {
    const g = this.g, p = this.p;
    let t = 0;
    for (const [o] of g.neighbors[p.id]) {
      if (!o || g.isAllied(p.id, o)) continue;
      const q = g.players[o];
      if (q.alive) t = Math.max(t, q.troops / Math.max(1, p.troops));
    }
    return t;
  }

  enemySilos() {
    const g = this.g, p = this.p;
    for (const q of g.players) {
      if (q && q.alive && q.id !== p.id && !g.isAllied(p.id, q.id) && q.counts.silo > 0) return true;
    }
    return false;
  }

  chooseBuilding() {
    const g = this.g, p = this.p, c = p.counts, P = this.pers, D = this.diff;
    const opts = [];
    const ok = (t) => g.buildingUnlocked(p, t);
    const overextended = g.politics && p.tiles > p.adminCap * 0.9;
    opts.push(['city', c.city < 1 + p.tiles / 200 ? 3 * P.build : overextended ? 2.5 : 0.4]);
    if (ok('courthouse') && overextended) opts.push(['courthouse', 3.5]);
    if (ok('barracks') && c.barracks < c.city * 0.7) opts.push(['barracks', 1.4]);
    if (ok('university') && c.university < 1 + c.city * 0.4) opts.push(['university', 1.3 * (P.techs.sci / 1.5)]);
    if (ok('factory') && c.factory < 1 + c.city * 0.5) opts.push(['factory', 1.6]);
    if (this.threatLevel() > 0.8 && c.fort < 1 + c.city * 0.5 * P.fortBias) opts.push(['fort', 2.2 * P.fortBias]);
    if (p.coastal > 0 && c.harbor < 1 + p.tiles / 450) opts.push(['harbor', 1.5]);
    if (ok('silo') && D.missiles && p.tiles > 600 && c.city >= 3 && c.silo < (p.tiles > 2500 ? 2 : 1)) opts.push(['silo', P.siloBias]);
    if (ok('aa') && this.enemySilos() && c.aa < Math.ceil(c.city / 3)) opts.push(['aa', 2.0]);
    let total = 0;
    for (const o of opts) total += o[1];
    let r = g.rng() * total;
    for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
    return opts.length ? opts[0][0] : null;
  }

  manageBuildings() {
    const g = this.g, p = this.p;
    if (!this.saving || g.tick - this.savingSince > 60 * TPS) {
      this.saving = this.chooseBuilding();
      this.savingSince = g.tick;
    }
    if (!this.saving) return;
    if (p.gold < g.buildCost(p, this.saving)) return;
    const type = this.saving;
    let t = g.rng() < 0.35 ? this.stackSpot(type) : -1;
    if (t < 0) t = this.findSpot(type);
    if (t < 0) t = this.stackSpot(type);
    if (t >= 0) g.build(p.id, type, t);
    this.saving = null;
  }

  // An existing building of this type that can still be stacked, lowest level first.
  stackSpot(type) {
    let best = null;
    for (const b of this.p.blds) {
      if (b.type !== type || b.level >= MAX_LEVEL) continue;
      if (!best || b.level < best.level) best = b;
    }
    return best ? best.tile : -1;
  }

  findSpot(type) {
    const g = this.g, p = this.p, W = g.W, bb = p.bbox, rng = g.rng;
    const bw = bb[2] - bb[0] + 1, bh = bb[3] - bb[1] + 1;
    if (bw <= 0 || bh <= 0) return -1;
    const tries = type === 'harbor' ? 500 : 120;
    let best = -1, bestS = -1e9;
    for (let k = 0; k < tries; k++) {
      const x = bb[0] + rng.int(bw), y = bb[1] + rng.int(bh), t = y * W + x;
      if (g.owner[t] !== p.id) continue;
      if (type === 'harbor' && !g.map.coast[t]) continue;
      if (g.canBuild(p, type, t, true)) continue;
      const d = g.distField[t];
      let s;
      if (type === 'fort') s = -Math.abs(d - 5) + this.threatNear(x, y) * 0.5;
      else if (type === 'harbor') s = rng();
      else if (type === 'aa') s = -this.nearestCity(x, y) + d * 0.2;
      else if (type === 'courthouse' || (type === 'city' && g.politics)) s = -g.control[t] + d * 0.5 + rng() * 4;
      else s = d + rng() * 3;
      if (s > bestS) { bestS = s; best = t; }
    }
    return best;
  }

  threatNear(x0, y0) {
    const g = this.g, p = this.p, W = g.W, H = g.H;
    let n = 0;
    for (let dy = -10; dy <= 10; dy += 2) {
      for (let dx = -10; dx <= 10; dx += 2) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = g.owner[y * W + x];
        if (o && o !== p.id && !g.isFriendly(p.id, o)) n++;
      }
    }
    return n;
  }

  nearestCity(x, y) {
    let best = 40;
    for (const b of this.p.blds) {
      if (b.type !== 'city') continue;
      best = Math.min(best, Math.hypot(b.x - x, b.y - y));
    }
    return best;
  }

  ownTilesNear(tile) {
    const g = this.g, W = g.W, H = g.H, x0 = tile % W, y0 = (tile - x0) / W, R = MISSILE_R_OUT + 1;
    let n = 0;
    for (let dy = -R; dy <= R; dy += 2) {
      for (let dx = -R; dx <= R; dx += 2) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const o = g.owner[y * W + x];
        if (o === this.p.id || g.isAllied(this.p.id, o)) n++;
      }
    }
    return n;
  }

  useMissiles() {
    const g = this.g, p = this.p, D = this.diff;
    if (!D.missiles || p.counts.silo === 0 || g.tick < this.nextMissile) return;
    if (p.gold < g.missileCost(p) + 300 * MONEY || !g.readySilo(p)) return;
    let target = null, bestS = 0;
    for (const q of g.players) {
      if (!q || !q.alive || q.id === p.id || g.isFriendly(p.id, q.id)) continue;
      if (q.human && g.time < D.graceVsHuman * 2) continue;
      let s = 0;
      const share = g.landShare(q);
      if (share > 0.18) s += share * 3;
      if (g.attacks.some((a) => !a.dead && a.attacker === q.id && a.target === p.id)) s += 1.0;
      if (g.neighbors[p.id].has(q.id)) s += 0.3;
      s -= g.getRel(p.id, q.id) / 100;
      if (q.human) s *= D.humanBias;
      if (s > bestS) { bestS = s; target = q; }
    }
    if (!target || bestS < 0.8) return;
    let tile = target.label.tile;
    const cities = target.blds.filter((b) => b.type === 'city');
    if (cities.length && g.rng() < 0.7) tile = g.rng.pick(cities).tile;
    if (tile < 0 || this.ownTilesNear(tile) > 4) return;
    if (g.launchMissile(p.id, tile) === '') this.nextMissile = g.tick + (25 + g.rng.int(25)) * TPS;
  }

  diplomacy() {
    const g = this.g, p = this.p, P = this.pers, rng = g.rng;
    this.nextDiplo = g.tick + (15 + rng.int(20)) * TPS;
    for (const a of p.allies) {
      const q = g.players[a];
      if (g.landShare(q) > 0.35 && P.loyalty < 1 && rng() < 0.4 * (1 - P.loyalty)) {
        g.breakAlliance(p.id, a);
        return;
      }
    }
    if (p.allies.size >= 3) return;
    const leader = this.findLeader();
    const cands = [];
    for (const [o] of g.neighbors[p.id]) {
      if (!o || g.isAllied(p.id, o)) continue;
      const q = g.players[o];
      if (!q.alive || q.tribe || o === this.enemy || (leader && leader.id === o)) continue;
      let r = g.getRel(p.id, o);
      // Band together against a runaway leader.
      if (leader && leader.id !== p.id && g.neighbors[o].has(leader.id)) r += 20;
      if (r > 4) cands.push(o);
    }
    if (cands.length && rng() < 0.6) g.requestAlliance(p.id, rng.pick(cands));
  }

  findLeader() {
    const g = this.g;
    let best = null, share = 0.2;
    for (const q of g.players) {
      if (!q || !q.alive) continue;
      const s = g.landShare(q);
      if (s > share) { share = s; best = q; }
    }
    return best;
  }

  considerAlliance(from) {
    const g = this.g, p = this.p, P = this.pers;
    const q = g.players[from];
    if (g.attacks.some((a) => !a.dead && ((a.attacker === from && a.target === p.id) || (a.attacker === p.id && a.target === from)))) return false;
    let need = 4 / P.loyalty;
    if (g.landShare(q) > 0.3) need += 35;
    const leader = this.findLeader();
    if (leader && leader.id !== from && leader.id !== p.id) need -= 18;
    if (q.troops > p.troops * 3) need -= 12;
    if (p.allies.size >= 3) need += 25;
    if (q.traitorUntil > g.tick) need += 30;
    return g.getRel(p.id, from) >= need;
  }
}

// Tribes: small local clans. They settle nearby wilds, defend themselves and raid weaker
// tribes now and then, but never build, research, or join alliances.
class TribeAI {
  constructor(game, p) {
    this.g = game;
    this.p = p;
    this.next = 10 + game.rng.int(30);
    p.focus = 0.5;
  }
  update() {
    if (--this.next > 0) return;
    this.next = 25 + this.g.rng.int(15);
    this.think();
  }
  pickResearch() { return null; }
  considerAlliance() { return false; }
  think() {
    const g = this.g, p = this.p, rng = g.rng;
    if (!p.alive || !p.spawned || !g.started) return;
    const ratio = p.troops / g.troopCap(p);
    const nb = g.neighbors[p.id];
    for (const a of g.attacks) {
      if (a.dead || a.target !== p.id || g.tick - (a.startedAt || 0) < 6 * TPS) continue;
      if (p.troops > a.troops * 1.2 && ratio > 0.3) { g.launchAttack(p.id, a.attacker, Math.min(p.troops * 0.4, a.troops * 1.4)); return; }
    }
    if ((nb.get(0) || 0) > 0 && p.tiles < 160 && ratio > 0.6 && !g.attacks.some((a) => !a.dead && a.attacker === p.id)) {
      g.launchAttack(p.id, 0, p.troops * 0.2);
      return;
    }
    if (g.time > 60 && ratio > 0.8 && rng() < 0.15) {
      for (const [o] of nb) {
        const q = g.players[o];
        if (o && q && q.alive && q.tribe && !g.isFriendly(p.id, o) && q.troops < p.troops * 0.6) { g.launchAttack(p.id, o, p.troops * 0.3); return; }
      }
    }
  }
}
