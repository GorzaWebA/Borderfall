'use strict';
// Multiplayer: peer-to-peer lobbies, quick matches and host-run games.
//
// Players' browsers connect directly over WebRTC. Public Nostr relays only help them find
// each other (via the bundled Trystero library). The host simulates the whole game and
// streams compact updates; everyone else mirrors that state and sends orders back.

const NET_APP_ID = 'borderfall-2026';
const MM_ROOM = 'matchmaking-v1';
const NET_MAX_PLAYERS = 8;
const SPAWN_PHASE_SECONDS = 25;
const AUTO_START_SECONDS = 40;
const NET_SEND_MS = 200;
const NET_LOCAL = /[?&]net=local\b/.test(location.search);

// ---------- encoding helpers ----------
function u8ToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToU8(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
// Pairs of (index, value<256) packed as uint32 little-endian, base64.
function packPairs(arr) {
  const out = new Uint32Array(arr.length / 2);
  for (let i = 0, k = 0; i < arr.length; i += 2, k++) out[k] = arr[i] * 256 + (arr[i + 1] & 255);
  return u8ToB64(new Uint8Array(out.buffer));
}
function unpackPairs(b64, fn) {
  const u8 = b64ToU8(b64);
  const v = new Uint32Array(u8.buffer, 0, u8.length >> 2);
  for (let k = 0; k < v.length; k++) fn(Math.floor(v[k] / 256), v[k] & 255);
}
// Run-length encoding of a small-valued typed array: [value, count, value, count, ...].
function rleEncode(a) {
  const out = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}
function rleDecode(rle, target) {
  let p = 0;
  for (let k = 0; k < rle.length; k += 2) {
    target.fill(rle[k], p, p + rle[k + 1]);
    p += rle[k + 1];
  }
}
function genLobbyCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
  return c;
}

// ---------- transports ----------
// Internet rooms through Trystero (WebRTC, discovered via public Nostr relays).
let trysteroPromise = null;
class TrysteroRoom {
  constructor(id) { this.id = id; this.handlers = {}; this.joinFns = []; this.leaveFns = []; }
  async join() {
    if (!trysteroPromise) trysteroPromise = import(new URL('vendor/trystero.mjs', document.baseURI).href);
    const T = await trysteroPromise;
    this.selfId = T.selfId;
    this.room = T.joinRoom({ appId: NET_APP_ID }, this.id);
    this.act = this.room.makeAction('m');
    this.act.onMessage = (msg, ctx) => this.dispatch(msg, ctx.peerId);
    this.room.onPeerJoin = (id) => this.joinFns.forEach((f) => f(id));
    this.room.onPeerLeave = (id) => this.leaveFns.forEach((f) => f(id));
  }
  dispatch(msg, from) { const f = msg && this.handlers[msg.t]; if (f) f(msg.d, from); }
  send(t, d, to) { if (this.act) this.act.send({ t, d }, to ? { target: to } : undefined).catch(() => {}); }
  on(t, f) { this.handlers[t] = f; }
  onJoin(f) { this.joinFns.push(f); }
  onLeave(f) { this.leaveFns.push(f); }
  leave() { try { if (this.room) this.room.leave(); } catch (e) { /* already gone */ } }
}

// Same-browser rooms for testing in several tabs: add ?net=local to the address.
class LocalRoom {
  constructor(id) {
    this.id = id; this.handlers = {}; this.joinFns = []; this.leaveFns = []; this.peers = new Set();
    this.selfId = Math.random().toString(36).slice(2, 10);
  }
  async join() {
    this.ch = new BroadcastChannel('bf-' + this.id);
    this.ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.from === this.selfId || (m.to && !m.to.includes(this.selfId))) return;
      if (m.t === '__hi') {
        if (!this.peers.has(m.from)) { this.peers.add(m.from); this.joinFns.forEach((f) => f(m.from)); this.raw('__hi', null, [m.from]); }
        return;
      }
      if (m.t === '__bye') { if (this.peers.delete(m.from)) this.leaveFns.forEach((f) => f(m.from)); return; }
      const f = this.handlers[m.t];
      if (f) f(m.d, m.from);
    };
    this.raw('__hi', null, null);
  }
  raw(t, d, to) { this.ch.postMessage({ t, d, from: this.selfId, to }); }
  send(t, d, to) { this.raw(t, d, to ? [].concat(to) : null); }
  on(t, f) { this.handlers[t] = f; }
  onJoin(f) { this.joinFns.push(f); }
  onLeave(f) { this.leaveFns.push(f); }
  leave() { try { this.raw('__bye', null, null); this.ch.close(); } catch (e) { /* closed */ } }
}

