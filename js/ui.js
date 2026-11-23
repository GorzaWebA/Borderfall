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

// A computer nation's personality ('warlord', 'merchant', ...), on the host or a guest.
function persOf(p) {
  if (!p || p.human || p.tribe) return '';
  return p.ai && p.ai.pers ? p.ai.pers.key : p.persKey || '';
}
// The icon tag shown beside a computer nation's name, with its personality as the tooltip.
function persTag(p) {
  const k = persOf(p), I = PERSONALITY_ICON[k];
  if (!I) return '';
  return `<span class="pi" title="Computer nation, ${I.label.toLowerCase()}: ${I.desc}" aria-label="Computer nation, ${I.label.toLowerCase()}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${I.path}"/></svg></span>`;
}

// Small icons for how a nation stands toward you; see STANCE_ICON.
function stanceTags(g, myId, p) {
  return stanceOf(g, myId, p).map((k) => {
    const S = STANCE_ICON[k];
    return `<span class="si ${S.css}" title="${S.label}" aria-label="${S.label}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${S.path}"/></svg></span>`;
  }).join('');
}

// A short vibration on phones that support it (long-press, threats). Silently does nothing elsewhere.
function buzz(pattern) {
  try { if (navigator.vibrate && window.matchMedia('(pointer: coarse)').matches) navigator.vibrate(pattern); } catch (e) { /* not allowed */ }
}
function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  } catch (e) { /* not supported */ }
}

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

// Alert cards. tone sets the colour; threat ones still show with "Threats only"; show is where
// "Show me" goes; act adds a button; life is seconds on screen; quiet is how long repeats from
// the same nation are held back.
const ALERTS = {
  attack: { title: 'Under attack', tone: 'bad', threat: true, show: 'front', life: 9, quiet: 45 },
  fleet: { title: 'Fleet incoming', tone: 'bad', threat: true, show: 'at', life: 10, quiet: 30 },
  missile: { title: 'Missile', tone: 'bad', threat: true, show: 'at', life: 9, quiet: 10 },
  capital: { title: 'Capital lost', tone: 'bad', threat: true, show: 'capital', life: 12 },
  betrayed: { title: 'Betrayed', tone: 'bad', threat: true, show: 'who', life: 10 },
  revolt: { title: 'Revolt', tone: 'bad', threat: true, show: 'at', life: 20, flare: true, flash: true },
  unrest: { title: 'Unrest', tone: 'warn', threat: true, show: 'at', life: 12 },
  expiring: { title: 'Alliance ending', tone: 'warn', act: 'renew', life: 15 },
  embargo: { title: 'Trade closed', tone: 'warn', show: 'who', life: 9, quiet: 60 },
  declined: { title: 'Alliance declined', tone: 'info', act: 'gift', life: 10 },
  expired: { title: 'Alliance over', tone: 'info', act: 'propose', life: 10 },
  allied: { title: 'Alliance', tone: 'good', life: 6 },
  conquest: { title: 'Conquest', tone: 'good', show: 'who', life: 7 },
  allies: { title: 'Allies may join', tone: 'warn', show: 'who', life: 9, quiet: 90 },
};
const MAX_ALERTS = 3;
const MAX_OFFERS = 2;   // alliance offers shown at once; the rest wait their turn

// A nation's allies as a short list of names, with colour dots: "Kostrava, Yarvena and Altuq".
function allyList(g, p, except = 0, max = 3) {
  const ids = [...p.allies].filter((id) => id !== except && g.players[id] && g.players[id].alive);
  if (!ids.length) return '';
  const name = (id) => `<span class="dot" style="background:${rgbCss(g.players[id].color)}"></span>${esc(g.players[id].name)}`;
  const shown = ids.slice(0, max).map(name);
  if (ids.length > max) shown.push(`${ids.length - max} more`);
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
}
// The nations someone is fighting right now, either way round; tribes left out.
function warList(g, p, max = 3) {
  const ids = new Set();
  for (const a of g.attacks) {
    if (a.dead || !a.target) continue;
    if (a.attacker === p.id && !g.players[a.target].tribe) ids.add(a.target);
    else if (a.target === p.id && !g.players[a.attacker].tribe) ids.add(a.attacker);
  }
  const list = [...ids].slice(0, max).map((id) => `<span class="dot" style="background:${rgbCss(g.players[id].color)}"></span>${esc(g.players[id].name)}`);
  if (ids.size > max) list.push(`${ids.size - max} more`);
  return list.join(', ');
}

