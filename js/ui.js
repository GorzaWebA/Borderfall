'use strict';
// DOM interface: start menu, HUD, input handling, context menu, tooltips and modals.

// Heraldic tinctures for the player's nation.
const PLAYER_COLORS = [
  { hex: '#2f63b5', name: 'Azure' }, { hex: '#b83a2e', name: 'Gules' }, { hex: '#d6a426', name: 'Or' },
  { hex: '#2f8a57', name: 'Vert' }, { hex: '#7446a8', name: 'Purpure' }, { hex: '#c8692a', name: 'Tenné' },
  { hex: '#3d9fc0', name: 'Celeste' }, { hex: '#9c3563', name: 'Murrey' },
];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDuration(sec) {
  if (!isFinite(sec)) return 'a long time';
  if (sec < 60) return `${Math.max(1, sec)}s`;
  const m = Math.floor(sec / 60), r = sec % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function relLabel(v) {
  if (v >= 40) return ['Friendly', 'rel-good'];
  if (v >= 10) return ['Warm', 'rel-good'];
  if (v > -10) return ['Neutral', ''];
  if (v > -40) return ['Wary', 'rel-bad'];
  return ['Hostile', 'rel-bad'];
}

const PREFS_VERSION = 2;
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('borderfall.prefs') || '{}') || {}; } catch (e) { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem('borderfall.prefs', JSON.stringify(p)); } catch (e) { /* storage unavailable */ }
}

class UI {
  constructor(renderer) {
    this.r = renderer;
    this.canvas = renderer.cv;
    this.game = null;
    this.map = null;
    this.speed = 1;
    this.modalOpen = false;
    this.ratio = 0.1;
    this.lastEvent = 0;
    this.hudTimer = 0;
    this.mouse = { x: -1, y: -1, inside: false };
    this.keys = new Set();
    this.pointers = new Map();
    this.overShown = false;
    this.toastEls = new Map();
    this.noticeTimer = 0;
    this.prefs = loadPrefs();
    this.color = PLAYER_COLORS.some((c) => c.hex === this.prefs.color) ? this.prefs.color : PLAYER_COLORS[0].hex;
    this.genTimer = 0;
    this.myId = 1;
    this.net = null;
    this.tutorial = null;

    this.initMenu();
    this.initHud();
    this.initInput();
  }