function makeRoom(id) { return NET_LOCAL ? new LocalRoom(id) : new TrysteroRoom(id); }

// ---------- lobbies and matches ----------
class Net {
  constructor(ui) {
    this.ui = ui;
    this.role = null;          // 'host' | 'client'
    this.room = null;
    this.mm = null;
    this.lobby = null;
    this.ads = new Map();
    this.cmdSeq = 0;
    this.lastSend = 0;
  }

  me() { return { name: this.ui.playerName(), color: this.ui.color }; }

  // ----- hosting -----
  async host(isPublic, settings) {
    this.role = 'host';
    this.room = makeRoom('L-' + (this.code = genLobbyCode()));
    await this.room.join();
    this.lobby = { code: this.code, hostId: this.room.selfId, isPublic, settings, startAt: null, started: false,
      players: [{ id: this.room.selfId, ...this.me() }] };
    this.room.on('hello', (d, from) => this.onHello(d, from));
    this.room.on('c', (d, from) => this.onCommand(d, from));
    this.room.onJoin(() => this.broadcastLobby());
    this.room.onLeave((id) => this.onPeerGone(id));
    this.lobbyTimer = setInterval(() => this.hostLobbyTick(), 1000);
    if (isPublic) await this.advertise();
    this.ui.showLobby(this.lobby, true);
    this.broadcastLobby();
  }

  onHello(d, from) {
    const L = this.lobby;
    if (!L) return;
    if (L.started) { this.room.send('full', { reason: 'This match has already started.' }, from); return; }
    if (L.players.length >= NET_MAX_PLAYERS && !L.players.some((p) => p.id === from)) {
      this.room.send('full', { reason: 'This lobby is full.' }, from);
      return;
    }
    let p = L.players.find((x) => x.id === from);
    if (!p) { p = { id: from }; L.players.push(p); }
    p.name = String(d.name || 'Player').slice(0, 16);
    const used = new Set(L.players.filter((x) => x !== p).map((x) => x.color));
    p.color = used.has(d.color) ? (PLAYER_COLORS.find((c) => !used.has(c)) || d.color) : d.color;
    this.broadcastLobby();
  }

  setSettings(settings) {
    if (this.role !== 'host' || !this.lobby || this.lobby.started) return;
    this.lobby.settings = settings;
    this.broadcastLobby();
  }

  broadcastLobby() {
    if (!this.lobby) return;
    this.room.send('lobby', this.lobby);
    this.ui.showLobby(this.lobby, true);
  }

  hostLobbyTick() {
    const L = this.lobby;
    if (!L || L.started) return;
    if (L.isPublic) {
      if (L.players.length >= 2 && !L.startAt) L.startAt = Date.now() + AUTO_START_SECONDS * 1000;
      if (L.players.length < 2) L.startAt = null;
      if (L.startAt && (Date.now() >= L.startAt || L.players.length >= NET_MAX_PLAYERS)) { this.ui.startGame(); return; }
      this.sendAd();
    }
    this.broadcastLobby();
  }

  async advertise() {
    this.mm = makeRoom(MM_ROOM);
    await this.mm.join();
    this.mm.onJoin(() => this.sendAd());
    this.sendAd();
  }

  sendAd() {
    const L = this.lobby;
    if (!this.mm || !L) return;
    this.mm.send('ad', { code: L.code, mode: L.settings.mode, map: mapLabel(L.settings.type), players: L.players.length,
      max: NET_MAX_PLAYERS, started: L.started, ts: Date.now() });
  }