const PREFS_VERSION = 3;   // raised when the default counts of nations and tribes change
const MODE_PREFS_VERSION = 1;
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
    this.ratio = 0.2;
    this.lastEvent = 0;
    this.hudTimer = 0;
    this.mouse = { x: -1, y: -1, inside: false };
    this.keys = new Set();
    this.pointers = new Map();
    this.overShown = false;
    this.toastEls = new Map();
    this.noticeTimer = 0;
    this.prefs = loadPrefs();
    this.alertSeen = new Map();     // alert key -> when it last showed, to hold back repeats
    this.shop = loadShop();
    this.stats = loadStats();
    this.profile = loadProfile();
    this.cloud = new Cloud(this);
    this.color = PLAYER_COLORS.some((c) => c.hex === this.prefs.color) ? this.prefs.color : PLAYER_COLORS[0].hex;
    this.genTimer = 0;
    this.myId = 1;
    this.net = null;
    this.tutorial = null;

    this.initMenu();
    this.initHud();
    this.initInput();
    this.initAccount();
    this.cloud.start();
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
    if (!quiet && res && res.msg) this.notice(res.msg, res.bad, res.warn);
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
    else $('opt-ai').value = recommendedRivals($('opt-type').value, $('opt-size').value) || 30;
    if (P.diff) { const r = document.querySelector(`input[name=diff][value=${P.diff}]`); if (r) r.checked = true; }
    // A mode saved before Blitz became the default is ignored once.
    if (P.mode && MODES[P.mode] && P.modeV === MODE_PREFS_VERSION) { const r = document.querySelector(`input[name=mode][value=${P.mode}]`); if (r) r.checked = true; }
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
        this.renderPatternRow();
      });
      sw.appendChild(b);
    }
    $('btn-rename').addEventListener('click', () => { $('opt-name').value = this.suggestName(); this.renderPatternRow(); });
    $('opt-name').addEventListener('input', () => this.renderPatternRow());
    $('btn-shop').addEventListener('click', () => this.showShop());
    $('btn-shop-link').addEventListener('click', () => this.showShop());
    // Phones and tablets can play full screen where the browser allows it.
    const fs = $('btn-fullscreen');
    fs.hidden = !document.fullscreenEnabled || !window.matchMedia('(pointer: coarse)').matches;
    fs.addEventListener('click', () => toggleFullscreen());
    document.addEventListener('fullscreenchange', () => { fs.textContent = document.fullscreenElement ? 'Leave full screen' : 'Full screen'; });
    // Rows in the panel open their cards beside it.
    for (const b of document.querySelectorAll('.menu-row[data-side]')) b.addEventListener('click', () => this.setSide(b.dataset.side, b.getAttribute('aria-expanded') !== 'true'));
    for (const b of document.querySelectorAll('[data-side-close]')) b.addEventListener('click', () => this.setSide(b.dataset.sideClose, false));
    this.renderPatternRow();
    $('setup').addEventListener('input', () => this.updateWorldSummary());
    $('setup').addEventListener('change', () => this.updateWorldSummary());

    $('opt-ai').addEventListener('input', () => { $('opt-ai-out').textContent = $('opt-ai').value; });
    if (P.v === PREFS_VERSION && P.numTribes !== undefined) $('opt-tribes').value = P.numTribes;
    else $('opt-tribes').value = recommendedTribes($('opt-type').value, $('opt-size').value) || 24;
    $('opt-tribes-out').textContent = $('opt-tribes').value;
    $('opt-tribes').addEventListener('input', () => { $('opt-tribes-out').textContent = $('opt-tribes').value; });
    $('opt-size').addEventListener('change', () => {
      this.applyRecommendedCounts();
      this.queuePreview();
    });
    $('opt-type').addEventListener('change', () => {
      if ($('opt-type').value === 'random') {
        this.rollRandomType();
        $('opt-seed').value = String(Math.floor(Math.random() * 900000) + 100000);
      }
      this.applyRecommendedCounts();
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
    $('btn-tutorial').addEventListener('click', () => this.showTutorials(false));
    let tutDone = false, welcomed = false;
    try {
      tutDone = localStorage.getItem(TUT_DONE_KEY) === '1';
      welcomed = localStorage.getItem('borderfall.welcomed') === '1';
    } catch (e) { /* storage unavailable */ }
    $('btn-tutorial').classList.toggle('nudge', !tutDone);
    if (!tutDone) $('btn-tutorial').textContent = 'New here? Play the tutorial';
    // With no saved choice, phones with little memory or few cores start on Low.
    const weak = window.matchMedia('(pointer: coarse)').matches && ((navigator.deviceMemory || 8) <= 4 || (navigator.hardwareConcurrency || 8) <= 4);
    const gfx = P.gfx === 'low' || (!P.gfx && weak) ? 'low' : 'high';
    document.querySelector(`input[name=gfx][value=${gfx}]`).checked = true;
    this.r.setQuality(gfx);
    for (const r of document.querySelectorAll('input[name=gfx]')) r.addEventListener('change', () => this.setGraphics(r.value));
    this.updateWorldSummary();
    this.initMultiplayer();
    $('setup').addEventListener('submit', (e) => { e.preventDefault(); this.startGame(); });
    $('btn-random-spawn').addEventListener('click', () => this.randomSpawn());
    $('btn-place-go').addEventListener('click', () => this.finishPlacement());
    this.generatePreview();
    // First visit: offer the tutorials, unless the visitor came to join a friend's lobby.
    if (!tutDone && !welcomed && !new URLSearchParams(location.search).has('join')) this.showTutorials(true);
  }

  // The start screen's side cards: your nation, world settings and online play.
  // One card at a time, except that a lobby keeps its card open beside the world settings.
  setSide(name, open) {
    const ids = { nation: 'side-nation', world: 'world-settings', online: 'side-online', account: 'side-account' };
    for (const k of Object.keys(ids)) {
      const keep = k === name ? open : open && !(this.net && (k === 'online' || name === 'online')) ? false : !$(ids[k]).hidden;
      $(ids[k]).hidden = !keep;
      document.querySelector(`.menu-row[data-side="${k}"]`).setAttribute('aria-expanded', String(keep));
    }
    this.updateGamesWatch();
  }

  // ---------- account, leaderboard and open games (Firebase) ----------
  initAccount() {
    $('acct-google').addEventListener('click', async () => {
      if (this.acctBusy) return;
      this.acctBusy = 'Signing in…';
      this.acctMsg = '';
      this.renderAccount();
      const msg = await this.cloud.signInGoogle().catch(() => 'Sign-in failed. Try again.');
      this.acctBusy = false;
      this.acctMsg = msg === 'cancelled' ? '' : msg;
      this.renderAccount();
    });
    $('acct-out').addEventListener('click', () => this.confirmSignOut());
    $('acct-board').addEventListener('click', () => this.showLeaderboard());
    $('btn-board-link').addEventListener('click', () => this.showLeaderboard());
    this.renderAccount();
  }

  renderAccount() {
    const C = this.cloud, on = C.enabled;
    $('row-account').hidden = !on;
    $('btn-board-link').hidden = !on;
    document.body.classList.toggle('cloud-on', on);
    this.updateGamesWatch();
    if (!on) return;
    const s = C.state, st = this.stats, u = C.user;
    $('account-summary').textContent = {
      connecting: 'Connecting…', offline: 'Offline', signedout: 'Not signed in', guest: 'Guest. Sign in to keep your progress',
      google: u ? u.label : 'Signed in',
    }[s] || '';
    let text = {
      connecting: 'Connecting to Borderfall online…',
      offline: "Couldn't reach Borderfall online. Your progress is kept on this device; reload the page to try again.",
      signedout: 'Sign in with Google to save your crowns, patterns and results online and to join the leaderboard.',
      guest: 'You are playing as a guest. Your crowns, patterns and results are saved online for this browser. Sign in with Google to keep them on every device.',
      google: `Signed in as ${u ? u.label : 'your Google account'}. Your crowns, patterns and results are saved to your account and follow you to any device.`,
    }[s] || '';
    if (C.syncFailed && (s === 'guest' || s === 'google')) text += " Couldn't save just now; it will try again.";
    if (this.acctBusy) text = this.acctBusy;
    $('acct-status').textContent = this.acctMsg || text;
    $('acct-status').classList.toggle('bad', !!this.acctMsg);
    $('acct-google').hidden = !(s === 'guest' || s === 'signedout');
    $('acct-google').disabled = !!this.acctBusy;
    $('acct-out').hidden = s !== 'google';
    $('acct-board').disabled = s === 'offline';
    $('acct-stats').hidden = !st.games;
    $('acct-stats').innerHTML = `<div><dt>Games</dt><dd>${st.games}</dd></div><div><dt>Wins</dt><dd>${st.wins}</dd></div>`
      + `<div><dt>Best game</dt><dd>${st.best}</dd></div><div><dt>Total points</dt><dd>${fmt(st.points)}</dd></div>`;
  }

  // A save arrived from the account (or this device went back to a fresh guest).
  onSaveApplied() {
    this.renderPatternRow();
    let tutDone = false;
    try { tutDone = localStorage.getItem(TUT_DONE_KEY) === '1'; } catch (e) { /* storage unavailable */ }
    const tb = $('btn-tutorial');
    if (tutDone && tb.classList.contains('nudge')) { tb.classList.remove('nudge'); tb.textContent = 'Tutorials'; }
    this.renderAccount();
  }

  confirmSignOut() {
    this.openModal(`<h2 id="modal-title">Sign out?</h2>
      <p class="result-lede">Your crowns, patterns and results stay with your Google account. This browser starts again as a new guest.</p>
      <div class="modal-actions"><button type="button" class="ghost" data-close>Stay signed in</button><button type="button" class="primary" data-act="out">Sign out</button></div>`, {
      onClick: async (e) => {
        if (!e.target.closest('[data-act="out"]') || this.acctBusy) return;
        this.closeModal();
        this.acctBusy = 'Signing out…';
        this.renderAccount();
        this.acctMsg = await this.cloud.signOut().catch(() => 'Sign-out failed. Try again.');
        this.acctBusy = false;
        this.renderAccount();
      },
    });
  }

  // The open games list follows the database while the Online card is open on the start screen.
  updateGamesWatch() {
    const C = this.cloud;
    const want = !!(C && C.netOk && !this.game && !this.net && !$('side-online').hidden);
    $('mp-games').hidden = !(C && C.netOk) || !!this.net;
    if (want && !this.gamesUnsub) this.gamesUnsub = C.watchLobbies((list) => this.renderOpenGames(list));
    else if (!want && this.gamesUnsub) { this.gamesUnsub(); this.gamesUnsub = null; }
  }

  renderOpenGames(list) {
    const rows = list.filter((x) => x.players < x.max).sort((a, b) => (b.players - a.players) || ((b.at || 0) - (a.at || 0))).slice(0, 4);
    $('mp-games-list').innerHTML = rows.length
      ? rows.map((x) => `<li><span class="og-main"><b>${esc(MODES[x.mode] ? MODES[x.mode].label : x.mode)}</b> · ${esc(x.map)}</span>`
        + `<span class="og-sub">${esc(x.name)} · ${x.auto ? 'starts by itself' : 'host starts'} · ${x.players}/${x.max} players</span>`
        + `<button type="button" class="ghost" data-join="${esc(x.code)}">Join</button></li>`).join('')
      : '<li class="og-empty">No open games right now. Quick match opens one that others can join.</li>';
  }

  showLeaderboard(tab = 'best') {
    if (!this.cloud.enabled) return;
    const tabs = Object.entries(BOARD_TABS).map(([k, t]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${t.label}</button>`).join('');
    this.openModal(`<div class="board-top"><h2 id="modal-title">Leaderboard</h2><div class="tabs" role="tablist">${tabs}</div></div>
      <div id="board-body" class="board-body" aria-live="polite"></div>
      <details class="board-how"><summary>How points are counted</summary><p>A game gives one point for each 1% of the world you held at your peak, four for each nation or tribe you destroy, and 100 for a win. Points are halved on Easy and raised by half on Hard. Worlds with fewer than 20 rivals count for less, and you get a quarter more when other players are in the match. Your name here is the name of the nation you last played.</p></details>
      <div class="modal-actions"><button type="button" class="primary" data-close>Close</button></div>`, {
      onClick: (e) => {
        const b = e.target.closest('[data-tab]');
        if (!b) return;
        for (const x of $('modal-body').querySelectorAll('[data-tab]')) x.setAttribute('aria-selected', String(x === b));
        this.loadBoard(b.dataset.tab);
      },
    });
    this.loadBoard(tab);
  }

  async loadBoard(tab) {
    const C = this.cloud, field = BOARD_TABS[tab].field, unit = BOARD_TABS[tab].unit;
    this.boardTab = tab;
    const body = () => (this.boardTab === tab ? $('board-body') : null);
    if (body()) body().innerHTML = '<p class="field-note">Loading…</p>';
    await C.ready();
    let rows;
    try {
      if (!C.fb || C.state === 'offline') throw new Error('offline');
      rows = await C.leaderboard(tab);
    } catch (e) {
      if (body()) body().innerHTML = '<p class="field-note bad">Couldn\'t load the leaderboard. Check your connection and try again.</p>';
      return;
    }
    if (!body()) return;
    const me = C.user && C.user.uid, SHOW = 12;
    const row = (r, i) => `<li class="${r.uid === me ? 'you' : ''}"><span class="rk">${i + 1}</span>`
      + `<span class="dot" style="background:${/^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#888888'}"></span>`
      + `<span class="nm">${esc(r.name)}${r.uid === me ? ' <em>you</em>' : ''}</span>`
      + `<span class="sub">${r.wins} ${r.wins === 1 ? 'win' : 'wins'} in ${r.games} ${r.games === 1 ? 'game' : 'games'}</span>`
      + `<span class="v">${fmt(r[field])} <small>${r[field] === 1 && unit === 'wins' ? 'win' : unit}</small></span></li>`;
    if (!rows.length) { body().innerHTML = '<p class="field-note">No results yet. Finish a game to be the first on the board.</p>'; return; }
    const mine = rows.findIndex((r) => r.uid === me);
    let html = `<ol class="board">${rows.slice(0, SHOW).map(row).join('')}</ol>`;
    if (mine >= SHOW) html += `<ol class="board below">${row(rows[mine], mine)}</ol>`;
    else if (mine < 0) html += `<p class="field-note">${this.stats.games ? `You aren't in the top ${BOARD_FETCH} yet.` : 'Finish a game to join the board.'}</p>`;
    body().innerHTML = html;
    // As many rows as the screen holds without scrolling, but always the top three and your own.
    const card = $('modal').querySelector('.modal-card');
    const shown = [...body().querySelectorAll('.board:not(.below) li')];
    for (let k = shown.length - 1; k >= 3 && card.scrollHeight > card.clientHeight + 1; k--) shown[k].hidden = true;
  }

  // ---------- shop ----------
  renderPatternRow() {
    const skin = SKIN_BY_ID[this.shop.equipped] || SKINS[0];
    paintSkinPreview($('pattern-preview'), skin.id, hexToRgb(this.color));
    paintSkinPreview($('nation-chip'), skin.id, hexToRgb(this.color));
    $('nation-chip-name').textContent = $('opt-name').value.trim() || 'Your nation';
    $('pattern-name').textContent = skin.name;
    $('shop-crowns').textContent = `${this.shop.crowns} crowns`;
    $('btn-shop-link').title = `${this.shop.crowns} crowns to spend`;
  }

  // Crowns for the game in progress, once per game.
  awardGame() {
    const g = this.game;
    if (!g || g.crownsAwarded || !this.me) return 0;
    g.crownsAwarded = true;
    g.scoreResult = this.cloud.recordGame(g, this.me);
    return this.addCrowns(crownsForGame(g, this.me));
  }
  addCrowns(n) {
    if (!(n > 0)) return 0;
    this.shop.crowns += n;
    saveShop(this.shop);
    this.cloud.dirty();
    const note = $('crowns-note');
    note.textContent = `You earned ${n} crowns last game. Spend them in the shop.`;
    note.hidden = false;
    this.renderPatternRow();
    return n;
  }
  // One-off rewards, such as finishing a tutorial for the first time.
  claimReward(id, n) {
    // The account saves the tutorial as done even when the reward was paid before.
    this.cloud.dirty();
    if (this.shop.claimed.includes(id)) return 0;
    this.shop.claimed.push(id);
    return this.addCrowns(n);
  }

  // Patterns for your nation's land, bought with crowns and shown to every player.
  showShop() {
    const S = this.shop;
    const cards = SKINS.map((k) => {
      const owned = S.owned.includes(k.id), on = S.equipped === k.id;
      let btn;
      if (on) btn = '<button type="button" class="ghost" disabled>Equipped</button>';
      else if (owned) btn = `<button type="button" class="ghost" data-equip="${k.id}">Equip</button>`;
      else if (S.crowns >= k.price) btn = `<button type="button" class="primary" data-buy="${k.id}">Buy</button>`;
      else btn = `<button type="button" class="ghost" disabled>${k.price - S.crowns} more needed</button>`;
      const tag = on ? '<em>Equipped</em>' : owned ? '<em>Owned</em>' : k.price ? `<em class="price">${k.price} crowns</em>` : '<em>Free</em>';
      return `<article class="skin-card${on ? ' on' : ''}"><canvas data-skin="${k.id}" width="36" height="20"></canvas>
        <div class="skin-name"><b>${k.name}</b>${tag}</div><p>${k.desc}</p>${btn}</article>`;
    }).join('');
    this.openModal(`<div class="shop-top"><h2 id="modal-title">Shop</h2><p class="shop-bal"><b>${S.crowns}</b> crowns</p>
        <button type="button" class="primary" data-close>Done</button></div>
      <p class="result-lede">Patterns for your nation's land. They are drawn into the map tile by tile, and other players see yours in multiplayer.</p>
      <div class="shop-grid">${cards}</div>
      <p class="fine">Earn crowns by playing: one for each 1% of the world you held at your peak, three for each nation or tribe you destroy, up to ten for time played, and a bonus for winning (120 in Realistic, 60 in Blitz). The controls lesson pays 50 and the guided game 100, the first time.</p>`, {
      wide: true,
      onClick: (e) => {
        const buy = e.target.closest('[data-buy]'), equip = e.target.closest('[data-equip]');
        if (buy) {
          const k = SKIN_BY_ID[buy.dataset.buy];
          if (!k || S.owned.includes(k.id) || S.crowns < k.price) return;
          S.crowns -= k.price;
          S.owned.push(k.id);
          S.equipped = k.id;
        } else if (equip && S.owned.includes(equip.dataset.equip)) {
          S.equipped = equip.dataset.equip;
        } else return;
        S.equippedAt = Date.now();
        saveShop(S);
        this.cloud.dirty();
        this.renderPatternRow();
        const scroll = $('modal').querySelector('.modal-card').scrollTop;
        this.showShop();
        $('modal').querySelector('.modal-card').scrollTop = scroll;
      },
    });
    const color = hexToRgb(this.color);
    for (const cv of $('modal-body').querySelectorAll('canvas[data-skin]')) paintSkinPreview(cv, cv.dataset.skin, color);
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

  // Each map and size suggests how many nations and tribes share it.
  applyRecommendedCounts() {
    const type = $('opt-type').value, size = $('opt-size').value;
    const ai = recommendedRivals(type, size), tribes = recommendedTribes(type, size);
    if (ai) { $('opt-ai').value = ai; $('opt-ai-out').textContent = ai; }
    if (tribes !== undefined) { $('opt-tribes').value = tribes; $('opt-tribes-out').textContent = tribes; }
    this.updateWorldSummary();
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
    this.prefs = { ...this.prefs, name, type: $('opt-type').value, size: $('opt-size').value, numAI, numTribes: Number($('opt-tribes').value), diff, mode, modeV: MODE_PREFS_VERSION, color: this.color, v: PREFS_VERSION };
    savePrefs(this.prefs);
    if (this.isClient()) return;
    const game = new Game(this.map, { difficulty: diff, mode, multiplayer: !!this.net, placement: !this.net });
    if (this.net) {
      const humans = this.net.lobby.players.map((p) => ({ name: p.name, color: hexToRgb(p.color), peer: p.id, skin: p.skin }));
      game.setupPlayers({ humans, numAI, numTribes: Number($('opt-tribes').value), difficulty: diff });
      this.net.startMatch(game, this.map);
    } else {
      game.setupPlayers({ playerName: name, playerColor: hexToRgb(this.color), playerSkin: this.shop.equipped, numAI, numTribes: Number($('opt-tribes').value), difficulty: diff });
    }
    this.enterGame(game, 1);
  }

  // Everything that resets the screen for a new match, offline, hosted or joined.
  enterGame(game, myId) {
    this.game = game;
    this.myId = myId;
    // For leaderboard points: how many rivals and players the world started with.
    game.scoreRivals = game.players.filter((p) => p && !p.tribe && p.id !== myId).length;
    game.scoreHumans = game.players.filter((p) => p && p.human).length;
    this.updateGamesWatch();
    if (!game.multiplayer) this.cloud.rest();
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
      : game.placement ? 'Pick your starting spot. You can move it until the war begins.'
        : 'Click any unclaimed land to found your nation. Rivals are already on the map.';
    this.placeLeft = game.placement ? PLACE_SECONDS : 0;
    this.placeText = '';
    $('btn-place-go').hidden = true;
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
    if (this.tutorial && this.tutorial.spawnTile() >= 0) { this.spawn(this.tutorial.spawnTile()); return; }
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

  // Found the nation, or, before the war begins, move it.
  spawn(tile) {
    const g = this.game;
    if (this.me.spawned && (g.started || this.tutorial)) return;
    if (this.tutorial && !this.tutorial.spawnOk(tile)) { this.notice('Click inside the gold ring.', true); return; }
    const first = !this.me.spawned;
    const res = this.cmd('spawn', { tile }, true);
    if (res && res.bad) { this.notice(first ? res.msg : 'Pick unclaimed land, or your own.', true); return; }
    if (res && first) this.onSpawned(tile);
  }

  // Called once our nation exists (right away offline, or when the host confirms it).
  onSpawned(tile) {
    const g = this.game;
    this.spawnedShown = true;
    // Until the war begins, clicking the map moves the nation, and the controls stay hidden.
    this.r.mode = g.started ? null : { kind: 'spawn' };
    $('hud').hidden = !g.started;
    $('spawn-banner').hidden = g.started;
    if (tile >= 0) {
      const x = tile % g.W, y = (tile - x) / g.W;
      this.r.centerOn(x + 0.5, y + 0.5, Math.max(this.r.minZoom() * 2.5, 4));
    }
    this.updateHud(true);
    if (this.tutorial) this.tutorial.check();
  }

  // Single player's placement phase: count down (paused with the game), let the computer
  // nations shift, and start the war at zero or when the player presses Start now.
  placementFrame(dt) {
    const g = this.game;
    if (!this.isPaused()) {
      this.placeLeft -= dt / 1000;
      g.placementTick(dt / 1000, this.placeLeft);
    }
    const left = Math.max(0, Math.ceil(this.placeLeft)), placed = this.me.spawned;
    const text = !placed ? `Pick your starting spot. You can move it until the war begins in ${left}s.`
      : this.placeLeft > PLACE_SETTLE ? `Click elsewhere to move. Rivals are still choosing their spots. The war begins in ${left}s.`
        : `Rivals have settled. Click elsewhere to move. The war begins in ${left}s.`;
    if (text !== this.placeText) {
      this.placeText = text;
      $('spawn-banner').querySelector('p').textContent = text;
      $('btn-place-go').hidden = !placed;
    }
    if (this.placeLeft <= 0) this.finishPlacement();
  }

  finishPlacement() {
    const g = this.game;
    if (!g || g.started || g.multiplayer) return;
    if (!this.me.spawned) this.randomSpawn();
    g.begin();
    this.r.mode = null;
    $('spawn-banner').hidden = true;
    $('btn-place-go').hidden = true;
    $('hud').hidden = false;
    if (!this.spawnedShown) this.onSpawned(this.me.capital);
    const c = this.me.capital, x = c % g.W, y = (c - x) / g.W;
    this.r.centerOn(x + 0.5, y + 0.5, Math.max(this.r.cam.zoom, this.r.minZoom() * 2.5, 4));
    this.updateHud(true);
  }

  backToMenu() {
    // Leaving a game you have played for a few minutes still earns crowns for what you held.
    const g = this.game;
    // Tutorials pay their own one-off reward instead.
    if (g && g.started && !g.over && !g.coached && g.time >= 180) this.awardGame();
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
    this.cloud.online();
    this.updateGamesWatch();
    this.renderAccount();
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
      // The advisor card sits above the wars panel and pushes it down while it is open.
      const t = $('tutorial').offsetHeight;
      root.setProperty('--tut-h', t ? `${t + 10}px` : '0px');
    };
    if (window.ResizeObserver) { const ro = new ResizeObserver(measure); for (const id of ['topbar', 'command', 'dock', 'tutorial']) ro.observe($(id)); }
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
    const sp = document.createElement('button');
    sp.type = 'button';
    sp.className = 'bbtn missile space';
    sp.title = `Space missile: reaches anywhere and passes over air defense while in space; only defenses near its launch or landing can shoot it down. Needs the Spaceflight research and a silo of level ${SPACE_SILO_LEVEL} or more. (key N)`;
    sp.innerHTML = `<span class="hk">N</span><canvas width="60" height="60" style="width:30px;height:30px"></canvas><span class="nm">Space missile</span><span class="cost"></span>`;
    sp.addEventListener('click', () => this.toggleMissile(true));
    builds.appendChild(sp);
    this.spaceBtn = sp;
    const ws = document.createElement('button');
    ws.type = 'button';
    ws.className = 'bbtn warship';
    ws.innerHTML = `<span class="hk">B</span><canvas width="60" height="60" style="width:30px;height:30px"></canvas><span class="nm">Warship</span><span class="cost"></span>`;
    ws.addEventListener('click', () => this.toggleWarship());
    builds.appendChild(ws);
    this.warshipBtn = ws;
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
      if (this.compact()) this.setBoardOpen(false);
    });
    // Phones: the nations list opens from your rank, and a button finds your nation.
    $('btn-board').addEventListener('click', () => this.setBoardOpen(!$('hud').classList.contains('board-open')));
    $('btn-home').addEventListener('click', () => {
      if (!this.game || !this.me) return;
      const L = this.me.label;
      this.r.centerOn(L.x, L.y, Math.max(this.r.cam.zoom, 3));
    });
  }

  // The compact phone layout is in use (see the matching media query in style.css).
  compact() { return window.matchMedia('(max-width: 760px), (max-height: 520px)').matches; }
  setBoardOpen(open) {
    $('hud').classList.toggle('board-open', open);
    $('btn-board').setAttribute('aria-expanded', String(open));
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
    const sc = this.spaceBtn.querySelector('canvas').getContext('2d');
    sc.clearRect(0, 0, 60, 60);
    drawBuildingIcon(sc, 'space', 30, 30, 40, [126, 104, 214], false);
    const wc = this.warshipBtn.querySelector('canvas').getContext('2d');
    wc.clearRect(0, 0, 60, 60);
    drawBuildingIcon(wc, 'warship', 30, 30, 40, color, false);
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

  // A short line above the dock; a warning, if any, sits under it in amber and keeps it up longer.
  notice(text, bad, warn) {
    const n = $('notice');
    n.textContent = text;
    if (warn) {
      const w = document.createElement('span');
      w.className = 'nw';
      w.textContent = warn;
      n.append(w);
    }
    n.classList.toggle('bad', !!bad);
    n.classList.toggle('warn', !!warn);
    n.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => n.classList.remove('show'), warn ? 4500 : 2600);
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
    const g = this.game;
    if (g && !g.started && g.placement && !this.tutorial) this.placementFrame(dt);
    // A multiplayer match has begun: clicks no longer move the nation.
    if (g && g.started && this.spawnedShown && this.r.mode && this.r.mode.kind === 'spawn') {
      this.r.mode = null;
      $('spawn-banner').hidden = true;
      $('hud').hidden = false;
      this.updateHud(true);
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
    $('v-troops').closest('.stat').classList.toggle('low', me.alive && me.troops < cap * LOW_TROOPS);
    const gr = $('v-growth');
    gr.textContent = `${me.growth >= 0 ? '+' : ''}${fmt(me.growth * 60)}/min`;
    gr.classList.toggle('neg', me.growth < 0);
    $('v-income').textContent = `${me.income >= 0 ? '+' : ''}${fmtMoney(me.income * 60)}/min`;
    const share = g.landShare(me);
    $('v-land').textContent = fmtPct(share * 100);
    $('v-tiles').textContent = `${fmt(me.tiles)} tiles`;
    $('v-landbar').style.width = `${Math.min(100, share * 100)}%`;
    // "left" drops away on phones, where the row is short of room.
    const clock = g.mode.endYear ? fmtTime(Math.max(0, (g.mode.endYear - START_YEAR) * g.mode.secPerYear - g.time)) : fmtTime(g.time);
    const clockHtml = g.mode.endYear ? `${clock}<span class="lf"> left</span>` : clock;
    if (clockHtml !== this.clockHtml) { $('v-time').innerHTML = clockHtml; $('v-time').title = g.mode.endYear ? `${clock} left` : ''; this.clockHtml = clockHtml; }
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
    const mc = g.missileCost(me), sc = g.missileCost(me, 'space'), mm = this.r.mode && this.r.mode.kind === 'missile' ? this.r.mode : null;
    this.missileBtn.querySelector('.cost').textContent = me.counts.silo ? fmtMoney(mc) : 'Needs silo';
    this.missileBtn.classList.toggle('poor', !me.counts.silo || me.gold < mc || !g.readySilo(me));
    this.missileBtn.classList.toggle('on', !!(mm && !mm.space));
    const spaceOk = g.canSpace(me);
    this.spaceBtn.querySelector('.cost').textContent = spaceOk ? fmtMoney(sc) : !g.hasSpaceTech(me) ? 'Research Spaceflight' : `Needs level ${SPACE_SILO_LEVEL} silo`;
    this.spaceBtn.classList.toggle('poor', !spaceOk || me.gold < sc || !g.readySilo(me, 'space'));
    this.spaceBtn.classList.toggle('on', !!(mm && mm.space));
    const wcost = g.warshipCost(me), wn = g.warshipsOf(this.myId), wcap = g.warshipCap(me);
    this.warshipBtn.querySelector('.cost').textContent = !me.counts.harbor ? 'Needs harbor' : wn >= wcap ? `${wn}/${wcap} at sea` : fmtMoney(wcost);
    this.warshipBtn.classList.toggle('poor', !me.counts.harbor || wn >= wcap || me.gold < wcost);
    this.warshipBtn.classList.toggle('on', !!(this.r.mode && this.r.mode.kind === 'warship'));
    const wtitle = `Warship: stands guard where you send it, sinks fleets sailing for you or your allies, and fights nations at war with you. ${wn} of ${wcap} at sea; one per harbor level, up to ${WARSHIP_MAX}. Right-click the sea to move one. (key B)`;
    if (this.warshipBtn.title !== wtitle) this.warshipBtn.title = wtitle;

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
      const ally = (p.human && p.id !== this.myId ? '<span class="ally pl">Player</span>' : '') + persTag(p) + stanceTags(g, this.myId, p);
      const share = g.landShare(p) * 100;
      return `<li data-pid="${p.id}" class="${p.id === this.myId ? 'me' : ''}" style="--c:${rgbCss(p.color)}"><span class="rk">${rank}</span><span class="nm">${esc(p.name)}${ally}</span><span class="ld">${fmtPct(share)}</span><span class="tr">${fmt(p.troops)}</span></li>`;
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
    $('my-rank').textContent = myRank >= 0 ? myRank + 1 : '–';
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
        inc.push(`<div class="front in" style="--c:#e0533d"><span class="nm">${m.kind === 'space' ? 'Space missile' : 'Missile'} from ${esc(g.players[m.owner].name)}</span><span class="tr">${eta}s</span><span></span></div>`);
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
      if (e.alert && e.to === this.myId) this.showAlert(e);
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
    let shown = this.toastEls.size;
    const maxOffers = this.compact() ? 1 : MAX_OFFERS;
    for (const r of g.requests) {
      if (r.to !== this.myId) continue;
      live.add(r.id);
      const p = g.players[r.from];
      let el = this.toastEls.get(r.id);
      if (!el) {
        if (shown >= maxOffers) continue;
        shown++;
        el = document.createElement('div');
        el.className = 'toast offer';
        el.style.setProperty('--c', rgbCss(p.color));
        const renew = g.isAllied(this.myId, r.from);
        const al = allyList(g, p, this.myId);
        el.innerHTML = `<p><b>${esc(p.name)}</b> ${renew ? 'wants to renew your alliance for five more minutes.' : 'proposes an alliance for five minutes.'}${!renew ? `<span class="toast-sub">${al ? `Allied with ${al}.` : 'No other allies.'}</span>` : ''}</p><div class="acts"><button type="button" class="primary" data-a="1">Accept</button><button type="button" class="ghost" data-a="0">Decline</button></div><div class="timer"></div>`;
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
    const pct = (p) => fmtPct(g.landShare(p) * 100);
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

  // Place a warship: click the sea where it should stand guard.
  toggleWarship() {
    const g = this.game;
    if (!g || !g.started || !this.me.alive) return;
    if (this.r.mode && this.r.mode.kind === 'warship') { this.r.mode = null; this.updateHud(true); return; }
    if (!this.me.counts.harbor) { this.notice('Warships are launched from a harbor. Build one first.', true); return; }
    this.r.mode = { kind: 'warship' };
    this.notice('Click the sea where the warship should stand guard. It sinks fleets sailing for you or your allies, and fights nations at war with you.');
    this.updateHud(true);
  }

  // Aim a missile, or a space missile. The map shows air defense coverage and, for missiles, your
  // silos' reach.
  toggleMissile(space = false) {
    const g = this.game;
    if (!g || !g.started || !this.me.alive) return;
    const m = this.r.mode;
    if (m && m.kind === 'missile' && !!m.space === space) { this.r.mode = null; this.updateHud(true); return; }
    if (!this.me.counts.silo) { this.notice('Build a missile silo first.', true); return; }
    if (space && !g.hasSpaceTech(this.me)) { this.notice('Space missiles need the Spaceflight research. Open Technology (T) to research it.', true); return; }
    if (space && !g.hasSpaceSilo(this.me)) { this.notice(`Space missiles launch from a silo of level ${SPACE_SILO_LEVEL} or more. Build on top of a silo to stack it.`, true); return; }
    this.r.mode = { kind: 'missile', space };
    this.notice(space ? 'Click a target anywhere. Only air defense near the launch or the landing can stop a space missile.'
      : 'Click a target within reach of your silos (dashed circles). Red circles are air defense that would shoot it down.');
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
    if (mode && mode.kind === 'warship') {
      const res = this.cmd('warship', { tile });
      if (!shift && !(res && res.bad)) this.r.mode = null;
      return;
    }
    if (mode && mode.kind === 'missile') {
      const res = this.cmd('missile', { tile, kind: mode.space ? 'space' : 'missile' });
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
    this.lastCtx = { own: o === my, at: performance.now() };
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
      // Warships: a new one to guard this spot, or the nearest of yours moved here.
      if (me.counts.harbor) {
        const n = g.warshipsOf(my), cap = g.warshipCap(me), cost = g.warshipCost(me);
        const err = n >= cap ? `All ${cap} of your warships are at sea.` : me.gold < cost ? `Needs ${fmtMoney(cost)}.` : '';
        items.push({ label: 'Send a warship to guard here', icon: 'warship', cost: fmtMoney(cost), disabled: !!err, title: err, act: () => this.cmd('warship', { tile }) });
      }
      if (g.warshipsOf(my)) items.push({ label: 'Move your nearest warship here', icon: 'warship', act: () => this.cmd('warshipmove', { tile }) });
    }
    if (me.alive && !water) {
      if (o === my) {
        // What stands here already: a site to call off, or a building to tear down.
        const site = this.siteNear(tile), own = this.buildingNear(tile);
        if (site) {
          items.push({ label: `Cancel ${BUILDINGS[site.type].name.toLowerCase()} (${Math.ceil(site.left / TPS)}s left)`, icon: site.type, cost: site.cost ? `+${fmtMoney(nicePrice(site.cost * 0.5))}` : '', danger: true,
            title: 'Stops the work and pays back half of what it cost.', act: () => this.cmd('demolish', { tile: site.tile }) });
        } else if (own) {
          items.push({ label: `Demolish ${BUILDINGS[own.type].name.toLowerCase()}${own.level > 1 ? ` (level ${own.level})` : ''}`, icon: own.type, cost: `+${fmtMoney(nicePrice(BUILDINGS[own.type].base * own.level * DEMOLISH_REFUND))}`, danger: true,
            title: 'Tears it down for a quarter of its price, freeing the ground.', act: () => this.cmd('demolish', { tile: own.tile }) });
        }
        if (site || own) items.push({ sep: true });
        for (const type of BUILD_ORDER) {
          if (!g.buildingAvailable(type)) continue;
          const err = g.canBuild(me, type, tile);
          const up = g.stackTarget(me, type, tile);
          items.push({ label: up ? `Upgrade ${BUILDINGS[type].name.toLowerCase()} to level ${up.level + 1}` : `Build ${BUILDINGS[type].name.toLowerCase()}`, icon: type, cost: fmtMoney(g.buildCost(me, type)), disabled: !!err,
            title: err || `${BUILDINGS[type].desc} Takes ${BUILD_SECONDS[type]}s to build.`,
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
          for (const kind of g.canSpace(me) ? ['missile', 'space'] : ['missile']) {
            const cost = g.missileCost(me, kind), plan = g.missilePlan(me, tile, kind);
            const err = plan.err || (me.gold < cost ? `Needs ${fmtMoney(cost)}.` : '');
            const warn = !err && plan.aa ? `${g.players[plan.aa.owner].name}'s air defense would shoot it down.` : '';
            items.push({ label: kind === 'space' ? 'Launch space missile here' : 'Launch missile here', icon: kind, cost: fmtMoney(cost), disabled: !!err, title: err || warn, danger: true,
              act: () => this.cmd('missile', { tile, kind }) });
          }
        }
      }
      if (o && o !== my) {
        const p = g.players[o];
        items.push({ sep: true });
        if (g.isAllied(my, o)) {
          const amt = Math.floor(me.troops * 0.25), left = g.allianceLeft(my, o);
          items.push({ label: `Send ${fmt(amt)} troops`, act: () => this.cmd('troops', { to: o, ratio: 0.25 }) });
          items.push({ label: left <= RENEW_SECONDS ? `Renew alliance (${fmtTime(left)} left)` : `Alliance ends in ${fmtTime(left)}`, disabled: left > RENEW_SECONDS,
            title: 'Alliances last five minutes. You can renew one in its last two.', act: () => this.cmd('ally', { to: o }) });
          items.push({ label: 'Break alliance', danger: true, act: () => this.cmd('unally', { to: o }) });
        } else {
          if (!p.tribe) items.push({ label: 'Propose alliance', act: () => this.cmd('ally', { to: o }) });
        }
        const gold = Math.floor(me.gold * 0.25);
        items.push({ label: `Send ${fmtMoney(gold)}`, title: 'Gifts improve how they feel about you.', disabled: gold < 1,
          act: () => this.cmd('gold', { to: o, ratio: 0.25 }) });
        if (!p.tribe) {
          const banned = me.tradeBan.has(o);
          items.push(banned
            ? { label: 'Resume trading', title: 'Trade by sea and across the border again.', act: () => this.cmd('trade', { to: o, stop: false }) }
            : { label: 'Stop trading', danger: true, title: 'Cuts trade by sea and across the border, both ways. They will resent it.', act: () => this.cmd('trade', { to: o, stop: true }) });
        }
        if (p.human) sub += ', a player';
        else {
          const [rl] = relLabel(g.getRel(o, my));
          sub += `${persOf(p) ? `, ${PERSONALITY_ICON[persOf(p)].label.toLowerCase()}` : ''}, ${rl.toLowerCase()} toward you`;
        }
      }
    }
    if (!items.length) return;

    const el = $('ctx');
    el.innerHTML = `<div class="ctx-head"><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
    // Touch screens have no hover, so the menu carries what the tooltip would say.
    if (this.touchUi && !water) {
      const { rows } = this.tileInfo(tile);
      const info = document.createElement('div');
      info.className = 'ctx-info';
      info.innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
      el.appendChild(info);
    }
    // Buildings and missiles carry the same icon as on the map and in the bottom bar; when any
    // item has one, the rest keep the same indent so the labels line up.
    const icons = items.some((it) => it.icon);
    for (const it of items) {
      if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; el.appendChild(s); continue; }
      const b = document.createElement('button');
      b.type = 'button';
      b.disabled = !!it.disabled;
      if (it.danger) b.className = 'danger';
      if (it.title) b.title = it.title;
      b.innerHTML = `${icons ? '<span class="ci"></span>' : ''}<span class="l">${esc(it.label)}</span>${it.cost ? `<span class="c">${esc(it.cost)}</span>` : ''}`;
      if (it.icon) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 48;
        drawBuildingIcon(cv.getContext('2d'), it.icon, 24, 24, 36, it.icon === 'missile' ? [214, 90, 60] : it.icon === 'space' ? [126, 104, 214] : me.color, !!it.disabled);
        b.querySelector('.ci').appendChild(cv);
      }
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

  // Your construction site or building at (or right next to) a tile.
  siteNear(tile) {
    const g = this.game, W = g.W, x0 = tile % W, y0 = (tile - x0) / W;
    return (g.sites || []).find((x) => x.owner === this.myId && Math.max(Math.abs(x.tile % W - x0), Math.abs(Math.floor(x.tile / W) - y0)) <= 1) || null;
  }
  buildingNear(tile) {
    const g = this.game, W = g.W, x0 = tile % W, y0 = (tile - x0) / W;
    for (let y = y0 - 1; y <= y0 + 1; y++) {
      for (let x = x0 - 1; x <= x0 + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= g.H) continue;
        const bi = g.bldAt[y * W + x];
        if (bi >= 0 && g.buildings[bi].alive && g.buildings[bi].owner === this.myId) return g.buildings[bi];
      }
    }
    return null;
  }

  // An alert card for an event that matters to you: what happened, and a button to act on it
  // (look at it, renew an alliance, send a gift). Threats are red, warnings amber, good news
  // green. Repeats from the same nation are held back, and only a few cards show at once.
  showAlert(e) {
    const A = ALERTS[e.alert], g = this.game;
    if (!A || !g || !this.me || !this.me.alive) return;
    const mode = this.prefs.alerts || 'all';
    if (mode === 'off' || (mode === 'threats' && !A.threat)) return;
    const key = `${e.alert}:${e.who || e.at}`, now = performance.now();
    if (now - (this.alertSeen.get(key) || -1e9) < (A.quiet || 8) * 1000) return;
    this.alertSeen.set(key, now);
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = `toast alert ${A.tone}`;
    const who = e.who ? g.players[e.who] : null;
    const acts = [];
    if (A.show && this.alertTarget(e, A.show) >= 0) acts.push(['show', 'Show me', 'primary']);
    if (A.act === 'renew' && who && who.alive) acts.push(['ally', 'Renew alliance', acts.length ? 'ghost' : 'primary']);
    if (A.act === 'propose' && who && who.alive) acts.push(['ally', 'Propose again', 'ghost']);
    if (A.act === 'gift' && who && who.alive && this.me.gold >= 1) acts.push(['gift', `Send ${fmtMoney(nicePrice(this.me.gold * 0.1))}`, 'ghost']);
    acts.push(['close', 'Dismiss', 'ghost']);
    el.innerHTML = `<p><b>${A.title}</b> ${esc(e.text.replace(/^Revolt! /, ''))}</p>
      <div class="acts">${acts.map(([a, label, cls]) => `<button type="button" class="${cls}" data-a="${a}">${esc(label)}</button>`).join('')}</div><div class="timer"></div>`;
    if (who) el.style.setProperty('--who', rgbCss(who.color));
    const born = now, life = A.life * 1000;
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-a]');
      // A tap on the card itself dismisses it.
      if (!b) { el.remove(); return; }
      if (!this.game) return;
      const a = b.dataset.a;
      if (a === 'show') {
        const t = this.alertTarget(e, A.show), W = this.game.W;
        if (t >= 0) this.r.centerOn(t % W + 0.5, Math.floor(t / W) + 0.5, Math.max(this.r.cam.zoom, 3));
      } else if (a === 'ally') this.cmd('ally', { to: e.who });
      else if (a === 'gift') this.cmd('gold', { to: e.who, ratio: 0.1 });
      el.remove();
    });
    const tick = () => {
      if (!el.isConnected) return;
      const f = 1 - (performance.now() - born) / life;
      if (f <= 0) { el.remove(); return; }
      el.querySelector('.timer').style.width = `${f * 100}%`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // A revolt supersedes the warnings that came before it.
    if (e.alert === 'revolt') for (const w of box.querySelectorAll('.toast.alert[data-kind="unrest"]')) w.remove();
    el.dataset.kind = e.alert;
    box.prepend(el);
    const cards = box.querySelectorAll('.toast.alert');
    for (let k = this.compact() ? 2 : MAX_ALERTS; k < cards.length; k++) cards[k].remove();
    if (A.threat && A.tone === 'bad') buzz([30, 40, 30]);
    // The map already marks where unrest is brewing; a revolt gets a flare of its own.
    if (A.flare && e.at >= 0) this.r.alerts.push({ tile: e.at, label: A.title, until: now + 15000 });
    if (A.flash) {
      const f = $('flash');
      f.classList.remove('boom');
      void f.offsetWidth;
      f.classList.add('boom');
    }
  }

  // Where "Show me" goes for an alert: the event's tile, the front where a nation attacks you,
  // your capital, or the other nation.
  alertTarget(e, how) {
    const g = this.game, W = g.W;
    if (how === 'at') return e.at;
    if (how === 'capital') return this.me.capital;
    if (how === 'front') {
      const a = g.attacks.find((x) => !x.dead && x.attacker === e.who && x.target === this.myId);
      const tiles = a && (a.fs || a.frontier);
      if (tiles && tiles.length) {
        let cx = 0, cy = 0;
        for (const t of tiles) { cx += t % W; cy += Math.floor(t / W); }
        return Math.round(cy / tiles.length) * W + Math.round(cx / tiles.length);
      }
    }
    const p = e.who ? g.players[e.who] : null;
    return p && p.alive && p.label.tile >= 0 ? p.label.tile : -1;
  }

  // What the tooltip says about a tile: its owner and their figures, how they stand toward you,
  // control, terrain and any building. On touch screens the long-press menu shows it too.
  tileInfo(tile) {
    const g = this.game;
    const o = g.owner[tile];
    const ter = TERRAIN[g.map.terrain[tile]];
    const rows = [];
    let head;
    if (o) {
      const p = g.players[o];
      head = `<span class="dot" style="background:${rgbCss(p.color)}"></span>${esc(p.name)}${o === this.myId ? ' (you)' : p.human ? ' (player)' : ''}${persTag(p)}${stanceTags(g, this.myId, p)}`;
      if (persOf(p)) rows.push(['Led by', `Computer, ${PERSONALITY_ICON[persOf(p)].label.toLowerCase()}`]);
      else if (p.tribe) rows.push(['Led by', 'A tribe']);
      rows.push(['Troops', fmt(p.troops)]);
      rows.push(['People', fmt(p.pop)]);
      rows.push(['Land', fmtPct(g.landShare(p) * 100)]);
      if (p.tribe) rows.push(['Stores', `<span class="rel-good">${fmtMoney(nicePrice(p.gold))}</span>`]);
      else if (p.ideology) rows.push(['Ideology', IDEOLOGY_BY_ID[p.ideology].name]);
      if (!p.tribe) {
        const al = allyList(g, p, this.myId);
        rows.push(['Allies', al ? `<span class="tt-list">${al}</span>` : '<span class="st-neutral">None</span>']);
        const wl = warList(g, p);
        if (wl) rows.push(['At war with', `<span class="tt-list">${wl}</span>`]);
      }
      if (g.politics) {
        const c = g.control[tile];
        rows.push(['Control here', `<span class="${c < 50 ? 'rel-bad' : ''}">${c}%${c < 50 ? (c <= 20 ? ' (occupied)' : ' (restless)') : ''}</span>`]);
      }
      if (o !== this.myId) {
        if (g.isAllied(this.myId, o)) rows.push(['Status', `<span class="rel-good">Your ally, ${fmtTime(g.allianceLeft(this.myId, o))} left</span>`]);
        else if (!p.human) {
          const v = g.getRel(o, this.myId);
          const [lbl, cls] = relLabel(v);
          rows.push(['Toward you', `<span class="${cls}">${lbl}</span>`]);
        }
        if (!p.tribe) { const tr = this.tradeText(p); if (tr) rows.push(['Trade', tr]); }
      }
    } else {
      head = g.fallout[tile] ? 'Scorched land' : 'Unclaimed land';
    }
    rows.push(['Terrain', `${ter.name}${ter.def !== 1 ? ` (defense ×${ter.def})` : ''}`]);
    const bi = g.bldAt[tile];
    const site = this.siteNear(tile);
    if (site) rows.push(['Building', `${site.upgrade >= 0 ? `${BUILDINGS[site.type].name}, upgrading to level ${site.level}` : `${BUILDINGS[site.type].name} under construction`}, ${Math.ceil(site.left / TPS)}s left`]);
    else if (bi >= 0) {
      const b = g.buildings[bi];
      rows.push(['Building', `${BUILDINGS[b.type].name}${b.level > 1 ? `, level ${b.level}` : ''}`]);
      if (b.type === 'silo' || b.type === 'aa') {
        const cap = g.shotsOf(b), next = b.ammo < cap && b.cooldown > 0 ? `, next in ${Math.ceil(b.cooldown / TPS)}s` : '';
        rows.push([b.type === 'silo' ? 'Missiles' : 'Shots', `${b.ammo || 0} of ${cap} loaded${next}`]);
        const owner = g.players[b.owner], space = (b.level || 1) >= SPACE_SILO_LEVEL && (b.owner !== this.myId || g.hasSpaceTech(owner));
        rows.push(b.type === 'silo' ? ['Reach', `${g.siloRange(b)} tiles${space && b.owner === this.myId ? ', and space missiles anywhere' : ''}`] : ['Covers', `${g.aaRadius(b)} tiles around it`]);
      }
    }

    return { head, rows, o };
  }

  // ---------- tooltip ----------
  updateTooltip() {
    const tt = $('tooltip');
    const g = this.game;
    if (!g || !this.mouse.inside || !$('ctx').hidden || this.modalOpen) { tt.hidden = true; return; }
    const tile = this.r.screenToTile(this.mouse.x, this.mouse.y);
    this.r.hoverTile = tile;
    if (tile >= 0 && g.isWater(tile) && this.r.mode && this.r.mode.kind === 'warship') {
      const me = this.me, n = g.warshipsOf(this.myId), cap = g.warshipCap(me), cost = g.warshipCost(me);
      const hint = n >= cap ? `All ${cap} of your warships are at sea` : me.gold < cost ? `A warship costs ${fmtMoney(cost)}` : `Click to send a warship here (${fmtMoney(cost)})`;
      tt.innerHTML = `<div class="tt-head"><span class="tt-name">Open sea</span></div><div class="tt-hint">${esc(hint)}</div>`;
      tt.hidden = false;
      this.placeTooltip(this.mouse.x, this.mouse.y);
      return;
    }
    if (tile < 0 || g.isWater(tile)) { tt.hidden = true; return; }
    const { head, rows, o } = this.tileInfo(tile);
    let hint = '';
    const mode = this.r.mode, me = this.me;
    if (mode && mode.kind === 'spawn') {
      hint = !me.spawned ? (g.canSpawnAt(tile) ? 'Click to found your nation here' : 'Already claimed')
        : o === this.myId ? 'Your starting spot' : g.canSpawnAt(tile) ? 'Click to move your nation here' : 'Already claimed';
    }
    else if (mode && mode.kind === 'build') hint = g.canBuild(me, mode.type, tile) || `Click to build (${fmtMoney(g.buildCost(me, mode.type))})`;
    else if (mode && mode.kind === 'missile') {
      const kind = mode.space ? 'space' : 'missile', plan = g.missilePlan(me, tile, kind);
      hint = plan.err || (plan.aa ? `${g.players[plan.aa.owner].name}'s air defense would shoot it down` : `Click to launch (${fmtMoney(g.missileCost(me, kind))})`);
    }
    else if (me.alive && g.started) {
      if (o === this.myId) hint = 'Right-click to build here';
      else if (g.isAllied(this.myId, o)) hint = 'Right-click to reinforce or send money';
      else if (o === 0 && g.fallout[tile]) hint = 'Scorched. Wait for it to clear.';
      else hint = (g.neighbors[this.myId].has(o) ? (o ? 'Click to attack' : 'Click to expand toward here') : 'Click to send a fleet') + ', right-click for more';
      if (o && g.players[o].tribe && !g.isFriendly(this.myId, o)) hint = `Absorb this tribe to take its stores. ${hint}`;
    }
    tt.innerHTML = `<div class="tt-head">${head}</div>${rows.map(([k, v]) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`).join('')}${hint ? `<div class="tt-hint">${esc(hint)}</div>` : ''}`;
    tt.hidden = false;
    this.placeTooltip(this.mouse.x, this.mouse.y);
  }

  placeTooltip(mx, my) {
    const tt = $('tooltip'), w = tt.offsetWidth, h = tt.offsetHeight;
    let x = mx + 18, y = my + 18;
    if (x + w > window.innerWidth - 8) x = mx - w - 12;
    if (y + h > window.innerHeight - 8) y = my - h - 12;
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
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      this.touchUi = e.pointerType !== 'mouse';
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
              buzz(12);
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
        if (this.modalOpen) { if (!this.modalLocked) this.closeModal(); return; }
        if (!$('ctx').hidden) { this.closeCtx(); return; }
        if (this.r.mode && this.r.mode.kind !== 'spawn') { this.r.mode = null; this.updateHud(true); return; }
        if (this.game && this.game.started && !this.r.mode) this.showGameMenu();
        return;
      }
      // With a nation screen open, its keys switch between the tabs.
      const TAB_KEYS = { t: 'tech', g: 'gov', i: 'ideo', p: 'dipl' };
      if (this.modalOpen && TAB_KEYS[k] && $('modal-body').querySelector('.nation-body')) {
        this.nationTab = TAB_KEYS[k];
        this.lastOpen = { tab: this.nationTab, at: performance.now() };
        this.nationMsg = '';
        this.renderNation();
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
      if (k === 'n') { this.toggleMissile(true); return; }
      if (k === 'b') { this.toggleWarship(); return; }
      if (k === 't' && g.started) { this.openNation('tech'); return; }
      if (k === 'g' && g.started) { this.openNation('gov'); return; }
      if (k === 'p' && g.started) { this.openNation('dipl'); return; }
      if (k === 'i' && g.started) { this.openNation('ideo'); return; }
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
    $('modal').querySelector('.modal-card').classList.toggle('paged', !!opts.paged);
    $('modal').hidden = false;
    this.modalOpen = true;
    this.modalLocked = !!opts.locked;    // a screen that must be answered with one of its buttons
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
    this.modalLocked = false;
    const body = $('modal-body');
    const fresh = body.cloneNode(false);
    body.replaceWith(fresh);
  }

  // How to play, one page per topic so nothing needs scrolling.
  showHelp(page = 'basics') {
    const wrap = document.createElement('div');
    wrap.appendChild($('help-tpl').content.cloneNode(true));
    const ul = wrap.querySelector('.bl');
    const color = this.game ? this.me.color : hexToRgb(this.color);
    for (const t of BUILD_ORDER) {
      const d = BUILDINGS[t];
      const li = document.createElement('li');
      const needs = d.tech ? `, needs ${TECH_BY_ID[d.tech].name} in Realistic` : '';
      const only = d.politics ? ' Realistic only.' : '';
      li.innerHTML = `<canvas width="52" height="52" style="width:26px;height:26px" data-t="${t}"></canvas><span><b>${d.name}</b> (${fmtMoney(d.base)}, key ${d.key}${needs}). ${d.desc}${only}</span>`;
      ul.appendChild(li);
    }
    const tabs = [...wrap.querySelectorAll('.help-page')].map((pg) => `<button type="button" role="tab" data-help="${pg.dataset.page}">${pg.dataset.title}</button>`).join('');
    const show = (id) => {
      for (const pg of $('modal-body').querySelectorAll('.help-page')) pg.hidden = pg.dataset.page !== id;
      for (const b of $('modal-body').querySelectorAll('[data-help]')) b.setAttribute('aria-selected', String(b.dataset.help === id));
    };
    this.openModal(`<div class="nation-top"><h2 id="modal-title">How to play</h2><div class="tabs" role="tablist">${tabs}</div>
      <button type="button" class="ghost nation-close" data-close>Close <kbd>Esc</kbd></button></div>
      <div class="nation-body help-body">${wrap.innerHTML}</div>`, {
      wide: true, paged: true,
      onClick: (e) => { const b = e.target.closest('[data-help]'); if (b) show(b.dataset.help); },
    });
    show(page);
    for (const cv of $('modal-body').querySelectorAll('canvas[data-t]')) {
      drawBuildingIcon(cv.getContext('2d'), cv.dataset.t, 26, 26, 36, color, false);
    }
  }

  // The nation screens: one page each for technology, government, ideology and diplomacy, sized
  // to the window so none of them needs scrolling.
  openNation(tab) {
    const g = this.game;
    if (!g || !g.started) return;
    this.nationTab = ['gov', 'ideo', 'dipl'].includes(tab) ? tab : 'tech';
    this.lastOpen = { tab: this.nationTab, at: performance.now() };
    this.nationMsg = '';
    this.techEra = null;
    this.diplPage = 0;
    this.ideoChanging = false;
    this.openModal(this.nationHtml(), { wide: true, paged: true, onClick: (e) => this.onNationClick(e), onInput: (e) => this.onNationInput(e) });
    this.fitDiplomacy();
  }

  renderNation() {
    $('modal-body').innerHTML = this.nationHtml();
    this.fitDiplomacy();
  }

  // Diplomacy shows as many rows as the window has room for and pages through the rest; its
  // column heads for buildings carry their icons.
  fitDiplomacy() {
    const body = $('modal-body').querySelector('.nation-body');
    const cols = body && body.querySelector('.dipl-cols');
    if (!cols) return;
    const row = cols.querySelector('tbody tr'), head = cols.querySelector('thead');
    const pager = body.querySelector('.pager');
    const room = cols.clientHeight + (pager ? 0 : 58) - (head ? head.offsetHeight : 30) - 4;
    const per = Math.max(3, Math.floor(room / (row ? row.offsetHeight : 40)));
    if (per !== this.diplPer) {
      this.diplPer = per;
      $('modal-body').innerHTML = this.nationHtml();
    }
    const color = this.me.color;
    for (const cv of $('modal-body').querySelectorAll('canvas[data-bi]')) drawBuildingIcon(cv.getContext('2d'), cv.dataset.bi, 20, 20, 30, color, false);
  }

  onNationClick(e) {
    const g = this.game, me = this.me;
    if (e.target.closest('[data-close]')) { this.closeModal(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab) { this.nationTab = tab.dataset.tab; this.lastOpen = { tab: this.nationTab, at: performance.now() }; this.nationMsg = ''; this.renderNation(); return; }
    const chg = e.target.closest('[data-ideo-change]');
    if (chg) { this.ideoChanging = chg.dataset.ideoChange === '1'; this.nationMsg = ''; this.renderNation(); return; }
    const eraTab = e.target.closest('[data-era]');
    if (eraTab) { this.techEra = Number(eraTab.dataset.era); this.nationMsg = ''; this.renderNation(); return; }
    const srt = e.target.closest('[data-dsort]');
    if (srt) { this.diplSort = srt.dataset.dsort; this.diplPage = 0; this.nationMsg = ''; this.renderNation(); return; }
    const pg = e.target.closest('[data-dpage]');
    if (pg) { this.diplPage = (this.diplPage || 0) + Number(pg.dataset.dpage); this.nationMsg = ''; this.renderNation(); return; }
    const tech = e.target.closest('[data-tech]');
    if (tech) {
      const res = me.alive ? this.cmd('research', { id: tech.dataset.tech }, true) : { msg: 'Your nation has fallen.', bad: true };
      this.nationMsg = res ? res.msg : 'Order sent.';
      this.nationMsgBad = !!(res && res.bad);
      this.renderNation();
      return;
    }
    if (e.target.matches && e.target.matches('input[data-auto="islands"]')) {
      const res = this.cmd('autoislands', { on: e.target.checked }, true);
      this.nationMsg = res ? res.msg : (e.target.checked ? 'Your fleets will finish off nations left on small islands.' : 'Your fleets will only sail when you send them.');
      this.nationMsgBad = false;
      this.renderNation();
      return;
    }
    // A nation's name takes you to it on the map.
    const go = e.target.closest('[data-goto]');
    if (go && !e.target.closest('button')) {
      const p = this.game.players[Number(go.dataset.goto)];
      if (p && p.alive) { this.closeModal(); this.r.centerOn(p.label.x, p.label.y, Math.max(this.r.cam.zoom, 2.5)); }
      return;
    }
    const dip = e.target.closest('[data-dip]');
    if (dip && me.alive) {
      const args = dip.dataset.to ? { to: Number(dip.dataset.to) } : {};
      if (dip.dataset.stop !== undefined) args.stop = dip.dataset.stop === '1';
      const res = this.cmd(dip.dataset.dip, args, true);
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
      if (!res || !res.bad) this.ideoChanging = false;
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
      const kind = act.dataset.gov;
      const res = kind === 'martial' ? this.cmd('martial', { on: !me.martial }, true) : kind === 'tax' ? this.cmd('taxrelief', { on: !me.taxRelief }, true) : this.cmd('celebrate', {}, true);
      this.nationMsg = !res ? 'Order sent.' : res.bad ? res.msg : kind === 'celebrate' ? 'Celebrations begin across the land.' : kind === 'tax' ? (me.taxRelief ? 'Taxes lowered.' : 'Taxes restored.') : me.martial ? 'Martial law declared.' : 'Martial law lifted.';
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
    return `<div class="budget" title="More money means faster technology but less to build with. Nothing is spent while there's nothing to research.">
      <label for="sci-range"><b>Research budget</b><span>The share of your income spent on research</span></label>
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
    const tab = (id, label) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${this.nationTab === id}">${label}</button>`;
    const tabs = `<div class="tabs" role="tablist">${tab('tech', 'Technology <kbd>T</kbd>')}${tab('gov', 'Government <kbd>G</kbd>')}${tab('ideo', 'Ideology <kbd>I</kbd>')}${tab('dipl', 'Diplomacy <kbd>P</kbd>')}</div>`;
    const msg = this.nationMsg ? `<p class="nation-msg${this.nationMsgBad ? ' bad' : ''}" role="status">${esc(this.nationMsg)}</p>` : '';
    const t = this.nationTab;
    const content = t === 'gov' ? this.govHtml() : t === 'ideo' ? this.ideologyHtml() : t === 'dipl' ? this.diplHtml() : this.techHtml();
    const title = { gov: 'Government', ideo: 'Ideology', dipl: 'Diplomacy', tech: 'Technology' }[t];
    return `<div class="nation-top"><h2 id="modal-title">${title}</h2>${tabs}<button type="button" class="ghost nation-close" data-close>Back to the map <kbd>Esc</kbd></button></div>
      <div class="nation-body tab-${t}">${content}</div>${msg}`;
  }

  // Technology: what you're researching and the budget on top, then one era at a time, chosen
  // from a strip that shows how far you've got through each.
  techHtml() {
    const g = this.game, me = this.me, era = eraIndex(g.year);
    const cur = me.research ? TECH_BY_ID[me.research] : null;
    const rate = me.rpRate;
    const eta = (t) => {
      const left = g.techCost(me, t) - (me.progress[t.id] || 0);
      return rate > 0 ? Math.ceil(left / rate) : Infinity;
    };
    const state = {};
    for (const t of TECHS) state[t.id] = g.techState(me, t);
    // The era shown: the one picked, else the one being researched, else the first with
    // something to research, else the present.
    let sel = this.techEra;
    if (sel === null || sel === undefined) {
      const open = TECHS.find((t) => state[t.id] === 'avail');
      sel = cur ? cur.era : open ? open.era : era;
    }
    const span = (e) => (e < ERAS.length - 1 ? `${ERAS[e].from}–${ERAS[e + 1].from - 1}` : `${ERAS[e].from} on`);
    const strip = ERAS.map((E, e) => {
      const ts = TECHS.filter((t) => t.era === e);
      const known = ts.filter((t) => state[t.id] === 'done').length;
      const open = ts.filter((t) => state[t.id] === 'avail').length;
      const later = g.mode.timeGate && e > era;
      const note = later ? `from ${E.from}` : known === ts.length ? 'complete' : open ? `${open} open` : '';
      return `<button type="button" role="tab" class="era-tab${e === era ? ' now' : ''}${later ? ' later' : ''}" data-era="${e}" aria-selected="${e === sel}">
        <span class="et-head"><b>${E.name}</b>${cur && cur.era === e ? '<i class="et-busy" title="Researching here"></i>' : ''}</span>
        <span class="et-years">${span(e)}${e === era ? ', now' : ''}</span>
        <span class="et-bar"><i style="width:${known / ts.length * 100}%"></i></span>
        <span class="et-note"><span>${known} of ${ts.length} known</span><span>${note}</span></span>
      </button>`;
    }).join('');
    let cards = '';
    for (const t of TECHS.filter((x) => x.era === sel)) {
      const st = state[t.id];
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
        <span class="td">${esc(techDesc(t, g.mode))}${!g.politics && t.kind === 'gov' ? ' Stability and administration don\'t apply in Blitz.' : ''}</span>
        <span class="tf">${esc(foot)}</span>${bar}
      </button>`;
    }
    const status = cur
      ? `<b>Researching ${esc(cur.name)}</b>, ${Math.floor((me.progress[cur.id] || 0) / g.techCost(me, cur) * 100)}% done, about ${fmtDuration(eta(cur))} to go.`
      : '<b>Nothing is being researched.</b> Pick a technology below.';
    const why = `${rate.toFixed(1)} research per second from your people, universities and budget. Each technology you know makes the next cost more.` +
      (g.mode.timeGate ? ' Later eras open as the years pass.' : '');
    return `<div class="tech-head">
        <div class="tech-status"><p>${status}</p><p class="fine">${esc(why)}</p></div>
        ${this.budgetHtml()}
      </div>
      <div class="era-strip" role="tablist" aria-label="Eras">${strip}</div>
      <div class="tech-grid">${cards}</div>`;
  }

  // Diplomacy as a leaderboard: every nation ranked, with its land, army, people, income,
  // buildings and research, how it stands toward you, and alliances. Columns sort on click;
  // fitDiplomacy sets how many rows fit, and the rest are on further pages.
  // How you trade with a nation, for tooltips: stopped, refused, or by sea and across the border.
  tradeText(p) {
    const g = this.game, me = this.me;
    if (me.tradeBan.has(p.id)) return '<span class="rel-bad">You stopped trading with them</span>';
    if (g.refusesTrade(p, me)) return '<span class="rel-bad">Refuses to trade with you</span>';
    if (g.refusesTrade(me, p)) return '<span class="rel-bad">You refuse their trade</span>';
    const ways = [];
    if (me.counts.harbor && p.counts.harbor) ways.push('by sea');
    if ((me.railLinks || []).includes(p.id)) ways.push('across the border');
    if (!ways.length) return '';
    return `Trading ${ways.join(' and ')}${g.isAllied(me.id, p.id) ? ', double as allies' : ''}`;
  }

  diplHtml() {
    const g = this.game, my = this.myId, me = this.me;
    const all = g.players.filter((p) => p && p.alive && p.spawned && !p.tribe);
    const techs = (p) => (p.id === my || !this.isClient() ? p.techs.size : p.techCount || 0);
    const KEYS = {
      land: (p) => p.tiles, troops: (p) => p.troops, pop: (p) => p.pop, income: (p) => p.grossIncome || 0,
      city: (p) => p.counts.city, harbor: (p) => p.counts.harbor, factory: (p) => p.counts.factory, techs,
    };
    const sortKey = KEYS[this.diplSort] ? this.diplSort : 'land';
    all.sort((a, b) => KEYS[sortKey](b) - KEYS[sortKey](a) || b.tiles - a.tiles);
    const rankOf = new Map(all.slice().sort((a, b) => b.tiles - a.tiles).map((p, k) => [p.id, k + 1]));
    const allies = all.filter((p) => g.isAllied(my, p.id)).length;
    // Who each nation is allied with, as colour dots named in the tooltip; you count too.
    const alliesCell = (p) => {
      const ids = [...p.allies].filter((id) => g.players[id] && g.players[id].alive);
      if (!ids.length) return '<td class="c-allies"><span class="st-neutral">—</span></td>';
      const names = ids.map((id) => (id === my ? 'you' : g.players[id].name));
      const dots = ids.map((id) => `<span class="dot${id === my ? ' you' : ''}" style="background:${rgbCss(g.players[id].color)}"></span>`).join('');
      return `<td class="c-allies" title="Allied with ${esc(names.join(', '))}"><span class="ally-dots">${dots}</span><span class="sr">Allied with ${esc(names.join(', '))}</span></td>`;
    };
    const row = (p) => {
      const mine = p.id === my;
      let acts = '', feel;
      if (mine) feel = '<span class="st-neutral">You</span>';
      else if (g.isAllied(my, p.id)) {
        const left = g.allianceLeft(my, p.id);
        feel = `<span class="st-ally">Ally</span> <span class="fine-t">${fmtTime(left)}</span>`;
        acts = left <= RENEW_SECONDS
          ? `<button type="button" class="ghost" data-dip="ally" data-to="${p.id}" title="Alliances last five minutes; renew this one for five more.">Renew</button>`
          : `<button type="button" class="ghost" data-dip="unally" data-to="${p.id}" title="Others will trust you less, and your land is easier to take for a while.">Break</button>`;
      } else {
        const [lbl, cls] = p.human ? ['Player', ''] : relLabel(g.getRel(p.id, my));
        feel = g.atWar(p.id, my) ? '<span class="st-war">At war</span>' : `<span class="${cls}">${lbl}</span>`;
        acts = `<button type="button" class="ghost" data-dip="ally" data-to="${p.id}">Propose alliance</button>`;
      }
      if (!mine) {
        acts += me.tradeBan.has(p.id)
          ? `<button type="button" class="ghost" data-dip="trade" data-to="${p.id}" data-stop="0" title="Trade by sea and across the border again.">Resume trade</button>`
          : `<button type="button" class="ghost" data-dip="trade" data-to="${p.id}" data-stop="1" title="Cuts trade by sea and across the border, both ways. They will resent it.">Stop trade</button>`;
      }
      const ideo = p.ideology ? IDEOLOGY_BY_ID[p.ideology].name : '<span class="st-neutral">None</span>';
      const inc = p.grossIncome ? fmtMoney(nicePrice(p.grossIncome * 60)) : '—';
      return `<tr class="${mine ? 'me' : ''}" data-goto="${p.id}" title="Click to see ${esc(p.name)} on the map"><td class="rk">${rankOf.get(p.id)}</td>
        <td class="nm"><span class="dot" style="background:${rgbCss(p.color)}"></span><span class="go">${esc(p.name)}</span>${persTag(p)}${stanceTags(g, my, p)}</td>
        <td class="num">${fmtPct(g.landShare(p) * 100)}</td><td class="num">${fmt(p.troops)}</td><td class="num c-pop">${fmt(p.pop)}</td>
        <td class="num c-inc">${inc}</td>
        <td class="num c-b">${p.counts.city}</td><td class="num c-b">${p.counts.harbor}</td><td class="num c-b">${p.counts.factory}</td>
        <td class="num c-tech">${techs(p)}</td><td class="c-ideo">${ideo}</td>${alliesCell(p)}<td class="c-feel">${feel}</td>
        <td><div class="dipl-actions">${acts}</div></td></tr>`;
    };
    const head = (key, label, cls = 'num', title = '') => `<th class="${cls}${sortKey === key ? ' on' : ''}"${title ? ` title="${title}"` : ''}><button type="button" data-dsort="${key}">${label}</button></th>`;
    const icon = (key, title) => `<th class="num c-b${sortKey === key ? ' on' : ''}" title="${title}, sorted by count"><button type="button" data-dsort="${key}" aria-label="${title}"><canvas data-bi="${key}" width="40" height="40"></canvas></button></th>`;
    const thead = `<thead><tr><th class="rk">#</th><th>Nation</th>${head('land', 'Land')}${head('troops', 'Troops')}${head('pop', 'People', 'num c-pop')}${head('income', 'Income/min', 'num c-inc')}${icon('city', 'Cities')}${icon('harbor', 'Harbors')}${icon('factory', 'Factories')}${head('techs', 'Techs', 'num c-tech', 'Technologies known')}<th class="c-ideo">Ideology</th><th class="c-allies" title="Who each nation is allied with">Allies</th><th class="c-feel">Toward you</th><th></th></tr></thead>`;
    const per = this.diplPer || 12;
    const pages = Math.max(1, Math.ceil(all.length / per));
    const page = Math.min(this.diplPage || 0, pages - 1);
    this.diplPage = page;
    const slice = all.slice(page * per, (page + 1) * per);
    const pager = pages > 1 ? `<div class="pager">
        <button type="button" class="ghost" data-dpage="-1"${page === 0 ? ' disabled' : ''}>Previous</button>
        <span>Page ${page + 1} of ${pages}</span>
        <button type="button" class="ghost" data-dpage="1"${page === pages - 1 ? ' disabled' : ''}>Next</button>
      </div>` : '';
    const refusing = all.filter((p) => p.id !== my && g.refusesTrade(p, me) && !me.tradeBan.has(p.id)).length;
    const stopped = me.tradeBan.size;
    const lede = `${all.length - 1} other ${all.length === 2 ? 'nation remains' : 'nations remain'}${allies ? `, ${allies} allied with you` : ''}${refusing ? `, ${refusing} refusing to trade with you` : ''}${stopped ? `, ${stopped} you stopped trading with` : ''}. Alliances last five minutes and can be renewed in their last two. Nations that dislike you, or are at war with you, refuse your trade; allies pay double. Click a column to sort.`;
    // Finish off islands: fleets sail on their own to take small islands of beaten nations.
    const targets = me.alive ? g.islandTargets(me).length : 0;
    const auto = `<label class="check dipl-auto"><input type="checkbox" data-auto="islands"${me.autoIslands ? ' checked' : ''}> <span><b>Finish off islands.</b> Your fleets sail on their own to take small islands held by nations that have nothing else left, or by nations at war with you${me.autoIslands || targets ? ` (${targets ? `${targets} ${targets === 1 ? 'island' : 'islands'} to take now` : 'none right now'})` : ''}.</span></label>`;
    return `<p class="dipl-progress">${esc(lede)}</p>${auto}<div class="dipl-cols"><table class="dipl-table board-table">${thead}<tbody>${slice.map(row).join('')}</tbody></table></div>${pager}`;
  }

  // Government: stability, administration and policies (Realistic only), and national priority.
  govHtml() {
    if (!this.game.politics) {
      return `<div class="gov blitz">${this.priorityHtml()}<p class="ideo-note">Blitz has no stability or administration, so ideology effects on them do nothing here. Everything else applies.</p></div>`;
    }
    return this.stateHtml();
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
    // Changing ideology is a view of its own, in place of the tree.
    if (this.ideoChanging) {
      const others = IDEOLOGIES.filter((I) => I.id !== cur.id).map((I) => this.ideologyCard(I, false,
        `<button type="button" class="ghost" data-ideo="${I.id}"${since < 60 ? ' disabled' : ''}>Switch to ${esc(I.name)}</button>`)).join('');
      return `<section class="ideo">
        <div class="ideo-bar">
          <p class="ideo-lede">${me.ideologyDefault ? `Every nation starts with ${esc(cur.name)}, so this first change is free.` : `Changing from ${esc(cur.name)} loses every doctrine you've bought${g.politics ? ` and costs ${IDEOLOGY_CHANGE_SHOCK} stability for a while` : ''}.${since < 60 ? ` You can change again in ${Math.ceil(60 - since)}s.` : ''}`}</p>
          <button type="button" class="ghost" data-ideo-change="0">Keep ${esc(cur.name)}</button>
        </div>
        <div class="ideo-grid">${others}</div>
      </section>`;
    }
    const owned = me.doctrines.size;
    return `<section class="ideo">
      <div class="ideo-now">
        <div class="ideo-side">
          ${this.ideologyCard(cur, true, '')}
          <button type="button" class="text-btn" data-ideo-change="1">Change ideology</button>
        </div>
        <div class="ideo-tree">
          <p class="ideo-lede">Doctrines strengthen ${esc(cur.name)}. Buy the first to open both branches; the last needs both. You have ${owned} of ${cur.tree.length}.</p>
          <div class="doctrines">${nodes}</div>
        </div>
      </div>
    </section>`;
  }

  stateHtml() {
    const g = this.game, me = this.me;
    const s = Math.round(me.stability), tg = Math.round(me.stabTarget);
    const sf = g.stabFactor(me);
    const label = s >= 70 ? 'Prosperous' : s >= 50 ? 'Orderly' : s >= REVOLT_BELOW + 10 ? 'Uneasy' : s >= REVOLT_BELOW ? 'Restless' : 'In revolt';
    let occupied = 0;
    for (let t = 0; t < g.N; t++) if (g.owner[t] === this.myId && g.control[t] < 50) occupied++;
    const rows = me.stabFactors.filter(([, v]) => Math.round(v) !== 0).map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}</td></tr>`).join('');
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
          <div><b>Tax relief</b><p>+8 stability, families grow 25% faster. Income −25% while it lasts.</p></div>
          <button type="button" class="${me.taxRelief ? 'primary' : 'ghost'}" data-gov="tax">${me.taxRelief ? 'Restore taxes' : 'Lower taxes'}</button>
        </div>
        <div class="policy">
          <div><b>Celebration</b><p>+15 stability, fading over a minute. Costs ${fmtMoney(cc)}.${cdLeft ? ` Ready again in ${cdLeft}s.` : ''}</p></div>
          <button type="button" class="ghost" data-gov="celebrate"${cdLeft || me.gold < cc ? ' disabled' : ''}>Hold a celebration</button>
        </div>
      </section>
      <section class="gov-card">
        ${this.priorityHtml()}
        <p class="fine">Hold 70% of the land to win. There is no time limit.</p>
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
      <div class="field"><span>Alerts</span>
        <div class="segmented">
          ${[['all', 'All'], ['threats', 'Threats only'], ['off', 'Off']].map(([v, l]) => `<label><input type="radio" name="alerts" value="${v}"${(this.prefs.alerts || 'all') === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}
        </div>
        <p class="field-note">Cards for attacks, fleets, missiles, revolts and lost capitals are threats; alliances, trade and conquests are the rest. Everything is still written in the chronicle.</p>
      </div>
      <div class="modal-actions">
        ${document.fullscreenEnabled ? `<button type="button" class="ghost" data-act="fullscreen">${document.fullscreenElement ? 'Leave full screen' : 'Full screen'}</button>` : ''}
        <button type="button" class="ghost" data-act="help">How to play</button>
        <button type="button" class="ghost" data-act="menu">${mp ? 'Leave match' : 'Quit to main menu'}</button>
        <button type="button" class="primary" data-close>Resume</button>
      </div>`, {
      onClick: (e) => {
        const gq = e.target.closest('input[name=gfx2]');
        if (gq) { this.setGraphics(gq.value); return; }
        const al = e.target.closest('input[name=alerts]');
        if (al) { this.prefs.alerts = al.value; savePrefs(this.prefs); return; }
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.dataset.act === 'help') { this.closeModal(); this.showHelp(); }
        if (b.dataset.act === 'fullscreen') { toggleFullscreen(); this.closeModal(); }
        if (b.dataset.act === 'menu') this.backToMenu();
      },
    });
  }

  // ---------- tutorial ----------
  // The tutorial chooser: on a first visit as a welcome, and from the menu's tutorial link.
  showTutorials(first) {
    const seen = () => { try { localStorage.setItem('borderfall.welcomed', '1'); } catch (e) { /* storage unavailable */ } };
    this.openModal(`<h2 id="modal-title">${first ? 'Welcome to Borderfall' : 'Tutorials'}</h2>
      <p class="result-lede">${first ? 'A real-time conquest game that starts in 1500. New here? Two short steps get you playing.' : 'Learn the controls, or play a whole match with an advisor beside you.'}</p>
      <ol class="tut-choices">
        <li><button type="button" data-act="lesson"><b>The controls</b><span>About three minutes on a practice island: moving the map, taking land, building, sailing and the big screens.</span></button></li>
        <li><button type="button" data-act="guide"><b>A guided game</b><span>A whole match with an advisor beside you for most of it, until you take over and conquer the world yourself.</span></button></li>
      </ol>
      <div class="modal-actions"><button type="button" class="ghost" data-act="skip">${first ? 'I know how to play' : 'Close'}</button></div>`, {
      onClick: (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        seen();
        this.closeModal();
        if (b.dataset.act === 'lesson') this.startLesson();
        else if (b.dataset.act === 'guide') this.startGuided();
      },
    });
  }

  // The controls lesson: the hand-laid practice island, one distant rival that leaves you alone,
  // a tribe beside your home and another across the strait.
  startLesson() {
    if (this.net) { this.mpStatus('Leave the lobby before starting the tutorial.', true); return; }
    const map = buildTutorialMap();
    this.map = map;
    this.mapKey = '';
    const at = ([x, y]) => y * map.W + x;
    const S = TUTORIAL_SPOTS;
    // Blitz rules keep stability and revolts out of the way while you learn the controls.
    const game = new Game(map, { difficulty: 'easy', mode: 'blitz' });
    game.setupPlayers({ playerName: this.playerName(), playerColor: hexToRgb(this.color), playerSkin: this.shop.equipped, numAI: 1, numTribes: 2, difficulty: 'easy',
      spawns: [at(S.rival), at(S.tribe), at(S.islandTribe)] });
    const [rival, tribe, island] = game.players.slice(2);
    rival.tutSpot = 'rival'; tribe.tutSpot = 'tribe'; island.tutSpot = 'islandTribe';
    rival.ai.diff = { ...rival.ai.diff, graceVsHuman: 1e9, aggression: 0.4 };
    rival.ai.nextNaval = 1e12;
    tribe.troops = 260; tribe.gold = 3e6;
    island.gold = 4e6;
    game.players[1].tutorialBonus = true;
    game.coached = true;
    this.enterGame(game, 1);
    $('spawn-banner').querySelector('p').textContent = 'Found your nation inside the gold ring.';
    this.tutorial = new Coach(this, LESSON);
    this.tutorial.begin();
  }

  // The guided game: a real Realistic match on easy, rivals holding off for five minutes, with
  // the advisor setting objectives until it hands over in the 1800s.
  startGuided() {
    if (this.net) { this.mpStatus('Leave the lobby before starting the tutorial.', true); return; }
    const map = generateMap({ seed: 2468, type: 'continents', size: 'medium' });
    this.map = map;
    this.mapKey = '';
    const game = new Game(map, { difficulty: 'easy', mode: 'realistic' });
    game.setupPlayers({ playerName: this.playerName(), playerColor: hexToRgb(this.color), playerSkin: this.shop.equipped, numAI: 12, numTribes: 16, difficulty: 'easy' });
    for (const p of game.players) if (p && p.ai && !p.tribe) p.ai.diff = { ...p.ai.diff, graceVsHuman: 300 };
    game.coached = true;
    this.enterGame(game, 1);
    this.tutorial = new Coach(this, GUIDE);
    this.tutorial.begin();
  }

  // The end of a tutorial: a closing screen in place of a victory. The guided game can be played
  // on from here as an ordinary match.
  showTutorialComplete(plan, s, crowns) {
    const g = this.game, me = this.me;
    const stats = s.stats && g ? `<div class="result-stats">
        <div><span>Year</span><b>${g.year}</b></div>
        <div><span>Time</span><b>${fmtTime(g.time)}</b></div>
        <div><span>Land</span><b>${fmtPct(g.landShare(me) * 100)}</b></div>
        <div><span>Nations conquered</span><b>${me.kills}</b></div>
      </div>` : '';
    this.openModal(`<p class="kicker">${plan.id === 'lesson' ? 'The controls' : 'The guided game'}</p>
      <h2 id="modal-title">${esc(s.title)}</h2>
      <p class="result-lede">${s.text()}</p>
      ${crowns ? `<p class="crowns-earned">You earned <b>${crowns} crowns</b>. Spend them on patterns in the shop on the main menu.</p>` : ''}
      ${stats}
      <div class="modal-actions">${s.actions.map(([a, label, cls]) => `<button type="button" class="${cls}" data-act="${a}">${esc(label)}</button>`).join('')}</div>`, {
      locked: true,
      onClick: (e) => {
        const b = e.target.closest('button[data-act]');
        if (!b) return;
        if (b.dataset.act === 'menu') this.backToMenu();
        else if (b.dataset.act === 'guide') { this.closeModal(); this.startGuided(); }
        else if (b.dataset.act === 'keep') {
          if (this.game) this.game.coached = false;
          this.closeModal();
          this.notice('The world is yours. Hold 70% of the land to win.');
        }
      },
    });
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
    $('mp-games-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-join]');
      if (b) { $('mp-code').value = b.dataset.join; $('mp-join').click(); }
    });
    $('mp-list').addEventListener('change', () => { if (this.net) this.net.setListed($('mp-list').checked); });
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
    // Firebase lists lobbies: public matches always, a private lobby if its host wants.
    const canList = isHost && !L.isPublic && !!(this.net && this.net.cloud);
    $('mp-list-row').hidden = !canList;
    if (canList) $('mp-list').checked = this.net.listed;
    for (const el of $('setup').querySelectorAll('input, select')) {
      if (el.closest('#lobby') || el.name === 'gfx') continue;
      el.disabled = !isHost || el.id === 'opt-name';
    }
    for (const b of $('opt-colors').children) b.disabled = true;
    $('btn-rename').disabled = true;
    $('online-summary').textContent = `Lobby ${L.code}, ${L.players.length} ${L.players.length === 1 ? 'player' : 'players'}`;
    if (!this.lobbyShown) { this.lobbyShown = true; this.setSide('online', true); this.setSide('world', true); }
    this.updateGamesWatch();
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
    this.lobbyShown = false;
    $('online-summary').textContent = 'Play with friends or strangers';
    this.appliedLobby = null;
    for (const el of $('setup').querySelectorAll('input, select')) el.disabled = false;
    for (const b of $('opt-colors').children) b.disabled = false;
    $('btn-rename').disabled = false;
    $('btn-start').textContent = 'Choose your homeland';
    $('btn-start').disabled = !!this.genTimer;
    $('mp-list-row').hidden = true;
    if (!silent) this.mpStatus('');
    this.updateGamesWatch();
  }

  spawnCountdown(left) {
    const g = this.game;
    if (!g || g.started) { if (g && this.spawnedShown) $('spawn-banner').hidden = true; return; }
    $('spawn-banner').hidden = false;
    $('spawn-banner').querySelector('p').textContent = this.me && this.me.spawned
      ? `Click elsewhere to move your spot. The match begins in ${left}s.`
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
    if (this.tutorial) this.tutorial.end();
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
    const crowns = this.awardGame();
    const sc = this.cloud.enabled && g.scoreResult;
    this.openModal(`<h2 id="modal-title">${title}</h2>
      <p class="result-lede">${lede}</p>
      ${crowns ? `<p class="crowns-earned">You earned <b>${crowns} crowns</b>. Spend them on patterns in the shop on the main menu.</p>` : ''}
      ${sc ? `<p class="score-line"><b>${sc.pts}</b> leaderboard points${sc.best ? ', your best game yet' : ''}. <button type="button" class="text-btn" data-act="board">See the leaderboard</button></p>` : ''}
      <div class="result-stats">
        <div><span>Year</span><b>${o.year}</b></div>
        <div><span>Time</span><b>${fmtTime(o.time)}</b></div>
        <div><span>Peak land</span><b>${fmtPct(me.peakTiles / g.map.landCount * 100)}</b></div>
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
        if (b && b.dataset.act === 'board') this.showLeaderboard();
      },
    });
  }
}