  isPaused() {
    if (this.net && this.game && this.game.multiplayer) return this.isClient();
    return this.speed === 0 || (this.modalOpen && !this.tutorialModalRunning);
  }
  playerName() {
    const v = $('opt-name').value.trim();
    if (!v) $('opt-name').value = this.suggestName();
    return ($('opt-name').value.trim()).slice(0, 16);
  }
  // A name in the same style as the rival nations, different from the one shown now.
  suggestName() {
    const cur = $('opt-name').value.trim();
    const pool = NATION_NAMES.filter((n) => n !== cur);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  get me() { return this.game.players[this.myId]; }
  isClient() { return !!(this.net && this.net.role === 'client'); }

  // Run a player action. Offline and on the host it runs here; clients send it to the host,
  // which replies with the notice. Returns the result when known right away.
  cmd(name, a = {}, quiet) {
    if (this.isClient()) { this.net.sendCommand(name, a); return null; }
    const res = this.game.command(this.myId, name, a);
    if (!quiet && res && res.msg) this.notice(res.msg, res.bad);
    this.updateHud(true);
    return res;
  }

  // ---------- menu ----------
  initMenu() {
    const P = this.prefs;
    $('opt-name').value = P.name && P.name !== 'Your Nation' ? P.name : this.suggestName();
    if (P.type && $('opt-type').querySelector(`option[value="${P.type}"]`)) $('opt-type').value = P.type;
    if (P.size) $('opt-size').value = P.size;
    // Counts saved before the defaults were raised are ignored.
    if (P.v === PREFS_VERSION && P.numAI) $('opt-ai').value = P.numAI;
    else $('opt-ai').value = recommendedRivals($('opt-type').value, $('opt-size').value) || 20;
    if (P.diff) { const r = document.querySelector(`input[name=diff][value=${P.diff}]`); if (r) r.checked = true; }
    if (P.mode && MODES[P.mode]) { const r = document.querySelector(`input[name=mode][value=${P.mode}]`); if (r) r.checked = true; }
    const modeDesc = () => { $('mode-desc').textContent = MODES[document.querySelector('input[name=mode]:checked').value].desc; };
    for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', modeDesc);
    modeDesc();
    $('opt-ai-out').textContent = $('opt-ai').value;
    $('opt-seed').value = String(Math.floor(Math.random() * 900000) + 100000);

    const sw = $('opt-colors');
    for (const { hex, name } of PLAYER_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.setProperty('--sw', hex);
      b.title = name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-checked', String(hex === this.color));
      b.addEventListener('click', () => {
        this.color = hex;
        for (const x of sw.children) x.setAttribute('aria-checked', String(x === b));
      });
      sw.appendChild(b);
    }
    $('btn-rename').addEventListener('click', () => { $('opt-name').value = this.suggestName(); });
    $('setup').addEventListener('input', () => this.updateWorldSummary());
    $('setup').addEventListener('change', () => this.updateWorldSummary());

    $('opt-ai').addEventListener('input', () => { $('opt-ai-out').textContent = $('opt-ai').value; });
    if (P.v === PREFS_VERSION && P.numTribes !== undefined) $('opt-tribes').value = P.numTribes;
    $('opt-tribes-out').textContent = $('opt-tribes').value;
    $('opt-tribes').addEventListener('input', () => { $('opt-tribes-out').textContent = $('opt-tribes').value; });
    $('opt-size').addEventListener('change', () => {
      const rec = recommendedRivals($('opt-type').value, $('opt-size').value);
      if (rec) { $('opt-ai').value = rec; $('opt-ai-out').textContent = rec; this.updateWorldSummary(); }
      this.queuePreview();
    });
    $('opt-type').addEventListener('change', () => {
      if ($('opt-type').value === 'random') {
        this.rollRandomType();
        $('opt-seed').value = String(Math.floor(Math.random() * 900000) + 100000);
      }
      const rec = recommendedRivals($('opt-type').value, $('opt-size').value);
      if (rec) { $('opt-ai').value = rec; $('opt-ai-out').textContent = rec; }
      this.updateMapFields();
      this.queuePreview(0);
    });
    this.updateMapFields();
    $('opt-seed').addEventListener('input', () => this.queuePreview());
    $('btn-reroll').addEventListener('click', () => {
      $('opt-seed').value = String(Math.floor(Math.random() * 900000) + 100000);
      if ($('opt-type').value === 'random') this.rollRandomType();
      this.updateMapFields();
      this.queuePreview(0);
    });
    $('btn-help').addEventListener('click', () => this.showHelp());
    $('btn-tutorial').addEventListener('click', () => this.startTutorial());
    let tutDone = false;
    try { tutDone = localStorage.getItem('borderfall.tutorialDone') === '1'; } catch (e) { /* storage unavailable */ }
    $('btn-tutorial').classList.toggle('nudge', !tutDone);
    if (!tutDone) $('btn-tutorial').textContent = 'New here? Play the tutorial';
    const gfx = P.gfx === 'low' ? 'low' : 'high';
    document.querySelector(`input[name=gfx][value=${gfx}]`).checked = true;
    this.r.setQuality(gfx);
    for (const r of document.querySelectorAll('input[name=gfx]')) r.addEventListener('change', () => this.setGraphics(r.value));
    this.updateWorldSummary();
    this.initMultiplayer();
    $('setup').addEventListener('submit', (e) => { e.preventDefault(); this.startGame(); });
    $('btn-random-spawn').addEventListener('click', () => this.randomSpawn());
    this.generatePreview();
  }

  rollRandomType() {
    const kinds = ['continents', 'pangaea', 'archipelago', 'highlands'];
    this.randomType = kinds[Math.floor(Math.random() * kinds.length)];
  }

  setGraphics(q) {
    this.r.setQuality(q);
    this.prefs.gfx = q;
    savePrefs(this.prefs);
    const r = document.querySelector(`input[name=gfx][value=${q}]`);
    if (r) r.checked = true;
  }

  mapOptions() {
    let type = $('opt-type').value;
    if (type === 'random') { if (!this.randomType) this.rollRandomType(); type = this.randomType; }
    return { seed: seedFromInput($('opt-seed').value), type, size: isFixedMap(type) ? 'fixed' : $('opt-size').value };
  }

  // Fixed maps (real world, competitive) have no size choice; the seed only places rivals.
  updateWorldSummary() {
    const diff = document.querySelector('input[name=diff]:checked').value;
    const tribes = Number($('opt-tribes').value);
    $('world-summary').textContent = `${$('opt-ai').value} rivals, ${tribes ? tribes + ' tribes' : 'no tribes'}, ${diff}`;
  }

  updateMapFields() {
    const type = $('opt-type').value;
    const fixed = isFixedMap(type);
    $('size-field').hidden = fixed;
    $('size-field').parentElement.classList.toggle('single', fixed);
    $('seed-label').textContent = fixed ? 'Rival placement seed' : 'World seed';
    const desc = $('map-desc');
    const comp = MAP_TYPES[type] && MAP_TYPES[type].competitive;
    desc.hidden = !fixed && type !== 'random';
    if (type === 'random' && !this.randomType) this.rollRandomType();
    desc.textContent = type === 'random' ? `This time: ${MAP_TYPES[this.randomType].label}. Press New world for another.` :
      comp ? `${MAP_TYPES[type].desc} Every region has an identical twin.` :
      isPremade(type) ? 'Real coastlines, mountains, deserts and forests.' : '';
  }

  mapKeyOf(o) { return `${o.seed}|${o.type}|${o.size}`; }

  queuePreview(delay = 250) {
    clearTimeout(this.genTimer);
    $('btn-start').disabled = true;
    $('btn-start').textContent = 'Drawing the world…';
    this.genTimer = setTimeout(() => this.generatePreview(), delay);
  }

  generatePreview() {
    clearTimeout(this.genTimer);
    this.genTimer = 0;
    const o = this.mapOptions();
    const key = this.mapKeyOf(o);
    this.pendingKey = key;
    const show = (map) => {
      if (this.pendingKey !== key) return;
      this.map = map;
      this.mapKey = key;
      this.r.insetLeft = !$('menu').hidden && window.innerWidth > 640 ? $('menu').querySelector('.menu-panel').offsetWidth * 0.9 : 0;
      this.r.setMap(map);
      $('btn-start').disabled = false;
      $('btn-start').textContent = 'Choose your homeland';
    };
    if (isPremade(o.type)) {
      $('btn-start').disabled = true;
      $('btn-start').textContent = `Loading ${mapLabel(o.type)}…`;
      loadPremadeMap(o.type).then(() => show(buildPremadeMap(o.type, o.seed))).catch(() => {
        if (this.pendingKey !== key) return;
        $('btn-start').disabled = false;
        $('btn-start').textContent = 'Map failed to load. Tap to retry.';
        this.mapKey = '';
      });
    } else {
      show(generateMap(o));
    }
  }

  startGame() {
    const o = this.mapOptions();
    if (this.genTimer || this.mapKey !== this.mapKeyOf(o)) {
      // Finish drawing the chosen map first; real-world maps load in the background.
      this.generatePreview();
      if (this.mapKey !== this.mapKeyOf(o)) return;
    }
    const name = this.playerName();
    const diff = document.querySelector('input[name=diff]:checked').value;
    const mode = document.querySelector('input[name=mode]:checked').value;
    const numAI = Number($('opt-ai').value);
    if (!this.tutorialPending) {
      this.prefs = { ...this.prefs, name, type: $('opt-type').value, size: $('opt-size').value, numAI, numTribes: Number($('opt-tribes').value), diff, mode, color: this.color, v: PREFS_VERSION };
      savePrefs(this.prefs);
    }
    if (this.isClient()) return;
    const game = new Game(this.map, { difficulty: diff, mode, multiplayer: !!this.net });
    if (this.net) {
      const humans = this.net.lobby.players.map((p) => ({ name: p.name, color: hexToRgb(p.color), peer: p.id }));
      game.setupPlayers({ humans, numAI, numTribes: Number($('opt-tribes').value), difficulty: diff });
      this.net.startMatch(game, this.map);
    } else {
      game.setupPlayers({ playerName: name, playerColor: hexToRgb(this.color), numAI, numTribes: Number($('opt-tribes').value), difficulty: diff });
    }
    this.enterGame(game, 1);
    if (this.tutorialPending) {
      this.tutorialPending = false;
      this.tutorial = new Tutorial(this);
      this.tutorial.begin();
    }
  }

  // Everything that resets the screen for a new match, offline, hosted or joined.
  enterGame(game, myId) {
    this.game = game;
    this.myId = myId;
    this.r.myId = myId;
    this.lastEvent = 0;
    this.overShown = false;
    this.fallenShown = false;
    this.spawnedShown = false;
    this.closeModal();
    if (this.tutorial && game !== this.tutorial.game) { this.tutorial.end(); this.tutorial = null; }
    document.querySelector('.speed').hidden = game.multiplayer;
    $('spawn-banner').querySelector('p').textContent = game.multiplayer
      ? 'Pick your starting spot on any unclaimed land.'
      : 'Click any unclaimed land to found your nation. Rivals are already on the map.';
    this.speed = 1;
    this.setSpeedButtons();
    this.r.insetLeft = 0;
    if (this.r.map !== game.map) this.r.setMap(game.map);
    this.r.setGame(game);
    this.r.fit();
    this.r.mode = { kind: 'spawn' };
    $('menu').hidden = true;
    $('hud').hidden = true;
    $('spawn-banner').hidden = false;
    $('log').innerHTML = '';
    $('fronts').hidden = true;
    for (const el of this.toastEls.values()) el.remove();
    this.toastEls.clear();
    $('st-stability').hidden = !game.politics;
    for (const type of BUILD_ORDER) this.buildBtns[type].hidden = !game.buildingAvailable(type);
    this.drawBuildIcons();
  }

  randomSpawn() {
    const g = this.game;
    if (!g || g.started) return;
    const cand = [];
    for (let k = 0; k < 4000 && cand.length < 60; k++) {
      const i = Math.floor(Math.random() * g.N);
      if (!g.canSpawnAt(i) || g.map.terrain[i] === T_MOUNTAIN) continue;
      // Prefer roomy land away from rivals over remote specks.
      const x = i % g.W, y = (i - x) / g.W;
      let near = 1e9;
      for (const p of g.players) {
        if (!p || p.human || !p.alive) continue;
        near = Math.min(near, Math.hypot(p.label.x - x, p.label.y - y));
      }
      let land = 0, seen = 0;
      for (let dy = -14; dy <= 14; dy += 2) {
        for (let dx = -14; dx <= 14; dx += 2) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= g.W || yy >= g.H) continue;
          seen++;
          const t = g.map.terrain[yy * g.W + xx];
          if (t > T_SEA && t !== T_MOUNTAIN && !g.owner[yy * g.W + xx]) land++;
        }
      }
      cand.push([Math.min(near, 45) + (land / Math.max(1, seen)) * 45, i]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    if (cand.length) this.spawn(cand[Math.floor(Math.random() * Math.min(8, cand.length))][1]);
  }

  spawn(tile) {
    if (this.me.spawned) return;
    const res = this.cmd('spawn', { tile }, true);
    if (res && res.bad) { this.notice(res.msg, true); return; }
    if (res) this.onSpawned(tile);
  }

  // Called once our nation exists (right away offline, or when the host confirms it).
  onSpawned(tile) {
    const g = this.game;
    this.spawnedShown = true;
    this.r.mode = null;
    $('hud').hidden = false;
    $('spawn-banner').hidden = !(g.multiplayer && !g.started);
    if (tile >= 0) {
      const x = tile % g.W, y = (tile - x) / g.W;
      this.r.centerOn(x + 0.5, y + 0.5, Math.max(this.r.minZoom() * 2.5, 4));
    }
    this.updateHud(true);
    if (this.tutorial) this.tutorial.check();
  }

  backToMenu() {
    this.closeModal();
    this.closeCtx();
    if (this.net) { this.net.leave(); this.net = null; this.leaveLobby(true); }
    if (this.tutorial) { this.tutorial.end(); this.tutorial = null; }
    if ($('opt-type').value === 'random') { this.rollRandomType(); $('opt-seed').value = String(Math.floor(Math.random() * 900000) + 100000); this.updateMapFields(); }
    this.game = null;
    this.r.mode = null;
    $('hud').hidden = true;
    $('spawn-banner').hidden = true;
    $('menu').hidden = false;
    $('tooltip').hidden = true;
    this.generatePreview();
  }

  // ---------- HUD ----------
  initHud() {
    for (const b of document.querySelectorAll('.speed button')) {
      b.addEventListener('click', () => { this.speed = Number(b.dataset.speed); this.setSpeedButtons(); });
    }
    $('btn-menu').addEventListener('click', () => this.showGameMenu());
    // Panels are placed from the measured heights of the top bar, command bar and dock, so they
    // stay clear of each other whatever the screen size or zoom.
    const measure = () => {
      const root = document.documentElement.style;
      for (const [id, v] of [['topbar', '--top-h'], ['command', '--cmd-h'], ['dock', '--dock-h']]) {
        const h = $(id).offsetHeight;
        if (h) root.setProperty(v, `${h}px`);
      }
    };
    if (window.ResizeObserver) { const ro = new ResizeObserver(measure); for (const id of ['topbar', 'command', 'dock']) ro.observe($(id)); }
    window.addEventListener('resize', measure);
    for (const b of document.querySelectorAll('#command [data-open]')) b.addEventListener('click', () => this.openNation(b.dataset.open));
    $('treaty').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-treaty]');
      const T = this.game && this.game.treaty;
      if (!b || !T || !T.open) return;
      const accept = b.dataset.treaty === '1';
      this.cmd('treaty', { id: T.id, accept });
      T.votes.set(this.myId, accept);
      this.treatyKey = '';
      this.updateTreaty();
    });
    $('st-year').addEventListener('click', () => this.openNation('tech'));
    $('st-stability').addEventListener('click', () => this.openNation('gov'));
    const ratio = $('ratio');
    ratio.addEventListener('input', () => { this.ratio = Number(ratio.value) / 100; this.updateRatio(); });

    const builds = $('builds');
    this.buildBtns = {};
    for (const type of BUILD_ORDER) {
      const def = BUILDINGS[type];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bbtn';
      b.title = `${def.name}: ${def.desc} (key ${def.key})`;
      b.innerHTML = `<span class="hk">${def.key}</span><canvas width="60" height="60" style="width:30px;height:30px"></canvas><span class="nm">${def.name}</span><span class="cost"></span>`;
      b.addEventListener('click', () => this.toggleBuild(type));
      builds.appendChild(b);
      this.buildBtns[type] = b;
    }
    const div = document.createElement('div');
    div.className = 'divider';
    builds.appendChild(div);
    const m = document.createElement('button');
    m.type = 'button';
    m.className = 'bbtn missile';
    m.title = 'Missile: wipes out troops and scorches land where it lands. Needs a silo. (key M)';
    m.innerHTML = `<span class="hk">M</span><canvas width="60" height="60" style="width:30px;height:30px"></canvas><span class="nm">Missile</span><span class="cost"></span>`;
    m.addEventListener('click', () => this.toggleMissile());
    builds.appendChild(m);
    this.missileBtn = m;
    this.drawBuildIcons();

    $('fronts').addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button[data-retreat]');
      if (btn && this.game) {
        this.cmd('retreat', { id: Number(btn.dataset.retreat) });
      }
    });
    $('board-list').addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li[data-pid]');
      if (!li || !this.game) return;
      const p = this.game.players[Number(li.dataset.pid)];
      if (p && p.alive) this.r.centerOn(p.label.x, p.label.y, Math.max(this.r.cam.zoom, 2.5));
    });
  }

  drawBuildIcons() {
    const color = this.game ? this.me.color : hexToRgb(this.color);
    for (const type of BUILD_ORDER) {
      const cv = this.buildBtns[type].querySelector('canvas');
      const c = cv.getContext('2d');
      c.clearRect(0, 0, 60, 60);
      drawBuildingIcon(c, type, 30, 30, 40, color, false);
    }
    const cv = this.missileBtn.querySelector('canvas');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 60, 60);
    drawBuildingIcon(c, 'missile', 30, 30, 40, [214, 90, 60], false);
  }

  setSpeedButtons() {
    for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('on', Number(b.dataset.speed) === this.speed);
  }

  updateRatio() {
    $('ratio-out').textContent = `${Math.round(this.ratio * 100)}%`;
    $('ratio').value = Math.round(this.ratio * 100);
    const g = this.game;
    $('ratio-troops').textContent = g && this.me ? fmt(this.me.troops * this.ratio) : '';
  }

  notice(text, bad) {
    const n = $('notice');
    n.textContent = text;
    n.classList.toggle('bad', !!bad);
    n.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => n.classList.remove('show'), 2600);
  }

  // Missile hits on us shake the screen and flash; an incoming missile pulses the screen edge.
  checkBombs() {
    const g = this.game, my = this.myId;
    for (const e of g.effects) {
      if (e.type !== 'blast' || e.seen) continue;
      e.seen = true;
      if (e.hit && e.hit.includes(my) && e.by !== my) {
        this.r.startShake(18, 850);
        const f = $('flash');
        f.classList.remove('boom');
        void f.offsetWidth;
        f.classList.add('boom');
      }
    }
    const incoming = g.missiles.some((m) => !m.dead && m.owner !== my && g.owner[m.tile] === my);
    $('flash').classList.toggle('warn', incoming);
  }

  frame(dt) {
    // Keyboard panning.
    if (this.keys.size && !this.modalOpen) {
      const sp = 0.7 * dt;
      let dx = 0, dy = 0;
      if (this.keys.has('arrowleft') || this.keys.has('a')) dx += sp;
      if (this.keys.has('arrowright') || this.keys.has('d')) dx -= sp;
      if (this.keys.has('arrowup') || this.keys.has('w')) dy += sp;
      if (this.keys.has('arrowdown') || this.keys.has('s')) dy -= sp;
      if (dx || dy) this.r.pan(dx, dy);
    }
    this.rollNumbers(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 200;
      if (this.game && this.game.started) this.updateHud();
      if (this.mouse.inside && this.pointers.size === 0) this.updateTooltip();
    }
  }

  // Troops, treasury and people roll toward their true values every frame instead of jumping
  // with each HUD refresh, so spending and income read as movement.
  rollNumbers(dt) {
    const g = this.game;
    if (!g || !g.started || $('hud').hidden) { this.shown = null; return; }
    const me = this.me;
    const k = 1 - Math.exp(-dt / 1000 * 10);
    if (!this.shown || this.shown.game !== g) this.shown = { game: g, troops: me.troops, gold: me.gold, pop: me.pop, text: {} };
    const S = this.shown;
    for (const [id, key, f] of [['v-troops', 'troops', fmt], ['v-gold', 'gold', fmtMoney], ['v-pop', 'pop', fmt]]) {
      const target = me[key];
      S[key] = Math.abs(target - S[key]) < 1 ? target : S[key] + (target - S[key]) * k;
      const text = f(S[key]);
      if (S.text[id] !== text) { S.text[id] = text; $(id).textContent = text; }
    }
  }

  updateHud(force) {
    const g = this.game;
    if (!g) return;
    const me = this.me;
    const cap = g.troopCap(me);
    $('v-cap').textContent = `/ ${fmt(cap)}`;
    const gr = $('v-growth');
    gr.textContent = `${me.growth >= 0 ? '+' : ''}${fmt(me.growth * 60)}/min`;
    gr.classList.toggle('neg', me.growth < 0);
    $('v-income').textContent = `${me.income >= 0 ? '+' : ''}${fmtMoney(me.income * 60)}/min`;
    const share = g.landShare(me);
    $('v-land').textContent = `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
    $('v-tiles').textContent = `${fmt(me.tiles)} tiles`;
    $('v-landbar').style.width = `${Math.min(100, share * 100)}%`;
    $('v-time').textContent = g.mode.endYear
      ? `${fmtTime(Math.max(0, (g.mode.endYear - START_YEAR) * g.mode.secPerYear - g.time))} left`
      : fmtTime(g.time);
    $('v-popcap').textContent = `/ ${fmt(me.popCap)}`;
    const pg = $('v-popgrowth');
    pg.textContent = `${me.popGrowth >= 0 ? '+' : ''}${fmt(me.popGrowth * 60)}/min`;
    pg.classList.toggle('neg', me.popGrowth < 0);
    if (g.politics) {
      const st = Math.round(me.stability), tg = Math.round(me.stabTarget);
      const v = $('v-stab');
      v.textContent = st;
      v.className = 'v' + (st < REVOLT_BELOW ? ' bad' : st < 45 ? ' warn' : '');
      $('v-stabtrend').textContent = tg > st + 1 ? `rising to ${tg}` : tg < st - 1 ? `falling to ${tg}` : 'steady';
      $('v-stabbar').style.width = `${clamp(me.stability, 0, 100)}%`;
    }
    $('v-year').textContent = g.year;
    $('v-era').textContent = ERAS[eraIndex(g.year)].name;
    if (me.research) {
      const t = TECH_BY_ID[me.research];
      const f = clamp((me.progress[t.id] || 0) / g.techCost(me, t), 0, 1);
      $('v-research').textContent = `${t.name} ${Math.floor(f * 100)}%`;
      $('v-resbar').style.width = `${f * 100}%`;
    } else {
      $('v-research').textContent = g.availableTechs(me).length ? 'Choose research' : 'Nothing to research yet';
      $('v-resbar').style.width = '0%';
    }
    this.updateRatio();

    for (const type of BUILD_ORDER) {
      const b = this.buildBtns[type];
      if (!g.buildingAvailable(type)) { b.hidden = true; continue; }
      const def = BUILDINGS[type];
      const unlocked = g.buildingUnlocked(me, type);
      const cost = g.buildCost(me, type);
      b.querySelector('.cost').textContent = unlocked ? fmtMoney(cost) : 'Locked';
      b.classList.toggle('locked', !unlocked);
      b.classList.toggle('poor', unlocked && me.gold < cost);
      b.classList.toggle('on', !!(this.r.mode && this.r.mode.kind === 'build' && this.r.mode.type === type));
      const title = unlocked ? `${def.name}: ${def.desc} (key ${def.key})` : `${def.name} (locked): research ${TECH_BY_ID[def.tech].name} to unlock. ${def.desc}`;
      if (b.title !== title) b.title = title;
    }
    const mc = g.missileCost(me);
    this.missileBtn.querySelector('.cost').textContent = me.counts.silo ? fmtMoney(mc) : 'Needs silo';
    this.missileBtn.classList.toggle('poor', !me.counts.silo || me.gold < mc || !g.readySilo(me));
    this.missileBtn.classList.toggle('on', !!(this.r.mode && this.r.mode.kind === 'missile'));

    this.updateBoard();
    this.updateFronts();
    this.updateLog();
    this.updateToasts();
    this.updateTreaty();

    if (!this.spawnedShown && me.spawned) this.onSpawned(me.capital);
    this.checkBombs();
    if (g.over && !this.overShown) {
      this.overShown = true;
      this.fallenShown = true;
      this.showGameOver();
    } else if (!g.over && me.spawned && !me.alive && !this.fallenShown) {
      this.fallenShown = true;
      this.showGameOver();
    }
    if (this.tutorial) this.tutorial.check();
  }

  updateBoard() {
    const g = this.game;
    const alive = g.players.filter((p) => p && p.alive && p.spawned && !p.tribe).sort((a, b) => b.tiles - a.tiles);
    const tribes = g.players.filter((p) => p && p.alive && p.tribe).length;
    $('board-count').textContent = tribes ? `${alive.length} left, ${tribes} tribes` : `${alive.length} left`;
    const rows = [];
    const row = (p, rank) => {
      const ally = g.isAllied(this.myId, p.id) ? '<span class="ally">Ally</span>' : p.human && p.id !== this.myId ? '<span class="ally pl">Player</span>' : '';
      const share = g.landShare(p) * 100;
      return `<li data-pid="${p.id}" class="${p.id === this.myId ? 'me' : ''}" style="--c:${rgbCss(p.color)}"><span class="rk">${rank}</span><span class="nm">${esc(p.name)}${ally}</span><span class="ld">${share.toFixed(share < 10 ? 1 : 0)}%</span><span class="tr">${fmt(p.troops)}</span></li>`;
    };
    const top = Math.min(10, alive.length);
    for (let k = 0; k < top; k++) rows.push(row(alive[k], k + 1));
    const myRank = alive.indexOf(this.me);
    if (myRank >= top) {
      rows.push('<li class="sep" aria-hidden="true"></li>');
      rows.push(row(this.me, myRank + 1));
    }
    const html = rows.join('');
    if (html !== this.boardHtml) { $('board-list').innerHTML = html; this.boardHtml = html; }
  }

  updateFronts() {
    const g = this.game;
    const out = [], inc = [];
    for (const a of g.attacks) {
      if (a.dead) continue;
      if (a.attacker === this.myId) {
        const t = a.target ? g.players[a.target] : null;
        out.push(`<div class="front" style="--c:${t ? rgbCss(t.color) : '#a89f80'}"><span class="nm">${t ? esc(t.name) : 'Unclaimed land'}${a.seeded ? ' (beachhead)' : ''}</span><span class="tr">${fmt(a.troops)}</span><button type="button" data-retreat="${a.id}" title="Pull back 80% of these troops">Retreat</button></div>`);
      } else if (a.target === this.myId) {
        const p = g.players[a.attacker];
        inc.push(`<div class="front in" style="--c:${rgbCss(p.color)}"><span class="nm">${esc(p.name)}${a.seeded ? ' (beachhead)' : ''}</span><span class="tr">${fmt(a.troops)}</span><span></span></div>`);
      }
    }
    for (const s of g.ships) {
      if (s.dead) continue;
      const secs = Math.max(0, Math.ceil((s.path.length - 1 - s.pos) / Math.max(0.01, s.speed) / TPS));
      const eta = secs > 0 ? `${secs}s` : 'landing';
      if (s.owner === this.myId) {
        const t = s.target ? g.players[s.target] : null;
        out.push(`<div class="front" style="--c:${t ? rgbCss(t.color) : '#a89f80'}"><span class="nm">Fleet to ${t ? esc(t.name) : 'unclaimed land'}</span><span class="tr">${fmt(s.troops)}</span><span class="eta">${eta}</span></div>`);
      } else if (s.target === this.myId) {
        const p = g.players[s.owner];
        inc.push(`<div class="front in" style="--c:${rgbCss(p.color)}"><span class="nm">Fleet from ${esc(p.name)}</span><span class="tr">${fmt(s.troops)}</span><span class="eta">${eta}</span></div>`);
      }
    }
    for (const m of g.missiles) {
      if (m.dead) continue;
      const o = g.owner[m.tile];
      const eta = Math.max(0, Math.ceil((m.dur - m.t) / TPS));
      if (o === this.myId && m.owner !== this.myId) {
        inc.push(`<div class="front in" style="--c:#e0533d"><span class="nm">Missile from ${esc(g.players[m.owner].name)}</span><span class="tr">${eta}s</span><span></span></div>`);
      }
    }
    const el = $('fronts');
    if (!out.length && !inc.length) { el.hidden = true; this.frontsHtml = ''; return; }
    el.hidden = false;
    const html = (out.length ? `<h3>Your offensives</h3>${out.join('')}` : '') + (inc.length ? `<h3>Under attack</h3>${inc.join('')}` : '');
    if (html !== this.frontsHtml) { el.innerHTML = html; this.frontsHtml = html; }
  }

  updateLog() {
    const g = this.game, log = $('log');
    for (const e of g.events) {
      if (e.id <= this.lastEvent) continue;
      this.lastEvent = e.id;
      if (e.to ? e.to !== this.myId : (e.skip && e.skip.includes(this.myId))) continue;
      // The log reads as a chronicle: each entry carries the year it happened.
      const li = document.createElement('li');
      li.className = e.kind;
      const yr = document.createElement('span');
      yr.className = 'yr';
      yr.textContent = g.year;
      li.append(yr, document.createTextNode(e.text));
      li.dataset.t = String(performance.now());
      log.appendChild(li);
    }
    while (log.children.length > 6) log.firstChild.remove();
    const now = performance.now();
    for (const li of log.children) {
      const age = now - Number(li.dataset.t);
      li.classList.toggle('old', age > 9000);
      if (age > 22000) li.remove();
    }
  }

  updateToasts() {
    const g = this.game, box = $('toasts');
    const live = new Set();
    for (const r of g.requests) {
      if (r.to !== this.myId) continue;
      live.add(r.id);
      const p = g.players[r.from];
      let el = this.toastEls.get(r.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'toast';
        el.style.setProperty('--c', rgbCss(p.color));
        el.innerHTML = `<p><b>${esc(p.name)}</b> proposes an alliance. Allies can't attack each other.</p><div class="acts"><button type="button" class="primary" data-a="1">Accept</button><button type="button" class="ghost" data-a="0">Decline</button></div><div class="timer"></div>`;
        el.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-a]');
          if (!b || !this.game) return;
          this.cmd('respond', { id: r.id, accept: b.dataset.a === '1' });
          el.remove();
          this.toastEls.delete(r.id);
        });
        box.appendChild(el);
        this.toastEls.set(r.id, el);
        r.total = r.expires - g.tick;
      }
      el.querySelector('.timer').style.width = `${clamp((r.expires - g.tick) / (r.total || 200), 0, 1) * 100}%`;
    }
    for (const [id, el] of this.toastEls) {
      if (!live.has(id)) { el.remove(); this.toastEls.delete(id); }
    }
  }

  // The general peace proposed near the end of the game: standings, sign or fight on.
  updateTreaty() {
    const g = this.game, T = g.treaty, el = $('treaty'), me = this.me;
    if (!T || !T.open || !me.alive || g.over) { el.hidden = true; return; }
    const nations = g.players.filter((p) => p && p.alive && !p.tribe).sort((a, b) => b.tiles - a.tiles);
    const top = nations[0], rank = nations.indexOf(me) + 1;
    const pct = (p) => `${Math.round(g.landShare(p) * 100)}%`;
    const standing = top === me
      ? `Yours is the largest nation, with ${pct(me)} of the land. Signing wins the game.`
      : `${top.name} is the largest nation, with ${pct(top)} of the land. You hold ${pct(me)} and rank ${rank} of ${nations.length}. Signing ends the game with ${top.name} ahead.`;
    const mine = T.votes.get(this.myId);
    const humans = g.players.filter((p) => p && p.human && p.alive);
    let status = '';
    if (g.multiplayer) {
      const signed = humans.filter((h) => T.votes.get(h.id) === true).map((h) => h.name);
      const waiting = humans.filter((h) => !T.votes.has(h.id)).map((h) => h.name);
      status = `Every player must sign. ${signed.length ? `Signed: ${signed.join(', ')}.` : 'Nobody has signed yet.'}${waiting.length ? ` Waiting for ${waiting.join(', ')}.` : ''}`;
    }
    const left = Math.max(0, T.closesAt - g.tick);
    const key = `${T.id}|${standing}|${status}|${mine}`;
    if (key !== this.treatyKey) {
      this.treatyKey = key;
      const acts = mine === true
        ? '<p class="treaty-wait">You signed.</p>'
        : '<div class="acts"><button type="button" class="primary" data-treaty="1">Sign the peace</button><button type="button" class="ghost" data-treaty="0">Fight on</button></div>';
      el.innerHTML = `<h3>A general peace</h3>
        <p>Envoys of the great powers propose to end the wars. If it is signed, the game ends now and the largest nation wins.</p>
        <p class="treaty-standing">${esc(standing)}</p>
        ${status ? `<p class="treaty-wait">${esc(status)}</p>` : ''}
        ${acts}<div class="timer"></div>`;
    }
    el.hidden = false;
    el.querySelector('.timer').style.width = `${clamp(left / (TREATY_SECONDS * TPS), 0, 1) * 100}%`;
  }

  // ---------- modes ----------
  toggleBuild(type) {
    const g = this.game;
    if (!g || !g.started || !this.me.alive || !g.buildingAvailable(type)) return;
    if (!g.buildingUnlocked(this.me, type)) {
      this.notice(`Research ${TECH_BY_ID[BUILDINGS[type].tech].name} to unlock the ${BUILDINGS[type].name.toLowerCase()}.`, true);
      return;
    }
    if (this.r.mode && this.r.mode.kind === 'build' && this.r.mode.type === type) { this.r.mode = null; }
    else {
      this.r.mode = { kind: 'build', type };
      const cost = g.buildCost(this.me, type);
      if (this.me.gold < cost) this.notice(`${BUILDINGS[type].name} costs ${fmtMoney(cost)}. You have ${fmtMoney(this.me.gold)}.`, true);
      else this.notice(`Click your land to place a ${BUILDINGS[type].name.toLowerCase()}. Esc to cancel.`);
    }
    this.updateHud(true);
  }

  toggleMissile() {
    const g = this.game;
    if (!g || !g.started || !this.me.alive) return;
    if (this.r.mode && this.r.mode.kind === 'missile') { this.r.mode = null; this.updateHud(true); return; }
    if (!this.me.counts.silo) { this.notice('Build a missile silo first.', true); return; }
    this.r.mode = { kind: 'missile' };
    this.notice('Click a target. Air defenses near it may shoot the missile down.');
    this.updateHud(true);
  }

  // ---------- map actions ----------
  clickTile(tile, shift) {
    this.closeCtx();
    const g = this.game;
    if (!g || tile < 0) return;
    const mode = this.r.mode;
    if (mode && mode.kind === 'spawn') { this.spawn(tile); return; }
    if (!g.started || !this.me.alive) return;
    if (mode && mode.kind === 'build') {
      const res = this.cmd('build', { type: mode.type, tile });
      if (!shift && !(res && res.bad)) this.r.mode = null;
      return;
    }
    if (mode && mode.kind === 'missile') {
      const res = this.cmd('missile', { tile });
      if (!(res && res.bad)) this.r.mode = null;
      return;
    }
    this.attackAt(tile);
  }

  attackAt(tile) {
    if (this.game.isWater(tile)) return;
    this.cmd('attack', { tile, ratio: this.ratio });
  }

  // ---------- context menu ----------
  openCtx(tile, sx, sy) {
    const g = this.game;
    if (!g || !g.started || tile < 0) return;
    if (this.r.mode) { this.r.mode = null; this.updateHud(true); return; }
    const me = this.me, my = this.myId, o = g.owner[tile], water = g.isWater(tile);
    const ter = TERRAIN[g.map.terrain[tile]];
    const items = [];
    let title, sub;
    if (water) { title = 'Open sea'; sub = ter.name; }
    else if (o) { const p = g.players[o]; title = o === my ? `${p.name} (you)` : p.name; sub = `${ter.name}, ${fmt(p.troops)} troops`; }
    else { title = 'Unclaimed land'; sub = ter.name; }

    // A right-click on the sea near someone's coast offers to land a fleet there.
    if (me.alive && water) {
      const coast = g.nearestForeignCoast(my, tile);
      if (coast >= 0) {
        const co = g.owner[coast], amt = Math.floor(me.troops * this.ratio);
        items.push({ label: `Send fleet to ${co ? g.players[co].name : 'unclaimed land'} with ${fmt(amt)} troops`,
          act: () => this.cmd('fleet', { tile: coast, ratio: this.ratio }) });
      }
    }
    if (me.alive && !water) {
      if (o === my) {
        for (const type of BUILD_ORDER) {
          if (!g.buildingAvailable(type)) continue;
          const err = g.canBuild(me, type, tile);
          items.push({ label: `Build ${BUILDINGS[type].name.toLowerCase()}`, cost: fmtMoney(g.buildCost(me, type)), disabled: !!err, title: err || BUILDINGS[type].desc,
            act: () => this.cmd('build', { type, tile }) });
        }
      } else if (!g.isAllied(my, o)) {
        const amt = Math.floor(me.troops * this.ratio);
        const land = g.landReachable(my, tile);
        if (land) items.push({ label: `Attack with ${fmt(amt)} troops`, act: () => this.attackAt(tile) });
        // Coastal land can always be reached by sea as well.
        if (!land || g.nearCoast(tile, 3)) {
          items.push({ label: `Send fleet with ${fmt(amt)} troops`, title: 'Your fleet lands on the nearest stretch of their coast.',
            act: () => this.cmd('fleet', { tile, ratio: this.ratio }) });
        }
        if (me.counts.silo) {
          const cost = g.missileCost(me);
          const err = !g.readySilo(me) ? 'Every silo is reloading.' : me.gold < cost ? `Needs ${fmtMoney(cost)}.` : '';
          items.push({ label: 'Launch missile here', cost: fmtMoney(cost), disabled: !!err, title: err, danger: true,
            act: () => this.cmd('missile', { tile }) });
        }
      }
      if (o && o !== my) {
        const p = g.players[o];
        items.push({ sep: true });
        if (g.isAllied(my, o)) {
          const amt = Math.floor(me.troops * 0.25);
          items.push({ label: `Send ${fmt(amt)} troops`, act: () => this.cmd('troops', { to: o, ratio: 0.25 }) });
          items.push({ label: 'Break alliance', danger: true, act: () => this.cmd('unally', { to: o }) });
        } else {
          if (!p.tribe) items.push({ label: 'Propose alliance', act: () => this.cmd('ally', { to: o }) });
        }
        const gold = Math.floor(me.gold * 0.25);
        items.push({ label: `Send ${fmtMoney(gold)}`, title: 'Gifts improve how they feel about you.', disabled: gold < 1,
          act: () => this.cmd('gold', { to: o, ratio: 0.25 }) });
        if (p.human) sub += ', a player';
        else { const [rl] = relLabel(g.getRel(o, my)); sub += `, ${rl.toLowerCase()} toward you`; }
      }
    }
    if (!items.length) return;

    const el = $('ctx');
    el.innerHTML = `<div class="ctx-head"><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
    for (const it of items) {
      if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; el.appendChild(s); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !!it.disabled;
      if (it.danger) b.className = 'danger';
      if (it.title) b.title = it.title;
      b.innerHTML = `<span>${esc(it.label)}</span>${it.cost ? `<span class="c">${esc(it.cost)}</span>` : ''}`;
      b.addEventListener('click', () => { this.closeCtx(); it.act(); this.updateHud(true); });
      el.appendChild(b);
    }
    el.hidden = false;
    $('tooltip').hidden = true;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${clamp(sx + 6, 8, window.innerWidth - w - 8)}px`;
    el.style.top = `${clamp(sy + 6, 8, window.innerHeight - h - 8)}px`;
  }

  closeCtx() { $('ctx').hidden = true; }

  // ---------- tooltip ----------
  updateTooltip() {
    const tt = $('tooltip');
    const g = this.game;
    if (!g || !this.mouse.inside || !$('ctx').hidden || this.modalOpen) { tt.hidden = true; return; }
    const tile = this.r.screenToTile(this.mouse.x, this.mouse.y);
    this.r.hoverTile = tile;
    if (tile < 0 || g.isWater(tile)) { tt.hidden = true; return; }
    const o = g.owner[tile];
    const ter = TERRAIN[g.map.terrain[tile]];
    const rows = [];
    let head;
    if (o) {
      const p = g.players[o];
      head = `<span class="dot" style="background:${rgbCss(p.color)}"></span>${esc(p.name)}${o === this.myId ? ' (you)' : p.human ? ' (player)' : ''}`;
      rows.push(['Troops', fmt(p.troops)]);
      rows.push(['People', fmt(p.pop)]);
      rows.push(['Land', `${(g.landShare(p) * 100).toFixed(1)}%`]);
      if (p.tribe) rows.push(['Stores', `<span class="rel-good">${fmtMoney(p.gold)}</span>`]);
      else if (p.ideology) rows.push(['Ideology', IDEOLOGY_BY_ID[p.ideology].name]);
      if (g.politics) {
        const c = g.control[tile];
        rows.push(['Control here', `<span class="${c < 50 ? 'rel-bad' : ''}">${c}%${c < 50 ? (c <= 20 ? ' (occupied)' : ' (restless)') : ''}</span>`]);
      }
      if (o !== this.myId) {
        if (g.isAllied(this.myId, o)) rows.push(['Status', '<span class="rel-good">Your ally</span>']);
        else if (!p.human) {
          const v = g.getRel(o, this.myId);
          const [lbl, cls] = relLabel(v);
          rows.push(['Toward you', `<span class="${cls}">${lbl}</span>`]);
        }
      }
    } else {
      head = g.fallout[tile] ? 'Scorched land' : 'Unclaimed land';
    }
    rows.push(['Terrain', `${ter.name}${ter.def !== 1 ? ` (defense ×${ter.def})` : ''}`]);
    const bi = g.bldAt[tile];
    if (bi >= 0) rows.push(['Building', BUILDINGS[g.buildings[bi].type].name]);

    let hint = '';
    const mode = this.r.mode, me = this.me;
    if (mode && mode.kind === 'spawn') hint = g.canSpawnAt(tile) ? 'Click to found your nation here' : 'Already claimed';
    else if (mode && mode.kind === 'build') hint = g.canBuild(me, mode.type, tile) || `Click to build (${fmtMoney(g.buildCost(me, mode.type))})`;
    else if (mode && mode.kind === 'missile') hint = 'Click to launch';
    else if (me.alive && g.started) {
      if (o === this.myId) hint = 'Right-click to build here';
      else if (g.isAllied(this.myId, o)) hint = 'Right-click to reinforce or send money';
      else if (o === 0 && g.fallout[tile]) hint = 'Scorched. Wait for it to clear.';
      else hint = (g.neighbors[this.myId].has(o) ? (o ? 'Click to attack' : 'Click to expand toward here') : 'Click to send a fleet') + ', right-click for more';
      if (o && g.players[o].tribe && !g.isFriendly(this.myId, o)) hint = `Absorb this tribe to take its stores. ${hint}`;
    }
    tt.innerHTML = `<div class="tt-head">${head}</div>${rows.map(([k, v]) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`).join('')}${hint ? `<div class="tt-hint">${esc(hint)}</div>` : ''}`;
    tt.hidden = false;
    const w = tt.offsetWidth, h = tt.offsetHeight;
    let x = this.mouse.x + 18, y = this.mouse.y + 18;
    if (x + w > window.innerWidth - 8) x = this.mouse.x - w - 12;
    if (y + h > window.innerHeight - 8) y = this.mouse.y - h - 12;
    tt.style.left = `${x}px`;
    tt.style.top = `${y}px`;
  }

  // ---------- input ----------
  initInput() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.r.map) return;
      const f = Math.exp(-clamp(e.deltaY, -120, 120) * 0.0022);
      this.r.zoomAt(e.clientX, e.clientY, f, true);
      this.closeCtx();
    }, { passive: false });

    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        const ctxOpen = !$('ctx').hidden;
        if (ctxOpen) this.closeCtx();
        this.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false, long: ctxOpen, type: e.pointerType, shift: e.shiftKey };
        clearTimeout(this.longTimer);
        if (e.pointerType !== 'mouse') {
          this.longTimer = setTimeout(() => {
            if (this.down && !this.down.moved) {
              this.down.long = true;
              this.openCtx(this.r.screenToTile(this.down.x, this.down.y), this.down.x, this.down.y);
            }
          }, 480);
        }
      } else if (this.pointers.size === 2) {
        clearTimeout(this.longTimer);
        if (this.down) this.down.moved = true;
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
      }
    });

    cv.addEventListener('pointermove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.inside = e.pointerType === 'mouse';
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        this.r.hoverTile = this.r.screenToTile(e.clientX, e.clientY);
        if (e.pointerType === 'mouse') this.updateTooltip();
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch.d > 0) this.r.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / this.pinch.d);
        this.pinch.d = d;
        this.r.pan(dx / 2, dy / 2);
        return;
      }
      if (this.down && !this.down.moved && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) {
        this.down.moved = true;
        clearTimeout(this.longTimer);
        cv.classList.add('dragging');
        this.closeCtx();
        $('tooltip').hidden = true;
      }
      if (this.down && this.down.moved) this.r.pan(dx, dy);
      this.r.hoverTile = this.r.screenToTile(e.clientX, e.clientY);
    });

    const end = (e) => {
      const had = this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!had || this.pointers.size > 0) return;
      clearTimeout(this.longTimer);
      cv.classList.remove('dragging');
      const d = this.down;
      this.down = null;
      if (!d || d.moved || d.long || e.type === 'pointercancel') return;
      const tile = this.r.screenToTile(e.clientX, e.clientY);
      if (d.button === 2) this.openCtx(tile, e.clientX, e.clientY);
      else if (d.button === 0) this.clickTile(tile, d.shift);
      if (e.pointerType !== 'mouse') this.r.hoverTile = tile;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') { this.mouse.inside = false; $('tooltip').hidden = true; }
    });

    document.addEventListener('pointerdown', (e) => {
      if (!$('ctx').hidden && !e.target.closest('#ctx') && e.target !== cv) this.closeCtx();
    });

    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, select, textarea')) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (this.modalOpen) { this.closeModal(); return; }
        if (!$('ctx').hidden) { this.closeCtx(); return; }
        if (this.r.mode && this.r.mode.kind !== 'spawn') { this.r.mode = null; this.updateHud(true); return; }
        if (this.game && this.game.started && !this.r.mode) this.showGameMenu();
        return;
      }
      if (this.modalOpen) return;
      const g = this.game;
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
        return;
      }
      if (!g) return;
      if (k === ' ') {
        e.preventDefault();
        if (this.speed === 0) this.speed = this.prevSpeed || 1;
        else { this.prevSpeed = this.speed; this.speed = 0; }
        this.setSpeedButtons();
        return;
      }
      if (k === 'q') { this.ratio = Math.max(0.01, Math.round(this.ratio * 100 - 10) / 100); this.updateRatio(); return; }
      if (k === 'e') { this.ratio = Math.min(1, Math.round(this.ratio * 100 + 10) / 100); this.updateRatio(); return; }
      if (k === 'h' && g.started) { const L = this.me.label; this.r.centerOn(L.x, L.y, Math.max(this.r.cam.zoom, 3)); return; }
      if (k === 'm') { this.toggleMissile(); return; }
      if (k === 't' && g.started) { this.openNation('tech'); return; }
      if (k === 'g' && g.started) { this.openNation('gov'); return; }
      if (k === 'p' && g.started) { this.openNation('dipl'); return; }
      const bt = BUILD_ORDER.find((t) => BUILDINGS[t].key === k);
      if (bt) this.toggleBuild(bt);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ---------- modals ----------
  openModal(html, opts = {}) {
    $('modal-body').innerHTML = html;
    $('modal').querySelector('.modal-card').classList.toggle('wide', !!opts.wide);
    $('modal').hidden = false;
    this.modalOpen = true;
    this.closeCtx();
    $('tooltip').hidden = true;
    const card = $('modal').querySelector('.modal-card');
    card.scrollTop = 0;
    for (const b of $('modal-body').querySelectorAll('[data-close]')) b.addEventListener('click', () => this.closeModal());
    if (opts.onClick) $('modal-body').addEventListener('click', opts.onClick, { once: false });
    if (opts.onInput) $('modal-body').addEventListener('input', opts.onInput);
    const first = $('modal-body').querySelector('button.primary');
    if (first) first.focus({ preventScroll: true });
    card.scrollTop = 0;
  }

  closeModal() {
    $('modal').hidden = true;
    this.modalOpen = false;
    const body = $('modal-body');
    const fresh = body.cloneNode(false);
    body.replaceWith(fresh);
  }

  showHelp() {
    const tpl = $('help-tpl').content.cloneNode(true);
    const wrap = document.createElement('div');
    wrap.appendChild(tpl);
    const ul = wrap.querySelector('.bl');
    const color = this.game ? this.me.color : hexToRgb(this.color);
    for (const t of BUILD_ORDER) {
      const d = BUILDINGS[t];
      const li = document.createElement('li');
      const needs = d.tech ? `, needs ${TECH_BY_ID[d.tech].name}` : '';
      const only = d.politics ? ' Realistic only.' : '';
      li.innerHTML = `<canvas width="52" height="52" style="width:26px;height:26px" data-t="${t}"></canvas><span><b>${d.name}</b> (${fmtMoney(d.base)}, key ${d.key}${needs}). ${d.desc}${only}</span>`;
      ul.appendChild(li);
    }
    this.openModal(wrap.innerHTML);
    for (const cv of $('modal-body').querySelectorAll('canvas[data-t]')) {
      drawBuildingIcon(cv.getContext('2d'), cv.dataset.t, 26, 26, 36, color, false);
    }
  }

  openNation(tab) {
    const g = this.game;
    if (!g || !g.started) return;
    this.nationTab = tab === 'gov' ? 'gov' : tab === 'dipl' ? 'dipl' : 'tech';
    this.nationMsg = '';
    this.openModal(this.nationHtml(), { wide: true, onClick: (e) => this.onNationClick(e), onInput: (e) => this.onNationInput(e) });
  }

  renderNation() {
    const body = $('modal-body');
    const scroller = body.querySelector('.tree');
    const sx = scroller ? scroller.scrollLeft : 0;
    body.innerHTML = this.nationHtml();
    const nt = body.querySelector('.tree');
    if (nt) nt.scrollLeft = sx;
  }

  onNationClick(e) {
    const g = this.game, me = this.me;
    if (e.target.closest('[data-close]')) { this.closeModal(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { this.nationTab = tab.dataset.tab; this.nationMsg = ''; this.renderNation(); return; }
    const tech = e.target.closest('[data-tech]');
    if (tech) {
      const res = me.alive ? this.cmd('research', { id: tech.dataset.tech }, true) : { msg: 'Your nation has fallen.', bad: true };
      this.nationMsg = res ? res.msg : 'Order sent.';
      this.nationMsgBad = !!(res && res.bad);
      this.renderNation();
      return;
    }
    const dip = e.target.closest('[data-dip]');
    if (dip && me.alive) {
      const res = this.cmd(dip.dataset.dip, dip.dataset.to ? { to: Number(dip.dataset.to) } : {}, true);
      this.nationMsg = res ? (res.msg || 'Done.') : 'Order sent.';
      this.nationMsgBad = !!(res && res.bad);
      this.renderNation();
      return;
    }
    const preset = e.target.closest('[data-focus]');
    if (preset && me.alive) {
      const v = Number(preset.dataset.focus);
      this.cmd('focus', { v }, true);
      me.focus = v;
      const r = $('modal-body').querySelector('#focus-range');
      if (r) r.value = Math.round(v * 100);
      this.updatePriorityReadout(v);
      return;
    }
    const ideo = e.target.closest('[data-ideo]');
    if (ideo && me.alive) {
      const res = this.cmd('ideology', { id: ideo.dataset.ideo }, true);
      this.nationMsg = res ? res.msg : 'Order sent.';
      this.nationMsgBad = !!(res && res.bad);
      this.renderNation();
      return;
    }
    const doc = e.target.closest('[data-doc]');
    if (doc && me.alive) {
      const res = this.cmd('doctrine', { id: doc.dataset.doc }, true);
      this.nationMsg = res ? res.msg : 'Order sent.';
      this.nationMsgBad = !!(res && res.bad);
      this.renderNation();
      return;
    }
    const act = e.target.closest('[data-gov]');
    if (act && me.alive) {
      const res = act.dataset.gov === 'martial' ? this.cmd('martial', { on: !me.martial }, true) : this.cmd('celebrate', {}, true);
      this.nationMsg = !res ? 'Order sent.' : res.bad ? res.msg : act.dataset.gov === 'celebrate' ? 'Celebrations begin across the land.' : me.martial ? 'Martial law declared.' : 'Martial law lifted.';
      this.nationMsgBad = !!(res && res.bad);
      this.renderNation();
    }
  }

  onNationInput(e) {
    const me = this.me;
    if (!me || !me.alive) return;
    if (e.target.id === 'sci-range') {
      const v = Number(e.target.value) / 100;
      this.cmd('science', { v }, true);
      me.science = v;
      this.updateBudgetReadout(v);
    } else if (e.target.id === 'focus-range') {
      const v = Number(e.target.value) / 100;
      this.cmd('focus', { v }, true);
      me.focus = v;
      this.updatePriorityReadout(v);
    }
  }

  // Research per second if the budget were v, from the current rate and what money buys.
  researchAt(v) {
    const g = this.game, me = this.me;
    const mult = (1 + me.mods.research) * g.stabFactor(me) * g.mode.research;
    const base = Math.max(0, me.rpRate - (me.researchSpend || 0) / RP_PRICE * mult);
    return base + (me.grossIncome || 0) * v / RP_PRICE * mult;
  }

  budgetText(v) {
    const me = this.me;
    const spend = (me.grossIncome || 0) * v * 60;
    return `${Math.round(v * 100)}% of income, ${fmtMoney(spend)}/min. Research about ${this.researchAt(v).toFixed(1)} per second.`;
  }

  updateBudgetReadout(v) {
    const el = $('modal-body').querySelector('#sci-readout');
    if (el) el.textContent = this.budgetText(v);
  }

  budgetHtml() {
    const me = this.me, v = me.science;
    return `<div class="budget">
      <label for="sci-range"><b>Research budget</b><span>The share of your income spent on research. More money means faster technology but less to build with. Nothing is spent while there's nothing to research.</span></label>
      <input type="range" id="sci-range" min="0" max="80" value="${Math.round(v * 100)}">
      <p id="sci-readout" class="budget-out">${esc(this.budgetText(v))}</p>
    </div>`;
  }

  priorityText(v) {
    const rec = 1.3 - 0.6 * v, inc = 0.4 + 1.2 * v;
    const pct = (x) => `${x >= 1 ? '+' : '−'}${Math.round(Math.abs(x - 1) * 100)}%`;
    const burden = Math.abs(v - 0.5) * 20;
    let t = Math.abs(v - 0.5) < 0.01 ? 'Recruiting and income at their normal rate.' : `Recruiting ${pct(rec)}, income ${pct(inc)}.`;
    if (this.game.politics && burden >= 0.5) t += ` Stability −${burden.toFixed(0)} from the strain.`;
    return t;
  }

  updatePriorityReadout(v) {
    const el = $('modal-body').querySelector('#focus-readout');
    if (el) el.textContent = this.priorityText(v);
    for (const b of $('modal-body').querySelectorAll('[data-focus]')) b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.focus) - v) < 0.01));
  }

  // National priority: where your people's effort goes, armies or the economy.
  priorityHtml() {
    const v = this.me.focus;
    const preset = (val, label) => `<button type="button" class="ghost" data-focus="${val}" aria-pressed="${Math.abs(val - v) < 0.01}">${label}</button>`;
    return `<section class="priority">
      <h3>National priority</h3>
      <p class="ideo-lede">Where your people's effort goes. Toward the army, troops refill faster; toward the economy, your treasury fills faster.${this.game.politics ? ' Leaning far either way strains your people and costs stability.' : ''}</p>
      <div class="priority-row">
        <span>Army</span>
        <input type="range" id="focus-range" min="0" max="100" value="${Math.round(v * 100)}" aria-label="National priority, army to economy">
        <span>Economy</span>
      </div>
      <p id="focus-readout" class="budget-out">${esc(this.priorityText(v))}</p>
      <div class="priority-presets">${preset(0.15, 'War footing')}${preset(0.5, 'Balanced')}${preset(0.85, 'Prosperity')}</div>
    </section>`;
  }

  nationHtml() {
    const g = this.game;
    const tab = (id, label) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.nationTab === id}">${label}</button>`;
    const tabs = `<div class="tabs" role="tablist">${tab('tech', 'Technology')}${tab('gov', 'Government')}${tab('dipl', 'Diplomacy')}</div>`;
    const msg = this.nationMsg ? `<p class="nation-msg${this.nationMsgBad ? ' bad' : ''}" role="status">${esc(this.nationMsg)}</p>` : '';
    const content = this.nationTab === 'gov' ? this.govHtml() : this.nationTab === 'dipl' ? this.diplHtml() : this.techHtml();
    const title = { gov: 'Government', dipl: 'Diplomacy', tech: 'Technology' }[this.nationTab];
    return `<div class="nation-top"><h2 id="modal-title">${title}</h2>${tabs}</div>
      ${content}${msg}
      <div class="modal-actions"><button type="button" class="primary" data-close>Back to the map</button></div>`;
  }

  techHtml() {
    const g = this.game, me = this.me, era = eraIndex(g.year);
    const cur = me.research ? TECH_BY_ID[me.research] : null;
    const rate = me.rpRate;
    const eta = (t) => {
      const left = g.techCost(me, t) - (me.progress[t.id] || 0);
      return rate > 0 ? Math.ceil(left / rate) : Infinity;
    };
    const lede = `It is ${g.year}, the ${ERAS[era].name.toLowerCase()} era. You produce ${rate.toFixed(1)} research per second from your people, universities and budget.` +
      (cur ? ` Researching ${cur.name}, done in about ${fmtDuration(eta(cur))}.` : ' Pick a technology to research.') +
      (g.mode.timeGate ? ' Technologies marked with a later year open up as time passes.' : '');
    let cols = '';
    for (let e = 0; e < ERAS.length; e++) {
      const techs = TECHS.filter((t) => t.era === e);
      let cards = '';
      for (const t of techs) {
        const st = g.techState(me, t);
        const isCur = me.research === t.id;
        const prog = me.progress[t.id] || 0;
        let foot;
        if (st === 'done') foot = 'Known';
        else if (isCur) foot = `Researching, ${Math.floor(prog / g.techCost(me, t) * 100)}%`;
        else if (st === 'avail') foot = `${fmt(g.techCost(me, t))} research, about ${fmtDuration(eta(t))}`;
        else if (st === 'year') foot = `Opens in ${t.year}`;
        else foot = `Needs ${t.req.filter((r) => !me.techs.has(r)).map((r) => TECH_BY_ID[r].name).join(', ')}`;
        const bar = (isCur || (prog > 0 && st !== 'done')) ? `<span class="tp"><i style="width:${Math.min(100, prog / g.techCost(me, t) * 100)}%"></i></span>` : '';
        cards += `<button type="button" class="tech s-${st}${isCur ? ' cur' : ''}" data-tech="${t.id}"${st === 'done' ? ' disabled' : ''} aria-pressed="${isCur}">
          <span class="th"><span class="tn">${esc(t.name)}</span>${g.mode.timeGate ? `<span class="ty">${t.year}</span>` : ''}</span>
          <span class="td">${esc(t.desc)}${!g.politics && t.kind === 'gov' ? ' Stability and administration don\'t apply in Blitz.' : ''}</span>
          <span class="tf">${esc(foot)}</span>${bar}
        </button>`;
      }
      const span = e < ERAS.length - 1 ? `${ERAS[e].from}–${ERAS[e + 1].from - 1}` : `${ERAS[e].from} on`;
      cols += `<section class="era${e === era ? ' now' : ''}${g.mode.timeGate && e > era ? ' future' : ''}"><h3>${ERAS[e].name} <span>${span}</span></h3>${cards}</section>`;
    }
    return `${this.budgetHtml()}<p class="result-lede">${esc(lede)}</p><div class="tree">${cols}</div>`;
  }

  // Diplomacy: every nation, its stance toward you, and alliances.
  diplHtml() {
    const g = this.game, my = this.myId;
    const nations = g.players.filter((p) => p && p.alive && p.spawned && !p.tribe && p.id !== my).sort((a, b) => b.tiles - a.tiles);
    const atWar = new Set();
    for (const a of g.attacks) {
      if (a.dead) continue;
      if (a.attacker === my) atWar.add(a.target);
      if (a.target === my) atWar.add(a.attacker);
    }
    const allies = nations.filter((p) => g.isAllied(my, p.id)).length;
    const rows = nations.map((p) => {
      let st, cls, acts;
      if (g.isAllied(my, p.id)) {
        st = 'Ally'; cls = 'st-ally';
        acts = `<button type="button" class="ghost" data-dip="unally" data-to="${p.id}" title="Others will trust you less, and your land is easier to take for a while.">Break alliance</button>`;
      } else {
        st = atWar.has(p.id) ? 'At war' : 'Neutral'; cls = atWar.has(p.id) ? 'st-war' : 'st-neutral';
        acts = `<button type="button" class="ghost" data-dip="ally" data-to="${p.id}">Propose alliance</button>`;
      }
      const feel = p.human ? 'Player' : relLabel(g.getRel(p.id, my))[0];
      const ideo = p.ideology ? IDEOLOGY_BY_ID[p.ideology].name : '<span class="st-neutral">None yet</span>';
      return `<tr><td><span class="dot" style="background:${rgbCss(p.color)}"></span>${esc(p.name)}</td><td class="num">${(g.landShare(p) * 100).toFixed(1)}%</td><td>${ideo}</td><td class="${cls}">${st}</td><td>${feel}</td><td><div class="dipl-actions">${acts}</div></td></tr>`;
    }).join('');
    const lede = `${nations.length} ${nations.length === 1 ? 'nation remains' : 'nations remain'}${allies ? `, ${allies} of them allied with you` : ''}. Allies can't attack each other, and nations that like you are more willing to ally. Gifts of money warm them; attacking them, or breaking an alliance, does the opposite.`;
    return `<p class="dipl-progress">${esc(lede)}</p>
      <table class="dipl-table"><thead><tr><th>Nation</th><th style="text-align:right">Land</th><th>Ideology</th><th>Status</th><th>Feeling toward you</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6">No other nations remain.</td></tr>'}</tbody></table>`;
  }

  govHtml() {
    if (!this.game.politics) {
      return `${this.priorityHtml()}<p class="ideo-note">Blitz has no stability or administration, so ideology effects on them do nothing here. Everything else applies.</p>${this.ideologyHtml()}`;
    }
    return this.stateHtml() + this.priorityHtml() + this.ideologyHtml();
  }

  ideologyCard(I, current, action) {
    const { pros, cons } = fxSplit(I.fx);
    const fx = pros.map((x) => `<li class="pro">${esc(x)}</li>`).join('') + cons.map((x) => `<li class="con">${esc(x)}</li>`).join('') +
      (I.balanced ? '<li class="even">No drawbacks</li>' : '');
    return `<article class="ideo-card${current ? ' on' : ''}">
      <h4>${esc(I.name)}</h4><p class="motto">${esc(I.motto)}</p>
      <ul class="fx">${fx}</ul>
      ${action || ''}
    </article>`;
  }

  // Ideology: choose one, then buy its doctrines. The tree is drawn as four tiers, with the
  // first doctrine opening two branches that meet again at the capstone.
  ideologyHtml() {
    const g = this.game, me = this.me;
    const cur = me.ideology ? IDEOLOGY_BY_ID[me.ideology] : null;
    if (!cur) {
      const cards = IDEOLOGIES.map((I) => this.ideologyCard(I, false,
        `<button type="button" class="ghost" data-ideo="${I.id}">Adopt ${esc(I.name)}</button>`)).join('');
      return `<section class="ideo">
        <h3>Ideology</h3>
        <p class="ideo-lede">Choose what your nation believes. Each ideology has strengths and weaknesses, and a tree of doctrines you can buy to strengthen it. Moderation has no drawbacks but smaller bonuses.</p>
        <div class="ideo-grid">${cards}</div>
      </section>`;
    }
    const place = ['root', 'up', 'down', 'mid-a', 'mid-b', 'cap'];
    const nodes = cur.tree.map((d, k) => {
      const st = g.doctrineState(me, d), cost = g.doctrineCost(d);
      const fx = fxSplit(d.fx), text = fx.pros.concat(fx.cons).join('. ') + '.';
      let foot;
      if (st === 'done') foot = 'Adopted';
      else if (st === 'req') foot = `Needs ${d.req.filter((r) => !me.doctrines.has(r)).map((r) => DOCTRINE_BY_ID[r].name).join(' and ')}`;
      else foot = fmtMoney(cost);
      const poor = st === 'avail' && me.gold < cost;
      return `<button type="button" class="dn ${place[k]} s-${st}${poor ? ' poor' : ''}" data-doc="${d.key}"${st !== 'avail' ? ' aria-disabled="true"' : ''}>
        <span class="dn-name">${esc(d.name)}</span><span class="dn-fx">${esc(text)}</span><span class="dn-foot">${esc(foot)}</span>
      </button>`;
    }).join('');
    const since = g.time - me.ideologyAt;
    const others = IDEOLOGIES.filter((I) => I.id !== cur.id).map((I) => this.ideologyCard(I, false,
      `<button type="button" class="ghost" data-ideo="${I.id}"${since < 60 ? ' disabled' : ''}>Switch to ${esc(I.name)}</button>`)).join('');
    const owned = me.doctrines.size;
    return `<section class="ideo">
      <h3>Ideology</h3>
      <div class="ideo-now">
        ${this.ideologyCard(cur, true, '')}
        <div class="ideo-tree">
          <p class="ideo-lede">Doctrines strengthen ${esc(cur.name)}. Buy the first to open both branches; the last needs both. You have ${owned} of ${cur.tree.length}.</p>
          <div class="doctrines">${nodes}</div>
        </div>
      </div>
      <details class="ideo-change">
        <summary>Change ideology</summary>
        <p class="ideo-lede">Changing loses every doctrine you've bought${g.politics ? ` and costs ${IDEOLOGY_CHANGE_SHOCK} stability for a while` : ''}.${since < 60 ? ` You can change again in ${Math.ceil(60 - since)}s.` : ''}</p>
        <div class="ideo-grid">${others}</div>
      </details>
    </section>`;
  }

  stateHtml() {
    const g = this.game, me = this.me;
    const s = Math.round(me.stability), tg = Math.round(me.stabTarget);
    const sf = g.stabFactor(me);
    const label = s >= 70 ? 'Prosperous' : s >= 50 ? 'Orderly' : s >= REVOLT_BELOW + 10 ? 'Uneasy' : s >= REVOLT_BELOW ? 'Restless' : 'In revolt';
    let occupied = 0;
    for (let t = 0; t < g.N; t++) if (g.owner[t] === this.myId && g.control[t] < 50) occupied++;
    const rows = me.stabFactors.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(v % 1 && Math.abs(v) < 10 ? 1 : 0)}</td></tr>`).join('');
    const cc = g.celebrateCost(me);
    const cdLeft = Math.max(0, Math.ceil((me.celebrateReadyAt - g.tick) / TPS));
    const adminPct = Math.round(me.tiles / Math.max(1, me.adminCap) * 100);
    return `<div class="gov">
      <section class="gov-card">
        <div class="gov-stab"><b class="${s < REVOLT_BELOW ? 'bad' : s < 45 ? 'warn' : ''}">${s}</b><span>${label}<br><small>${tg === s ? 'Holding steady' : `${tg > s ? 'Rising' : 'Falling'} toward ${tg}`}</small></span></div>
        <div class="goal stab big" aria-hidden="true"><div style="width:${clamp(me.stability, 0, 100)}%"></div><i></i></div>
        <p>Stability multiplies income, recruiting and research by <b>×${sf.toFixed(2)}</b>. Below <b>${REVOLT_BELOW}</b>, restless regions can break away as a new nation.</p>
        <table class="factors"><caption>What sets your stability</caption>${rows}<tr class="sum"><th scope="row">Target</th><td>${tg}</td></tr></table>
      </section>
      <section class="gov-card">
        <h3>Administration</h3>
        <p>You govern <b>${fmt(me.tiles)}</b> tiles with room for <b>${fmt(me.adminCap)}</b> (${adminPct}%). Beyond that, every extra tile costs stability. Cities and courthouses add room and bring nearby land under full control.</p>
        <p>Average control <b>${Math.round(me.avgControl)}%</b>. <b>${fmt(occupied)}</b> tiles are occupied or restless and show hatching on the map. Conquered land integrates slowly; land far from your capital, cities and courthouses never settles fully.</p>
        <h3>Policies</h3>
        <div class="policy">
          <div><b>Martial law</b><p>+15 stability. Income −25% and population growth −30% while it lasts.</p></div>
          <button type="button" class="${me.martial ? 'primary' : 'ghost'}" data-gov="martial">${me.martial ? 'Lift martial law' : 'Declare martial law'}</button>
        </div>
        <div class="policy">
          <div><b>Celebration</b><p>+15 stability, fading over a minute. Costs ${fmtMoney(cc)}.${cdLeft ? ` Ready again in ${cdLeft}s.` : ''}</p></div>
          <button type="button" class="ghost" data-gov="celebrate"${cdLeft || me.gold < cc ? ' disabled' : ''}>Hold a celebration</button>
        </div>
        <p class="fine">The age ends in ${g.mode.endYear}. If nobody holds 70% of the land by then, the largest nation wins.</p>
      </section>
    </div>`;
  }

  showGameMenu() {
    if (!this.game) return;
    const mp = this.game.multiplayer;
    const q = this.r.quality;
    this.openModal(`<h2 id="modal-title">${mp ? 'Menu' : 'Paused'}</h2>
      <p class="result-lede">${mp ? 'The match keeps running while this menu is open.' : 'The world waits while this menu is open.'}</p>
      <div class="field"><span>Graphics</span>
        <div class="segmented two">
          <label><input type="radio" name="gfx2" value="high"${q === 'high' ? ' checked' : ''}><span>High</span></label>
          <label><input type="radio" name="gfx2" value="low"${q === 'low' ? ' checked' : ''}><span>Low, for older devices</span></label>
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost" data-act="help">How to play</button>
        <button type="button" class="ghost" data-act="menu">${mp ? 'Leave match' : 'Quit to main menu'}</button>
        <button type="button" class="primary" data-close>Resume</button>
      </div>`, {
      onClick: (e) => {
        const gq = e.target.closest('input[name=gfx2]');
        if (gq) { this.setGraphics(gq.value); return; }
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.dataset.act === 'help') { this.closeModal(); this.showHelp(); }
        if (b.dataset.act === 'menu') this.backToMenu();
      },
    });
  }

  // ---------- tutorial ----------
  startTutorial() {
    if (this.net) { this.mpStatus('Leave the lobby before starting the tutorial.', true); return; }
    const map = generateMap({ seed: 4242, type: 'continents', size: 'small' });
    this.map = map;
    this.mapKey = '';
    const game = new Game(map, { difficulty: 'easy', mode: 'realistic' });
    game.setupPlayers({ playerName: this.playerName(), playerColor: hexToRgb(this.color), numAI: 5, difficulty: 'easy' });
    // Rivals leave you alone while you learn, and you start with enough for a city.
    for (const p of game.players) if (p && p.ai) p.ai.diff = { ...p.ai.diff, graceVsHuman: 480 };
    game.players[1].tutorialBonus = true;
    this.enterGame(game, 1);
    this.tutorial = new Tutorial(this);
    this.tutorial.begin();
  }

  // ---------- multiplayer menu ----------
  initMultiplayer() {
    const run = async (fn) => {
      if (this.mpBusy) return;
      this.mpBusy = true;
      this.mpStatus(NET_LOCAL ? 'Connecting (same-browser test mode)…' : 'Connecting…');
      try { await fn(); } catch (e) {
        if (this.net) { this.net.leave(); this.net = null; }
        this.leaveLobby(true);
        this.mpStatus(e && e.message ? e.message : 'Could not connect. Check your internet connection and try again.', true);
      } finally { this.mpBusy = false; }
    };
    const fresh = () => { if (this.net) this.net.leave(); this.net = new Net(this); return this.net; };
    $('mp-quick').addEventListener('click', () => run(() => fresh().quickMatch(this.lobbySettings())));
    $('mp-create').addEventListener('click', () => run(() => fresh().host(false, this.lobbySettings())));
    $('mp-join').addEventListener('click', () => run(() => fresh().join($('mp-code').value)));
    $('mp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('mp-join').click(); } });
    $('mp-leave').addEventListener('click', () => { if (this.net) this.net.leave(); this.net = null; this.leaveLobby(); });
    $('mp-copy').addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}?join=${this.net && this.net.code}`;
      try { await navigator.clipboard.writeText(url); this.mpStatus('Invite link copied.'); }
      catch (e) { this.mpStatus(`Share this link: ${url}`); }
    });
    // Hosts push setting changes to everyone in the lobby.
    $('setup').addEventListener('change', () => {
      if (this.net && this.net.role === 'host') setTimeout(() => this.net && this.net.setSettings(this.lobbySettings()), 0);
    });
    const m = /[?&]join=([A-Za-z]{5})/.exec(location.search);
    if (m) { $('mp-code').value = m[1].toUpperCase(); run(() => fresh().join(m[1])); }
  }

  lobbySettings() {
    const o = this.mapOptions();
    return {
      mode: document.querySelector('input[name=mode]:checked').value, type: o.type, size: o.size, seedText: $('opt-seed').value,
      numAI: Number($('opt-ai').value), numTribes: Number($('opt-tribes').value), difficulty: document.querySelector('input[name=diff]:checked').value,
    };
  }

  mpStatus(text, bad) {
    const el = $('mp-status');
    el.textContent = text || '';
    el.classList.toggle('bad', !!bad);
    const ls = $('lobby-status');
    if (!$('lobby').hidden && text) ls.textContent = text;
  }

  showLobby(L, isHost) {
    if (this.game) return;
    $('lobby').hidden = false;
    $('mp-entry').hidden = true;
    $('lobby-code').textContent = L.code;
    $('lobby-players').innerHTML = L.players.map((p) => `<li><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}${p.id === L.hostId ? ' <em>host</em>' : ''}</li>`).join('');
    let status;
    if (isHost) {
      status = L.isPublic
        ? (L.startAt ? `Public match. Starting in ${Math.max(0, Math.ceil((L.startAt - Date.now()) / 1000))}s, or start now.` : 'Public match. Waiting for someone to join; it starts automatically 40s after they do.')
        : 'Share the code or invite link. Start whenever everyone is in.';
      $('btn-start').textContent = `Start match (${L.players.length} ${L.players.length === 1 ? 'player' : 'players'})`;
      $('btn-start').disabled = !!this.genTimer;
    } else {
      status = L.startAt ? `Starting in ${Math.max(0, Math.ceil((L.startAt - Date.now()) / 1000))}s.` : 'Waiting for the host to start the match.';
      $('btn-start').textContent = 'Waiting for the host…';
      $('btn-start').disabled = true;
      this.applyLobbySettings(L.settings);
    }
    $('lobby-status').textContent = status;
    for (const el of $('setup').querySelectorAll('input, select')) {
      if (el.closest('#lobby') || el.name === 'gfx') continue;
      el.disabled = !isHost || el.id === 'opt-name';
    }
    for (const b of $('opt-colors').children) b.disabled = true;
    $('btn-rename').disabled = true;
    $('world-settings').open = true;
  }

  applyLobbySettings(st) {
    const key = JSON.stringify(st);
    if (key === this.appliedLobby) return;
    this.appliedLobby = key;
    const set = (sel) => { const r = document.querySelector(sel); if (r) r.checked = true; };
    set(`input[name=mode][value=${st.mode}]`);
    set(`input[name=diff][value=${st.difficulty}]`);
    $('mode-desc').textContent = MODES[st.mode].desc;
    $('opt-type').value = $('opt-type').querySelector(`option[value="${st.type}"]`) ? st.type : 'continents';
    if (!isFixedMap(st.type)) $('opt-size').value = st.size;
    $('opt-ai').value = st.numAI;
    $('opt-tribes').value = st.numTribes || 0;
    $('opt-tribes-out').textContent = st.numTribes || 0;
    $('opt-ai-out').textContent = st.numAI;
    $('opt-seed').value = st.seedText;
    this.updateMapFields();
    this.updateWorldSummary();
    this.queuePreview(0);
  }

  leaveLobby(silent) {
    $('lobby').hidden = true;
    $('mp-entry').hidden = false;
    this.appliedLobby = null;
    for (const el of $('setup').querySelectorAll('input, select')) el.disabled = false;
    for (const b of $('opt-colors').children) b.disabled = false;
    $('btn-rename').disabled = false;
    $('btn-start').textContent = 'Choose your homeland';
    $('btn-start').disabled = !!this.genTimer;
    if (!silent) this.mpStatus('');
  }

  spawnCountdown(left) {
    const g = this.game;
    if (!g || g.started) { if (g && this.spawnedShown) $('spawn-banner').hidden = true; return; }
    $('spawn-banner').hidden = false;
    $('spawn-banner').querySelector('p').textContent = this.me && this.me.spawned
      ? `Waiting for the other players. The match begins in ${left}s.`
      : `Pick your starting spot on any unclaimed land. The match begins in ${left}s.`;
  }

  netClosed(msg) {
    if (this.net) { this.net.leave(); this.net = null; }
    if (!this.game) { this.leaveLobby(true); this.mpStatus(msg, true); return; }
    this.openModal(`<h2 id="modal-title">Match ended</h2><p class="result-lede">${esc(msg)}</p>
      <div class="modal-actions"><button type="button" class="primary" data-act="menu">Back to the menu</button></div>`, {
      onClick: (e) => { if (e.target.closest('button[data-act]')) this.backToMenu(); },
    });
  }

  showGameOver() {
    const g = this.game, me = this.me;
    const o = g.over || { winner: 0, reason: 'fallen', time: g.time, year: g.year };
    const alive = g.players.filter((p) => p && p.alive).sort((a, b) => b.tiles - a.tiles);
    const rank = me.alive ? alive.indexOf(me) + 1 : '—';
    const won = o.winner === this.myId;
    const leader = o.winner ? g.players[o.winner] : null;
    const title = won ? 'Victory' : o.reason === 'treaty' && me.alive ? 'A general peace' : me.alive ? `The year ${o.year} arrives` : 'Your nation has fallen';
    let lede;
    if (won && o.reason === 'share') lede = `You hold ${Math.round(g.landShare(me) * 100)}% of the world. No one is left to challenge you.`;
    else if (won && o.reason === 'year') lede = `The year ${o.year} arrives and yours is the largest nation on earth, with ${Math.round(g.landShare(me) * 100)}% of the land.`;
    else if (won && o.reason === 'treaty') lede = `A general peace is signed in ${o.year}, and yours is the largest nation on earth, with ${Math.round(g.landShare(me) * 100)}% of the land.`;
    else if (won) lede = 'Every rival is gone or sworn to you. The world is yours.';
    else if (me.alive && leader && o.reason === 'share') lede = `${leader.name} controls ${Math.round(g.landShare(leader) * 100)}% of the world and wins the game.`;
    else if (me.alive && leader && o.reason === 'treaty') lede = `A general peace is signed in ${o.year}. ${leader.name} leaves the table as the largest nation, with ${Math.round(g.landShare(leader) * 100)}% of the land. You hold ${Math.round(g.landShare(me) * 100)}%.`;
    else if (me.alive && leader) lede = `${leader.name} ends the age as the largest nation, with ${Math.round(g.landShare(leader) * 100)}% of the land. You hold ${Math.round(g.landShare(me) * 100)}%.`;
    else lede = 'Your last province was taken. You can keep watching how the war ends, or start again.';
    this.openModal(`<h2 id="modal-title">${title}</h2>
      <p class="result-lede">${lede}</p>
      <div class="result-stats">
        <div><span>Year</span><b>${o.year}</b></div>
        <div><span>Time</span><b>${fmtTime(o.time)}</b></div>
        <div><span>Peak land</span><b>${(me.peakTiles / g.map.landCount * 100).toFixed(1)}%</b></div>
        <div><span>Nations conquered</span><b>${me.kills}</b></div>
        <div><span>Rank</span><b>${rank}</b></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost" data-close>Keep watching</button>
        <button type="button" class="primary" data-act="menu">${this.net ? 'Leave game' : 'New game'}</button>
      </div>`, {
      onClick: (e) => {
        const b = e.target.closest('button[data-act]');
        if (b && b.dataset.act === 'menu') this.backToMenu();
      },
    });
  }
}
