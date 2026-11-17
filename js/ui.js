'use strict';
// DOM interface: start menu, HUD, input handling, context menu, tooltips and modals.

const PLAYER_COLORS = ['#3d7dd8', '#d64545', '#e0a526', '#2fa66a', '#8e5bd8', '#e07b39', '#2fb5c0', '#d9539a'];
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
    this.ratio = 0.3;
    this.lastEvent = 0;
    this.hudTimer = 0;
    this.mouse = { x: -1, y: -1, inside: false };
    this.keys = new Set();
    this.pointers = new Map();
    this.overShown = false;
    this.toastEls = new Map();
    this.noticeTimer = 0;
    this.prefs = loadPrefs();
    this.color = this.prefs.color || PLAYER_COLORS[0];
    this.genTimer = 0;

    this.initMenu();
    this.initHud();
    this.initInput();
  }

  isPaused() { return this.speed === 0 || this.modalOpen; }

  // ---------- menu ----------
  initMenu() {
    const P = this.prefs;
    if (P.name) $('opt-name').value = P.name;
    if (P.type && $('opt-type').querySelector(`option[value="${P.type}"]`)) $('opt-type').value = P.type;
    if (P.size) $('opt-size').value = P.size;
    if (P.numAI) $('opt-ai').value = P.numAI;
    if (P.diff) { const r = document.querySelector(`input[name=diff][value=${P.diff}]`); if (r) r.checked = true; }
    if (P.mode && MODES[P.mode]) { const r = document.querySelector(`input[name=mode][value=${P.mode}]`); if (r) r.checked = true; }
    const modeDesc = () => { $('mode-desc').textContent = MODES[document.querySelector('input[name=mode]:checked').value].desc; };
    for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', modeDesc);
    modeDesc();
    $('opt-ai-out').textContent = $('opt-ai').value;
    $('opt-seed').value = String(Math.floor(Math.random() * 900000) + 100000);

    const sw = $('opt-colors');
    for (const c of PLAYER_COLORS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `Color ${c}`);
      b.setAttribute('aria-checked', String(c === this.color));
      b.addEventListener('click', () => {
        this.color = c;
        for (const x of sw.children) x.setAttribute('aria-checked', String(x === b));
      });
      sw.appendChild(b);
    }

    $('opt-ai').addEventListener('input', () => { $('opt-ai-out').textContent = $('opt-ai').value; });
    $('opt-size').addEventListener('change', () => this.queuePreview());
    $('opt-type').addEventListener('change', () => {
      const rec = recommendedRivals($('opt-type').value);
      if (rec) { $('opt-ai').value = rec; $('opt-ai-out').textContent = rec; }
      this.updateMapFields();
      this.queuePreview(0);
    });
    this.updateMapFields();
    $('opt-seed').addEventListener('input', () => this.queuePreview());
    $('btn-reroll').addEventListener('click', () => {
      $('opt-seed').value = String(Math.floor(Math.random() * 900000) + 100000);
      this.queuePreview(0);
    });
    $('btn-help').addEventListener('click', () => this.showHelp());
    $('setup').addEventListener('submit', (e) => { e.preventDefault(); this.startGame(); });
    $('btn-random-spawn').addEventListener('click', () => this.randomSpawn());
    this.generatePreview();
  }

  mapOptions() {
    const type = $('opt-type').value;
    return { seed: seedFromInput($('opt-seed').value), type, size: isFixedMap(type) ? 'fixed' : $('opt-size').value };
  }

  // Fixed maps (real world, competitive) have no size choice; the seed only places rivals.
  updateMapFields() {
    const type = $('opt-type').value;
    const fixed = isFixedMap(type);
    $('size-field').hidden = fixed;
    $('size-field').parentElement.classList.toggle('single', fixed);
    $('seed-label').textContent = fixed ? 'Rival placement seed' : 'World seed';
    const desc = $('map-desc');
    const comp = MAP_TYPES[type] && MAP_TYPES[type].competitive;
    desc.hidden = !fixed;
    desc.textContent = comp ? `${MAP_TYPES[type].desc} Every region has an identical twin.` :
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
    const name = ($('opt-name').value.trim() || 'Your Nation').slice(0, 16);
    const diff = document.querySelector('input[name=diff]:checked').value;
    const mode = document.querySelector('input[name=mode]:checked').value;
    const numAI = Number($('opt-ai').value);
    this.prefs = { name, type: o.type, size: o.size, numAI, diff, mode, color: this.color };
    savePrefs(this.prefs);

    const game = new Game(this.map, { difficulty: diff, mode });
    game.setupPlayers({ playerName: name, playerColor: hexToRgb(this.color), numAI, difficulty: diff });
    this.game = game;
    this.lastEvent = 0;
    this.overShown = false;
    this.speed = 1;
    this.setSpeedButtons();
    $('focus').value = 50;
    this.updateFocus();
    this.r.insetLeft = 0;
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
    const g = this.game;
    if (!g.spawnHuman(tile)) { this.notice('Pick a spot on unclaimed land.', true); return; }
    this.r.mode = null;
    $('spawn-banner').hidden = true;
    $('hud').hidden = false;
    const x = tile % g.W, y = (tile - x) / g.W;
    this.r.centerOn(x + 0.5, y + 0.5, Math.max(this.r.minZoom() * 2.5, 4));
    this.updateHud(true);
  }

  backToMenu() {
    this.closeModal();
    this.closeCtx();
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
    $('st-year').addEventListener('click', () => this.openNation('tech'));
    $('st-stability').addEventListener('click', () => this.openNation('gov'));
    const ratio = $('ratio');
    ratio.addEventListener('input', () => { this.ratio = Number(ratio.value) / 100; this.updateRatio(); });
    const focus = $('focus');
    focus.addEventListener('input', () => {
      if (this.game) this.game.human.focus = Number(focus.value) / 100;
      this.updateFocus();
    });
    this.updateFocus();

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
        if (this.game.retreat(Number(btn.dataset.retreat), 1)) this.notice('Troops pulled back. 20% were lost in the retreat.');
        this.updateHud(true);
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
    const color = this.game ? this.game.human.color : hexToRgb(this.color);
    for (const type of BUILD_ORDER) {
      const cv = this.buildBtns[type].querySelector('canvas');
      const c = cv.getContext('2d');
      c.clearRect(0, 0, 60, 60);
      drawBuildingIcon(c, type, 30, 30, 40, color, false);
    }
    const cv = this.missileBtn.querySelector('canvas');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 60, 60);
    c.save();
    c.translate(30, 30);
    c.rotate(-Math.PI / 4);
    c.fillStyle = '#e0533d';
    c.strokeStyle = '#f4efe2';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, -22); c.lineTo(7, -10); c.lineTo(7, 12); c.lineTo(13, 20); c.lineTo(-13, 20); c.lineTo(-7, 12); c.lineTo(-7, -10);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  setSpeedButtons() {
    for (const b of document.querySelectorAll('.speed button')) b.classList.toggle('on', Number(b.dataset.speed) === this.speed);
  }

  updateRatio() {
    $('ratio-out').textContent = `${Math.round(this.ratio * 100)}%`;
    $('ratio').value = Math.round(this.ratio * 100);
    const g = this.game;
    $('ratio-troops').textContent = g && g.human ? fmt(g.human.troops * this.ratio) : '';
  }

  updateFocus() {
    const v = Number($('focus').value);
    $('focus-out').textContent = v < 20 ? 'War footing' : v < 42 ? 'Army-leaning' : v <= 58 ? 'Balanced' : v <= 80 ? 'Trade-leaning' : 'Merchant state';
  }

  notice(text, bad) {
    const n = $('notice');
    n.textContent = text;
    n.classList.toggle('bad', !!bad);
    n.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => n.classList.remove('show'), 2600);
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
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 200;
      if (this.game && this.game.started) this.updateHud();
      if (this.mouse.inside && this.pointers.size === 0) this.updateTooltip();
    }
  }

  updateHud(force) {
    const g = this.game;
    if (!g) return;
    const me = g.human;
    const cap = g.troopCap(me);
    $('v-troops').textContent = fmt(me.troops);
    $('v-cap').textContent = `/ ${fmt(cap)}`;
    const gr = $('v-growth');
    gr.textContent = `${me.growth >= 0 ? '+' : ''}${fmt(me.growth)}/s`;
    gr.classList.toggle('neg', me.growth < 0);
    $('v-gold').textContent = fmt(me.gold);
    $('v-income').textContent = `+${fmt(me.income)}/s`;
    const share = g.landShare(me);
    $('v-land').textContent = `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
    $('v-tiles').textContent = `${fmt(me.tiles)} tiles`;
    $('v-landbar').style.width = `${Math.min(100, share * 100)}%`;
    $('v-time').textContent = g.mode.endYear
      ? `${fmtTime(Math.max(0, (g.mode.endYear - START_YEAR) * g.mode.secPerYear - g.time))} left`
      : fmtTime(g.time);
    $('v-pop').textContent = fmt(me.pop);
    $('v-popcap').textContent = `/ ${fmt(me.popCap)}`;
    const pg = $('v-popgrowth');
    pg.textContent = `${me.popGrowth >= 0 ? '+' : ''}${fmt(me.popGrowth)}/s`;
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
      const f = clamp((me.progress[t.id] || 0) / t.cost, 0, 1);
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
      b.querySelector('.cost').textContent = unlocked ? fmt(cost) : 'Locked';
      b.classList.toggle('locked', !unlocked);
      b.classList.toggle('poor', unlocked && me.gold < cost);
      b.classList.toggle('on', !!(this.r.mode && this.r.mode.kind === 'build' && this.r.mode.type === type));
      const title = unlocked ? `${def.name}: ${def.desc} (key ${def.key})` : `${def.name} (locked): research ${TECH_BY_ID[def.tech].name} to unlock. ${def.desc}`;
      if (b.title !== title) b.title = title;
    }
    const mc = g.missileCost(me);
    this.missileBtn.querySelector('.cost').textContent = me.counts.silo ? fmt(mc) : 'Needs silo';
    this.missileBtn.classList.toggle('poor', !me.counts.silo || me.gold < mc || !g.readySilo(me));
    this.missileBtn.classList.toggle('on', !!(this.r.mode && this.r.mode.kind === 'missile'));

    this.updateBoard();
    this.updateFronts();
    this.updateLog();
    this.updateToasts();

    if (g.over && !this.overShown) {
      this.overShown = true;
      this.showGameOver();
    }
  }

  updateBoard() {
    const g = this.game;
    const alive = g.players.filter((p) => p && p.alive && p.spawned).sort((a, b) => b.tiles - a.tiles);
    $('board-count').textContent = `${alive.length} left`;
    const rows = [];
    const row = (p, rank) => {
      const ally = g.isAllied(1, p.id) ? '<span class="ally">Ally</span>' : '';
      const share = g.landShare(p) * 100;
      return `<li data-pid="${p.id}" class="${p.human ? 'me' : ''}" style="--c:${rgbCss(p.color)}"><span class="rk">${rank}</span><span class="nm">${esc(p.name)}${ally}</span><span class="ld">${share.toFixed(share < 10 ? 1 : 0)}%</span><span class="tr">${fmt(p.troops)}</span></li>`;
    };
    const top = Math.min(10, alive.length);
    for (let k = 0; k < top; k++) rows.push(row(alive[k], k + 1));
    const myRank = alive.indexOf(g.human);
    if (myRank >= top) {
      rows.push('<li class="sep" aria-hidden="true"></li>');
      rows.push(row(g.human, myRank + 1));
    }
    const html = rows.join('');
    if (html !== this.boardHtml) { $('board-list').innerHTML = html; this.boardHtml = html; }
  }

  updateFronts() {
    const g = this.game;
    const out = [], inc = [];
    for (const a of g.attacks) {
      if (a.dead) continue;
      if (a.attacker === 1) {
        const t = a.target ? g.players[a.target] : null;
        out.push(`<div class="front" style="--c:${t ? rgbCss(t.color) : '#a89f80'}"><span class="nm">${t ? esc(t.name) : 'Unclaimed land'}${a.seeded ? ' (beachhead)' : ''}</span><span class="tr">${fmt(a.troops)}</span><button type="button" data-retreat="${a.id}" title="Pull back 80% of these troops">Retreat</button></div>`);
      } else if (a.target === 1) {
        const p = g.players[a.attacker];
        inc.push(`<div class="front in" style="--c:${rgbCss(p.color)}"><span class="nm">${esc(p.name)}${a.seeded ? ' (beachhead)' : ''}</span><span class="tr">${fmt(a.troops)}</span><span></span></div>`);
      }
    }
    for (const s of g.ships) {
      if (s.dead) continue;
      const eta = Math.max(0, Math.ceil((s.path.length - 1 - s.pos) / SHIP_SPEED / TPS));
      if (s.owner === 1) {
        const t = s.target ? g.players[s.target] : null;
        out.push(`<div class="front" style="--c:${t ? rgbCss(t.color) : '#a89f80'}"><span class="nm">Fleet to ${t ? esc(t.name) : 'unclaimed land'}</span><span class="tr">${fmt(s.troops)}</span><span class="tr" style="font-size:13px;color:var(--muted)">${eta}s</span></div>`);
      } else if (s.target === 1) {
        const p = g.players[s.owner];
        inc.push(`<div class="front in" style="--c:${rgbCss(p.color)}"><span class="nm">Fleet from ${esc(p.name)}</span><span class="tr">${fmt(s.troops)}</span><span class="tr" style="font-size:13px;color:var(--muted)">${eta}s</span></div>`);
      }
    }
    for (const m of g.missiles) {
      if (m.dead) continue;
      const o = g.owner[m.tile];
      const eta = Math.max(0, Math.ceil((m.dur - m.t) / TPS));
      if (o === 1 && m.owner !== 1) {
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
      const li = document.createElement('li');
      li.className = e.kind;
      li.textContent = e.text;
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
          this.game.respondRequest(r.id, b.dataset.a === '1');
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

  // ---------- modes ----------
  toggleBuild(type) {
    const g = this.game;
    if (!g || !g.started || !g.human.alive || !g.buildingAvailable(type)) return;
    if (!g.buildingUnlocked(g.human, type)) {
      this.notice(`Research ${TECH_BY_ID[BUILDINGS[type].tech].name} to unlock the ${BUILDINGS[type].name.toLowerCase()}.`, true);
      return;
    }
    if (this.r.mode && this.r.mode.kind === 'build' && this.r.mode.type === type) { this.r.mode = null; }
    else {
      this.r.mode = { kind: 'build', type };
      const cost = g.buildCost(g.human, type);
      if (g.human.gold < cost) this.notice(`${BUILDINGS[type].name} needs ${fmt(cost)} gold. You have ${fmt(g.human.gold)}.`, true);
      else this.notice(`Click your land to place a ${BUILDINGS[type].name.toLowerCase()}. Esc to cancel.`);
    }
    this.updateHud(true);
  }

  toggleMissile() {
    const g = this.game;
    if (!g || !g.started || !g.human.alive) return;
    if (this.r.mode && this.r.mode.kind === 'missile') { this.r.mode = null; this.updateHud(true); return; }
    if (!g.human.counts.silo) { this.notice('Build a missile silo first.', true); return; }
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
    if (!g.started || !g.human.alive) return;
    if (mode && mode.kind === 'build') {
      const err = g.build(1, mode.type, tile);
      if (err) this.notice(err, true);
      else {
        this.notice(`${BUILDINGS[mode.type].name} built.`);
        if (!shift) this.r.mode = null;
      }
      this.updateHud(true);
      return;
    }
    if (mode && mode.kind === 'missile') {
      const err = g.launchMissile(1, tile);
      if (err) this.notice(err, true);
      else { this.notice('Missile away.'); this.r.mode = null; }
      this.updateHud(true);
      return;
    }
    this.attackAt(tile);
  }

  attackAt(tile) {
    const g = this.game, me = g.human;
    if (g.isWater(tile)) return;
    const o = g.owner[tile];
    if (o === 1) { this.notice('Your land. Right-click it to build.'); return; }
    if (g.isAllied(1, o)) { this.notice(`${g.players[o].name} is your ally. Right-click to reinforce them.`); return; }
    if (o === 0 && g.fallout[tile]) { this.notice('That land is scorched and can\'t be taken yet.', true); return; }
    const amount = Math.floor(me.troops * this.ratio);
    if (amount < 1) { this.notice('You have no troops to send.', true); return; }
    const who = o ? g.players[o].name : 'unclaimed land';
    if (this.landReachable(tile)) {
      if (g.launchAttack(1, o, amount)) { this.notice(`Attacking ${who} with ${fmt(amount)} troops.`); this.updateHud(true); return; }
    }
    const err = g.launchNaval(1, tile, amount);
    if (err) this.notice(err, true);
    else this.notice(`Fleet sailing to ${who} with ${fmt(amount)} troops.`);
    this.updateHud(true);
  }

  // Is the clicked region connected over land to our border?
  landReachable(tile) {
    const g = this.game, W = g.W, H = g.H, own = g.owner;
    const t = own[tile];
    const st = g.nextStamp(), S = g.bfsStamp, Q = g.bfsQueue;
    let qh = 0, qt = 0;
    Q[qt++] = tile; S[tile] = st;
    while (qh < qt) {
      if (qh > 150000) return true;
      const i = Q[qh++];
      const x = i % W, y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nb) {
        if (n < 0) continue;
        if (own[n] === 1) return true;
        if (S[n] === st || !g.isTarget(n, t)) continue;
        S[n] = st; Q[qt++] = n;
      }
    }
    return false;
  }

  // ---------- context menu ----------
  openCtx(tile, sx, sy) {
    const g = this.game;
    if (!g || !g.started || tile < 0) return;
    if (this.r.mode) { this.r.mode = null; this.updateHud(true); return; }
    const me = g.human, o = g.owner[tile], water = g.isWater(tile);
    const ter = TERRAIN[g.map.terrain[tile]];
    const items = [];
    let title, sub;
    if (water) { title = 'Open sea'; sub = ter.name; }
    else if (o) { const p = g.players[o]; title = p.human ? `${p.name} (you)` : p.name; sub = `${ter.name}, ${fmt(p.troops)} troops`; }
    else { title = 'Unclaimed land'; sub = ter.name; }

    if (me.alive && !water) {
      if (o === 1) {
        for (const type of BUILD_ORDER) {
          if (!g.buildingAvailable(type)) continue;
          const err = g.canBuild(me, type, tile);
          items.push({ label: `Build ${BUILDINGS[type].name.toLowerCase()}`, cost: fmt(g.buildCost(me, type)), disabled: !!err, title: err || BUILDINGS[type].desc,
            act: () => { const e = g.build(1, type, tile); this.notice(e || `${BUILDINGS[type].name} built.`, !!e); } });
        }
      } else if (!g.isAllied(1, o)) {
        const amt = Math.floor(me.troops * this.ratio);
        const land = this.landReachable(tile);
        items.push({ label: land ? `Attack with ${fmt(amt)} troops` : `Send fleet with ${fmt(amt)} troops`, act: () => this.attackAt(tile) });
        if (me.counts.silo) {
          const cost = g.missileCost(me);
          const err = !g.readySilo(me) ? 'Every silo is reloading.' : me.gold < cost ? `Needs ${fmt(cost)} gold.` : '';
          items.push({ label: 'Launch missile here', cost: fmt(cost), disabled: !!err, title: err, danger: true,
            act: () => { const e = g.launchMissile(1, tile); this.notice(e || 'Missile away.', !!e); } });
        }
      }
      if (o > 1) {
        const p = g.players[o];
        items.push({ sep: true });
        if (g.isAllied(1, o)) {
          const amt = Math.floor(me.troops * 0.25);
          items.push({ label: `Send ${fmt(amt)} troops`, act: () => { const e = g.sendTroops(1, o, amt); if (e) this.notice(e, true); } });
          items.push({ label: 'Break alliance', danger: true, act: () => g.breakAlliance(1, o) });
        } else {
          items.push({ label: 'Propose alliance', act: () => { const e = g.requestAlliance(1, o); if (e) this.notice(e, true); } });
        }
        const gold = Math.floor(me.gold * 0.25);
        items.push({ label: `Send ${fmt(gold)} gold`, title: 'Gifts improve how they feel about you.', disabled: gold < 1,
          act: () => { const e = g.sendGold(1, o, gold); if (e) this.notice(e, true); } });
        const [rl] = relLabel(g.getRel(o, 1));
        sub += `, ${rl.toLowerCase()} toward you`;
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
      head = `<span class="dot" style="background:${rgbCss(p.color)}"></span>${esc(p.name)}${p.human ? ' (you)' : ''}`;
      rows.push(['Troops', fmt(p.troops)]);
      rows.push(['People', fmt(p.pop)]);
      rows.push(['Land', `${(g.landShare(p) * 100).toFixed(1)}%`]);
      if (g.politics) {
        const c = g.control[tile];
        rows.push(['Control here', `<span class="${c < 50 ? 'rel-bad' : ''}">${c}%${c < 50 ? (c <= 20 ? ' (occupied)' : ' (restless)') : ''}</span>`]);
      }
      if (!p.human) {
        if (g.isAllied(1, o)) rows.push(['Status', '<span class="rel-good">Your ally</span>']);
        else {
          const v = g.getRel(o, 1);
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
    const mode = this.r.mode, me = g.human;
    if (mode && mode.kind === 'spawn') hint = g.canSpawnAt(tile) ? 'Click to found your nation here' : 'Already claimed';
    else if (mode && mode.kind === 'build') hint = g.canBuild(me, mode.type, tile) || `Click to build (${fmt(g.buildCost(me, mode.type))} gold)`;
    else if (mode && mode.kind === 'missile') hint = 'Click to launch';
    else if (me.alive && g.started) {
      if (o === 1) hint = 'Right-click to build here';
      else if (g.isAllied(1, o)) hint = 'Right-click to reinforce or send gold';
      else if (o === 0 && g.fallout[tile]) hint = 'Scorched. Wait for it to clear.';
      else hint = (g.neighbors[1].has(o) ? 'Click to attack' : 'Click to send a fleet') + ', right-click for more';
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
      this.r.zoomAt(e.clientX, e.clientY, f);
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
        if (this.r.mode && this.r.mode.kind !== 'spawn') { this.r.mode = null; this.updateHud(true); }
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
      if (k === 'h' && g.started) { const L = g.human.label; this.r.centerOn(L.x, L.y, Math.max(this.r.cam.zoom, 3)); return; }
      if (k === 'm') { this.toggleMissile(); return; }
      if (k === 't' && g.started) { this.openNation('tech'); return; }
      if (k === 'g' && g.started && g.politics) { this.openNation('gov'); return; }
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
    const color = this.game ? this.game.human.color : hexToRgb(this.color);
    for (const t of BUILD_ORDER) {
      const d = BUILDINGS[t];
      const li = document.createElement('li');
      const needs = d.tech ? `, needs ${TECH_BY_ID[d.tech].name}` : '';
      const only = d.politics ? ' Realistic only.' : '';
      li.innerHTML = `<canvas width="52" height="52" style="width:26px;height:26px" data-t="${t}"></canvas><span><b>${d.name}</b> (${fmt(d.base)} gold, key ${d.key}${needs}). ${d.desc}${only}</span>`;
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
    this.nationTab = tab === 'gov' && g.politics ? 'gov' : 'tech';
    this.nationMsg = '';
    this.openModal(this.nationHtml(), { wide: true, onClick: (e) => this.onNationClick(e) });
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
    const g = this.game, me = g.human;
    if (e.target.closest('[data-close]')) { this.closeModal(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { this.nationTab = tab.dataset.tab; this.nationMsg = ''; this.renderNation(); return; }
    const tech = e.target.closest('[data-tech]');
    if (tech) {
      const err = me.alive ? g.setResearch(1, tech.dataset.tech) : 'Your nation has fallen.';
      this.nationMsg = err || `Researching ${TECH_BY_ID[tech.dataset.tech].name}.`;
      this.nationMsgBad = !!err;
      this.renderNation();
      return;
    }
    const act = e.target.closest('[data-gov]');
    if (act && me.alive) {
      let err = '';
      if (act.dataset.gov === 'martial') err = g.setMartial(1, !me.martial);
      if (act.dataset.gov === 'celebrate') err = g.celebrate(1);
      this.nationMsg = err || (act.dataset.gov === 'celebrate' ? 'Celebrations begin across the land.' : me.martial ? 'Martial law declared.' : 'Martial law lifted.');
      this.nationMsgBad = !!err;
      this.renderNation();
    }
  }

  nationHtml() {
    const g = this.game;
    const tabs = g.politics
      ? `<div class="tabs" role="tablist">
          <button type="button" role="tab" data-tab="tech" aria-selected="${this.nationTab === 'tech'}">Technology</button>
          <button type="button" role="tab" data-tab="gov" aria-selected="${this.nationTab === 'gov'}">Government</button>
        </div>`
      : '';
    const msg = this.nationMsg ? `<p class="nation-msg${this.nationMsgBad ? ' bad' : ''}" role="status">${esc(this.nationMsg)}</p>` : '';
    const content = this.nationTab === 'gov' ? this.govHtml() : this.techHtml();
    return `<div class="nation-top"><h2 id="modal-title">${this.nationTab === 'gov' ? 'Government' : 'Technology'}</h2>${tabs}</div>
      ${content}${msg}
      <div class="modal-actions"><button type="button" class="primary" data-close>Back to the map</button></div>`;
  }

  techHtml() {
    const g = this.game, me = g.human, era = eraIndex(g.year);
    const cur = me.research ? TECH_BY_ID[me.research] : null;
    const rate = me.rpRate;
    const eta = (t) => {
      const left = t.cost - (me.progress[t.id] || 0);
      return rate > 0 ? Math.ceil(left / rate) : Infinity;
    };
    const lede = `It is ${g.year}, the ${ERAS[era].name.toLowerCase()} era. You produce ${rate.toFixed(1)} research per second from your people and universities.` +
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
        else if (isCur) foot = `Researching, ${Math.floor(prog / t.cost * 100)}%`;
        else if (st === 'avail') foot = `${fmt(t.cost)} research, about ${fmtDuration(eta(t))}`;
        else if (st === 'year') foot = `Opens in ${t.year}`;
        else foot = `Needs ${t.req.filter((r) => !me.techs.has(r)).map((r) => TECH_BY_ID[r].name).join(', ')}`;
        const bar = (isCur || (prog > 0 && st !== 'done')) ? `<span class="tp"><i style="width:${Math.min(100, prog / t.cost * 100)}%"></i></span>` : '';
        cards += `<button type="button" class="tech s-${st}${isCur ? ' cur' : ''}" data-tech="${t.id}"${st === 'done' ? ' disabled' : ''} aria-pressed="${isCur}">
          <span class="th"><span class="tn">${esc(t.name)}</span>${g.mode.timeGate ? `<span class="ty">${t.year}</span>` : ''}</span>
          <span class="td">${esc(t.desc)}${!g.politics && t.kind === 'gov' ? ' Stability and administration don\'t apply in Blitz.' : ''}</span>
          <span class="tf">${esc(foot)}</span>${bar}
        </button>`;
      }
      const span = e < ERAS.length - 1 ? `${ERAS[e].from}–${ERAS[e + 1].from - 1}` : `${ERAS[e].from} on`;
      cols += `<section class="era${e === era ? ' now' : ''}${g.mode.timeGate && e > era ? ' future' : ''}"><h3>${ERAS[e].name} <span>${span}</span></h3>${cards}</section>`;
    }
    return `<p class="result-lede">${esc(lede)}</p><div class="tree">${cols}</div>`;
  }

  govHtml() {
    const g = this.game, me = g.human;
    const s = Math.round(me.stability), tg = Math.round(me.stabTarget);
    const sf = g.stabFactor(me);
    const label = s >= 70 ? 'Prosperous' : s >= 50 ? 'Orderly' : s >= REVOLT_BELOW + 10 ? 'Uneasy' : s >= REVOLT_BELOW ? 'Restless' : 'In revolt';
    let occupied = 0;
    for (let t = 0; t < g.N; t++) if (g.owner[t] === 1 && g.control[t] < 50) occupied++;
    const rows = me.stabFactors.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(v % 1 && Math.abs(v) < 10 ? 1 : 0)}</td></tr>`).join('');
    const cc = g.celebrateCost(me);
    const cdLeft = Math.max(0, Math.ceil((me.celebrateReadyAt - g.tick) / TPS));
    const adminPct = Math.round(me.tiles / Math.max(1, me.adminCap) * 100);
    return `<div class="gov">
      <section class="gov-card">
        <div class="gov-stab"><b class="${s < REVOLT_BELOW ? 'bad' : s < 45 ? 'warn' : ''}">${s}</b><span>${label}<br><small>${tg === s ? 'Holding steady' : `${tg > s ? 'Rising' : 'Falling'} toward ${tg}`}</small></span></div>
        <div class="goal stab big" aria-hidden="true"><div style="width:${clamp(me.stability, 0, 100)}%"></div><i></i></div>
        <p>Stability multiplies gold, recruiting and research by <b>×${sf.toFixed(2)}</b>. Below <b>${REVOLT_BELOW}</b>, restless regions can break away as a new nation.</p>
        <table class="factors"><caption>What sets your stability</caption>${rows}<tr class="sum"><th scope="row">Target</th><td>${tg}</td></tr></table>
      </section>
      <section class="gov-card">
        <h3>Administration</h3>
        <p>You govern <b>${fmt(me.tiles)}</b> tiles with room for <b>${fmt(me.adminCap)}</b> (${adminPct}%). Beyond that, every extra tile costs stability. Cities and courthouses add room and bring nearby land under full control.</p>
        <p>Average control <b>${Math.round(me.avgControl)}%</b>. <b>${fmt(occupied)}</b> tiles are occupied or restless and show hatching on the map. Conquered land integrates slowly; land far from your capital, cities and courthouses never settles fully.</p>
        <h3>Policies</h3>
        <div class="policy">
          <div><b>Martial law</b><p>+15 stability. Gold −25% and population growth −30% while it lasts.</p></div>
          <button type="button" class="${me.martial ? 'primary' : 'ghost'}" data-gov="martial">${me.martial ? 'Lift martial law' : 'Declare martial law'}</button>
        </div>
        <div class="policy">
          <div><b>Celebration</b><p>+15 stability, fading over a minute. Costs ${fmt(cc)} gold.${cdLeft ? ` Ready again in ${cdLeft}s.` : ''}</p></div>
          <button type="button" class="ghost" data-gov="celebrate"${cdLeft || me.gold < cc ? ' disabled' : ''}>Hold a celebration</button>
        </div>
        <p class="fine">The age ends in ${g.mode.endYear}. If nobody holds 70% of the land by then, the largest nation wins.</p>
      </section>
    </div>`;
  }

  showGameMenu() {
    if (!this.game) return;
    this.openModal(`<h2 id="modal-title">Paused</h2>
      <p class="result-lede">The world waits while this menu is open.</p>
      <div class="modal-actions">
        <button type="button" class="ghost" data-act="help">How to play</button>
        <button type="button" class="ghost" data-act="menu">Quit to main menu</button>
        <button type="button" class="primary" data-close>Resume</button>
      </div>`, {
      onClick: (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.dataset.act === 'help') { this.closeModal(); this.showHelp(); }
        if (b.dataset.act === 'menu') this.backToMenu();
      },
    });
  }

  showGameOver() {
    const g = this.game, me = g.human, o = g.over;
    const alive = g.players.filter((p) => p && p.alive).sort((a, b) => b.tiles - a.tiles);
    const rank = me.alive ? alive.indexOf(me) + 1 : '—';
    const leader = o.leader ? g.players[o.leader] : null;
    const title = o.won ? 'Victory' : me.alive ? `The year ${o.year} arrives` : 'Your nation has fallen';
    let lede;
    if (o.won && o.reason === 'share') lede = `You hold ${Math.round(g.landShare(me) * 100)}% of the world. No one is left to challenge you.`;
    else if (o.won && o.reason === 'year') lede = `The year ${o.year} arrives and yours is the largest nation on earth, with ${Math.round(g.landShare(me) * 100)}% of the land.`;
    else if (o.won) lede = 'Every rival is gone or sworn to you. The world is yours.';
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
        <button type="button" class="primary" data-act="menu">New game</button>
      </div>`, {
      onClick: (e) => {
        const b = e.target.closest('button[data-act]');
        if (b && b.dataset.act === 'menu') this.backToMenu();
      },
    });
  }
}