  // ----- joining -----
  async join(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{5}$/.test(code)) throw new Error('Lobby codes are 5 letters.');
    this.role = 'client';
    this.code = code;
    this.room = makeRoom('L-' + code);
    await this.room.join();
    const gotLobby = new Promise((resolve, reject) => {
      this.room.on('lobby', (d, from) => {
        if (d.hostId !== from) return;
        this.lobby = d;
        this.hostId = from;
        this.ui.showLobby(d, false);
        resolve();
      });
      this.room.on('full', (d) => reject(new Error(d.reason)));
      setTimeout(() => reject(new Error('No lobby answered with that code. Check the code, or ask the host to keep the game open.')), 15000);
    });
    this.room.on('start', (d) => this.onStart(d));
    this.room.on('u', (d) => this.onUpdate(d));
    this.room.on('r', (d) => { if (d.msg) this.ui.notice(d.msg, d.bad); });
    this.room.onLeave((id) => { if (id === this.hostId) this.ui.netClosed('The host left, so the match has ended.'); });
    const hello = () => this.room.send('hello', this.me());
    this.room.onJoin(hello);
    hello();
    const retry = setInterval(() => { if (this.lobby) clearInterval(retry); else hello(); }, 2000);
    try { await gotLobby; } finally { clearInterval(retry); }
  }

  // Find an open public lobby in this mode, or open one and wait for others.
  async quickMatch(settings) {
    this.ui.mpStatus('Looking for an open match…');
    const mm = makeRoom(MM_ROOM);
    await mm.join();
    mm.on('ad', (d) => { if (d && d.code) this.ads.set(d.code, d); });
    await new Promise((r) => setTimeout(r, NET_LOCAL ? 800 : 5000));
    mm.leave();
    const now = Date.now();
    const open = [...this.ads.values()].filter((a) => !a.started && a.players < a.max && a.mode === settings.mode && now - a.ts < 15000)
      .sort((a, b) => b.players - a.players);
    for (const a of open) {
      try { await this.join(a.code); return; } catch (e) { this.leave(); }
    }
    this.ui.mpStatus('No open match found, so you are hosting one. It starts automatically once someone joins.');
    await this.host(true, settings);
  }

  // ----- starting a match (host) -----
  startMatch(game, map) {
    const L = this.lobby;
    L.started = true;
    this.sendAd();
    clearInterval(this.lobbyTimer);
    this.game = game;
    this.pidByPeer = new Map();
    for (const p of game.players) if (p && p.peer) this.pidByPeer.set(p.peer, p.id);
    game.enableNetLog();
    this.spawnEnds = performance.now() + SPAWN_PHASE_SECONDS * 1000;
    this.clients = new Map();
    const base = {
      settings: L.settings, seed: map.seed,
      terrain: isPremade(L.settings.type) ? null : rleEncode(map.terrain),
      players: game.players.slice(1).map((p) => ({ id: p.id, name: p.name, color: p.color, human: p.human, tribe: p.tribe })),
      owner: rleEncode(game.owner), spawnLeft: SPAWN_PHASE_SECONDS, diff: L.settings.difficulty,
    };
    for (const [peer, pid] of this.pidByPeer) {
      if (peer === this.room.selfId) continue;
      this.clients.set(peer, { pid, lastEvent: 0, slow: 0 });
      this.room.send('start', { ...base, you: pid }, peer);
    }
  }

  onCommand(d, from) {
    if (this.role !== 'host' || !this.game) return;
    const pid = this.pidByPeer.get(from);
    if (!pid) return;
    const g = this.game;
    if (d.n === 'spawn' && g.started) return;
    const res = g.command(pid, d.n, d.a || {});
    this.room.send('r', { q: d.q, msg: res.msg, bad: res.bad }, from);
  }

  onPeerGone(id) {
    const L = this.lobby;
    if (!L) return;
    if (!L.started) {
      L.players = L.players.filter((p) => p.id !== id);
      this.broadcastLobby();
      return;
    }
    const pid = this.pidByPeer && this.pidByPeer.get(id);
    if (!pid || !this.game) return;
    const p = this.game.players[pid];
    this.clients.delete(id);
    if (p.alive && p.human) {
      p.human = false;
      p.ai = new AIController(this.game, p, PERSONALITIES[3], this.game.diff);
      this.game.log(`${p.name} disconnected. The computer now leads their nation.`, 'info');
    }
  }

  // Called every frame on the host: run the spawn countdown and stream state.
  frame() {
    const g = this.game;
    if (!g) return;
    if (!g.started) {
      const left = Math.max(0, Math.ceil((this.spawnEnds - performance.now()) / 1000));
      this.ui.spawnCountdown(left);
      const waiting = g.humans().some((h) => !h.spawned);
      if (left <= 0 || !waiting) g.begin();
    }
    const now = performance.now();
    if (now - this.lastSend < NET_SEND_MS) return;
    this.lastSend = now;
    this.sendUpdates(Math.max(0, Math.ceil((this.spawnEnds - now) / 1000)));
  }

  sendUpdates(spawnLeft) {
    const g = this.game, N = g.net;
    const common = {
      k: g.tick, st: g.started, sl: spawnLeft, over: g.over,
      o: N.own.length ? packPairs(N.own) : '',
      c: N.ctl.length ? packPairs(N.ctl) : '',
      f: N.fo.length ? packPairs(N.fo) : '',
      b: [...N.bld].map((id) => { const b = g.buildings[id]; return [b.id, b.type, b.tile, b.owner, b.alive ? 1 : 0, b.cooldown, b.level || 1]; }),
      ns: N.ships.map((s) => [s.id, s.owner, s.target, s.troops, s.speed, s.landing, s.path]),
      s: g.ships.filter((s) => !s.dead).map((s) => [s.id, Math.round(s.pos * 10) / 10, Math.round(s.troops)]),
      nm: N.missiles.map((m) => [m.id, m.owner, m.sx, m.sy, m.tx, m.ty, m.tile, m.dur, m.rOut]),
      m: g.missiles.filter((m) => !m.dead).map((m) => [m.id, m.t]),
      fx: N.fx,
      fr: null,
      a: g.attacks.filter((a) => !a.dead).map((a) => [a.id, a.attacker, a.target, Math.round(a.troops), a.seeded ? 1 : 0]),
      p: g.players.slice(1).map((p) => [p.id, p.alive ? 1 : 0, p.spawned ? 1 : 0, Math.round(p.troops), p.tiles, Math.round(p.pop),
        Math.round(p.label.x * 10) / 10, Math.round(p.label.y * 10) / 10, Math.round(p.label.size * 10) / 10, p.label.tile, p.capital,
        [...p.allies], p.human ? 1 : 0, p.peakTiles, p.kills, p.tribe ? Math.round(p.gold) : 0, p.ideology || '']),
      tr: g.treaty && g.treaty.open ? [g.treaty.id, g.treaty.closesAt, [...g.treaty.votes]] : null,
    };
    N.own.length = 0; N.ctl.length = 0; N.fo.length = 0; N.bld.clear(); N.ships.length = 0; N.missiles.length = 0; N.fx = [];
    for (const [peer, c] of this.clients) {
      const p = g.players[c.pid];
      const ev = g.events.filter((e) => e.id > c.lastEvent && (e.to ? e.to === c.pid : !(e.skip && e.skip.includes(c.pid))));
      if (g.events.length) c.lastEvent = g.events[g.events.length - 1].id;
      const msg = Object.assign({}, common, {
        ev: ev.map((e) => [e.id, e.text, e.kind]),
        rq: g.requests.filter((r) => r.to === c.pid).map((r) => [r.id, r.from, r.expires, r.kind]),
        // Sampled border tiles of every front this player is fighting on, for the map markers.
        fr: g.attacks.filter((a) => !a.dead && a.target && (a.attacker === c.pid || a.target === c.pid)).map((a) => {
          const step = Math.max(1, Math.ceil(a.frontier.length / 80));
          const out = [a.id];
          for (let k = 0; k < a.frontier.length; k += step) out.push(a.frontier[k]);
          return out;
        }),
        me: {
          gold: p.gold, income: p.income, growth: p.growth, popCap: p.popCap, popGrowth: p.popGrowth, focus: p.focus,
          techs: [...p.techs], research: p.research, progress: p.progress, rpRate: p.rpRate, stability: p.stability,
          stabTarget: p.stabTarget, stabFactors: p.stabFactors, avgControl: p.avgControl, adminCap: p.adminCap,
          martial: p.martial, boost: p.boost, celebrateReadyAt: p.celebrateReadyAt, missilesLaunched: p.missilesLaunched,
          coastal: p.coastal, mods: p.mods, field: p.field, traitorUntil: p.traitorUntil,
          science: p.science, researchSpend: p.researchSpend, grossIncome: p.grossIncome,
          ideology: p.ideology, ideologyAt: p.ideologyAt, doctrines: [...p.doctrines], ideoStab: p.ideoStab,
        },
      });
      if (now() - c.slow > 1000) {
        c.slow = now();
        msg.rel = g.players.slice(1).map((q) => Math.round(g.getRel(q.id, c.pid)));
        msg.nb = [...g.neighbors[c.pid]].map(([id, n]) => [id, n]);
      }
      this.room.send('u', msg, peer);
    }
    function now() { return performance.now(); }
  }

  sendCommand(name, a) { this.room.send('c', { n: name, a, q: ++this.cmdSeq }, this.hostId); }

  // ----- client side -----
  async onStart(d) {
    this.ui.mpStatus('The match is starting…');
    const s = d.settings;
    let map;
    if (isPremade(s.type)) { await loadPremadeMap(s.type); map = buildPremadeMap(s.type, d.seed); }
    else {
      map = generateMap({ seed: d.seed, type: s.type, size: s.size });
      const ter = new Uint8Array(map.N);
      rleDecode(d.terrain, ter);
      map = finalizeMap(map.W, map.H, ter, map.heights, { seed: d.seed, type: s.type, size: s.size, name: map.name });
    }
    const g = new Game(map, { mode: s.mode, difficulty: d.diff, multiplayer: true });
    g.mirror = true;
    g.P = d.players.length + 1 + REBEL_SLOTS;
    g.rel = new Float32Array(g.P * g.P);
    g.neighbors = [];
    for (let i = 0; i < g.P; i++) g.neighbors.push(new Map());
    for (const q of d.players) this.addMirrorPlayer(g, q);
    rleDecode(d.owner, g.owner);
    for (let i = 0; i < g.N; i++) if (g.owner[i]) g.control[i] = 100;
    this.game = g;
    this.ui.enterGame(g, d.you);
    this.ui.spawnCountdown(d.spawnLeft);
  }

  addMirrorPlayer(g, q) {
    while (g.players.length <= q.id) g.players.push(null);
    const p = new Player(q.id, q.name, q.color, q.human);
    p.tribe = !!q.tribe;
    g.initPlayer(p);
    g.players[q.id] = p;
    return p;
  }

  onUpdate(u) {
    const g = this.game;
    if (!g) return;
    const ui = this.ui, me = g.players[ui.myId];
    g.tick = u.k;
    g.started = u.st;
    if (!u.st) ui.spawnCountdown(u.sl);
    if (u.o) unpackPairs(u.o, (t, o) => { g.owner[t] = o; if (!o) g.control[t] = 0; else if (!g.politics) g.control[t] = 100; g.markDirtyAround(t); });
    if (u.c) unpackPairs(u.c, (t, c) => { g.control[t] = c; g.markDirty(t); });
    if (u.f) unpackPairs(u.f, (t, v) => { g.fallout[t] = v ? FALLOUT_SECONDS : 0; g.markDirty(t); });
    for (const [id, type, tile, owner, alive, cd, level] of u.b) this.mirrorBuilding(g, id, type, tile, owner, alive, cd, level);
    if (u.b.length) g.totalHarbors = g.buildings.reduce((n, b) => n + (b.alive && b.type === 'harbor' ? b.level || 1 : 0), 0);
    for (const [id, owner, target, troops, speed, landing, path] of u.ns) {
      g.ships.push({ id, owner, target, troops, speed, landing, path, pos: 0, dead: false });
    }
    const liveShips = new Map(u.s.map((x) => [x[0], x]));
    g.ships = g.ships.filter((s) => liveShips.has(s.id));
    for (const s of g.ships) { const x = liveShips.get(s.id); s.pos = x[1]; s.troops = x[2]; }
    for (const [id, owner, sx, sy, tx, ty, tile, dur, rOut] of u.nm) {
      g.missiles.push({ id, owner, sx, sy, tx, ty, tile, dur, rOut, t: 0, dead: false });
    }
    const liveM = new Map(u.m);
    for (const fx of u.fx) {
      if (fx.type === 'blast') g.effects.push({ type: 'blast', x: fx.x, y: fx.y, r: fx.r, at: g.time, hit: fx.hit, by: fx.by });
      else {
        const m = g.missiles.find((x) => x.id === fx.mid);
        if (m) g.effects.push({ type: 'intercept', m, arc: fx.arc, at: g.time });
      }
    }
    g.missiles = g.missiles.filter((m) => liveM.has(m.id));
    for (const m of g.missiles) m.t = liveM.get(m.id);
    g.effects = g.effects.filter((e) => g.time - e.at < 4);
    g.attacks = u.a.map(([id, attacker, target, troops, seeded]) => ({ id, attacker, target, troops, seeded: !!seeded, dead: false }));
    if (u.fr) for (const [id, ...tiles] of u.fr) { const a = g.attacks.find((x) => x.id === id); if (a) a.fs = tiles; }
    for (const row of u.p) {
      const [id, alive, spawned, troops, tiles, pop, lx, ly, ls, lt, cap, allies, human, peak, kills, stash, ideo] = row;
      const p = g.players[id];
      if (!p) continue;
      p.alive = !!alive; p.spawned = !!spawned; p.troops = troops; p.tiles = tiles; p.pop = pop;
      p.label = { x: lx, y: ly, size: ls, tile: lt };
      p.capital = cap; p.allies = new Set(allies); p.human = !!human; p.peakTiles = peak; p.kills = kills;
      if (p.tribe) p.gold = stash || 0;
      if (id !== ui.myId) p.ideology = ideo || null;
    }
    Object.assign(me, u.me);
    me.techs = new Set(u.me.techs);
    me.doctrines = new Set(u.me.doctrines || []);
    for (const [id, text, kind] of u.ev) g.events.push({ id, text, kind, time: g.time, to: 0 });
    if (g.events.length > 200) g.events.splice(0, g.events.length - 200);
    g.requests = u.rq.map(([id, from, expires, kind]) => ({ id, from, to: ui.myId, expires, kind }));
    if (u.rel) u.rel.forEach((v, k) => { g.rel[(k + 1) * g.P + ui.myId] = v; });
    if (u.nb) g.neighbors[ui.myId] = new Map(u.nb);
    g.treaty = u.tr ? { id: u.tr[0], open: true, closesAt: u.tr[1], votes: new Map(u.tr[2]) } : null;
    if (u.over) g.over = u.over;
    this.localTicks = 0;
  }

  mirrorBuilding(g, id, type, tile, owner, alive, cooldown, level = 1) {
    while (g.buildings.length <= id) g.buildings.push({ id: g.buildings.length, alive: false, type: 'city', tile: 0, owner: 0, x: 0, y: 0, cooldown: 0 });
    const b = g.buildings[id];
    const wasAlive = b.alive && b.owner;
    if (wasAlive) {
      const po = g.players[b.owner];
      po.counts[b.type] -= b.level || 1;
      const k = po.blds.indexOf(b);
      if (k >= 0) po.blds.splice(k, 1);
      if (g.bldAt[b.tile] === id) g.bldAt[b.tile] = -1;
    }
    Object.assign(b, { id, type, tile, owner, alive: !!alive, cooldown, level, x: tile % g.W, y: Math.floor(tile / g.W) });
    if (b.alive) {
      const pn = g.players[owner];
      pn.counts[type] += level;
      pn.blds.push(b);
      g.bldAt[tile] = id;
    }
  }

  // Between host updates, keep fleets, missiles and reload timers moving smoothly.
  clientFrame(dt) {
    const g = this.game;
    if (!g || !g.started) return;
    this.acc = (this.acc || 0) + dt;
    while (this.acc >= 100) {
      this.acc -= 100;
      if (++this.localTicks > 6) continue;
      g.tick++;
      for (const s of g.ships) s.pos = Math.min(s.path.length - 1, s.pos + s.speed);
      for (const m of g.missiles) m.t = Math.min(m.dur, m.t + 1);
      for (const b of g.buildings) if (b.alive && b.cooldown > 0) b.cooldown--;
    }
  }

  leave() {
    clearInterval(this.lobbyTimer);
    if (this.room) this.room.leave();
    if (this.mm) this.mm.leave();
    this.room = null; this.mm = null; this.lobby = null; this.game = null; this.role = null;
  }
}
