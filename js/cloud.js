'use strict';
// Online services through Google Firebase: accounts and cloud saves, the leaderboard, the list of
// open lobbies, and the signaling that lets multiplayer browsers find each other.
//
// Everyone is signed in. A new visitor plays as a guest (an anonymous account) whose progress is
// saved online for that browser; signing in with Google keeps that account, and everything saved
// to it, on every device. With no config in js/firebase-config.js all of this is off and the game
// plays as before.
//
// For testing: ?fb=emu uses the Firebase emulators on this machine (Auth on port 9099, Realtime
// Database on 9000); ?fb=off switches online services off.

const CLOUD_FLAG = (/[?&]fb=(\w+)/.exec(location.search) || [])[1] || '';
const CLOUD_EMU = CLOUD_FLAG === 'emu';
const STATS_KEY = 'borderfall.stats';
const PROFILE_KEY = 'borderfall.profile';
const SYNC_KEY = 'borderfall.sync';
const CLOUD_TIMEOUT_MS = 12000;
const SYNC_DELAY_MS = 1500;
const BOARD_FETCH = 100;      // leaderboard rows fetched; the top of them are shown
const SCORE_MAX = 999;        // points one game can give
const DIFF_POINTS = { easy: 0.5, normal: 1, hard: 1.5 };
const BOARD_TABS = {
  best: { label: 'Best game', field: 'best', unit: 'points' },
  points: { label: 'Total points', field: 'points', unit: 'points' },
  wins: { label: 'Wins', field: 'wins', unit: 'wins' },
};

function cloudConfig() {
  if (CLOUD_FLAG === 'off') return null;
  if (CLOUD_EMU) {
    return { apiKey: 'demo-key', authDomain: 'demo-borderfall.firebaseapp.com', projectId: 'demo-borderfall',
      databaseURL: 'https://demo-borderfall-default-rtdb.firebaseio.com', appId: 'demo-borderfall' };
  }
  const c = typeof FIREBASE_CONFIG === 'object' ? FIREBASE_CONFIG : null;
  if (c && c.apiKey && !c.databaseURL) console.warn('Borderfall: FIREBASE_CONFIG has no databaseURL. Create the Realtime Database, then copy the config again.');
  return c && c.apiKey && c.databaseURL ? c : null;
}

function withTimeout(p, ms, what) {
  let t = 0;
  const late = new Promise((resolve, reject) => { t = setTimeout(() => reject(new Error(`${what} took too long.`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(t));
}

// ---------- results ----------
function blankStats() { return { games: 0, wins: 0, points: 0, best: 0, kills: 0 }; }
function cleanStats(s) {
  const out = blankStats();
  if (s && typeof s === 'object') for (const k of Object.keys(out)) out[k] = Math.max(0, Math.round(Number(s[k]) || 0));
  out.wins = Math.min(out.wins, out.games);
  out.best = Math.min(SCORE_MAX, out.best);
  return out;
}
function loadStats() {
  try { return cleanStats(JSON.parse(localStorage.getItem(STATS_KEY) || 'null')); } catch (e) { return blankStats(); }
}
function saveStats(s) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
}
// The name and colour shown on the leaderboard: those of the nation in the last recorded game.
function cleanProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  const name = typeof p.name === 'string' ? p.name.trim().slice(0, 16) : '';
  return { name, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color.toLowerCase() : '#888888', at: Math.max(0, Number(p.at) || 0) };
}
function loadProfile() {
  try { return cleanProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null')); } catch (e) { return cleanProfile(null); }
}
function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* storage unavailable */ }
}
const rgbHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// Leaderboard points for one game: one for each 1% of the world held at your peak, four for each
// nation or tribe destroyed, and 100 for a win. Half on Easy, half as much again on Hard; a world
// with few rivals counts for less (20 rivals count in full, 30 or more for a quarter extra); and a
// quarter more when other players were in the match.
function scoreForGame(g, me) {
  if (!me || !me.spawned) return 0;
  const peak = Math.min(100, me.peakTiles / g.map.landCount * 100);
  const won = !!(g.over && g.over.winner === me.id);
  const diff = g.diff === DIFFICULTY.hard ? 'hard' : g.diff === DIFFICULTY.easy ? 'easy' : 'normal';
  let s = (peak + (me.kills || 0) * 4 + (won ? 100 : 0)) * DIFF_POINTS[diff] * Math.min(1.25, 0.5 + (g.scoreRivals || 20) / 40);
  if ((g.scoreHumans || 1) > 1) s *= 1.25;
  return Math.max(0, Math.min(SCORE_MAX, Math.round(s)));
}

// ---------- saves ----------
// What an account keeps: crowns, patterns, one-off rewards, the tutorial, and game results.
function localSave(ui) {
  const S = ui.shop;
  let tut = false;
  try { tut = localStorage.getItem(TUT_DONE_KEY) === '1'; } catch (e) { /* storage unavailable */ }
  return { crowns: S.crowns, owned: S.owned, claimed: S.claimed, equipped: S.equipped, equippedAt: S.equippedAt || 0, tut, stats: ui.stats, profile: ui.profile };
}
function cleanSave(d) {
  d = d && typeof d === 'object' ? d : {};
  // The database hands lists back as arrays or as objects keyed by index.
  const list = (a, ok) => [...new Set((Array.isArray(a) ? a : a && typeof a === 'object' ? Object.values(a) : [])
    .filter((x) => typeof x === 'string' && ok(x)))].sort();
  const owned = list(d.owned, (id) => !!SKIN_BY_ID[id]);
  for (const s of SKINS) if (s.price === 0 && !owned.includes(s.id)) owned.push(s.id);
  owned.sort();
  return {
    crowns: Math.max(0, Math.round(Number(d.crowns) || 0)),
    owned,
    claimed: list(d.claimed, (id) => id.length <= 40),
    equipped: owned.includes(d.equipped) ? d.equipped : 'plain',
    equippedAt: Math.max(0, Number(d.equippedAt) || 0),
    tut: !!d.tut,
    stats: cleanStats(d.stats),
    profile: cleanProfile(d.profile),
  };
}
function sameSave(a, b) { return JSON.stringify(cleanSave(a)) === JSON.stringify(cleanSave(b)); }

// Two copies of one account's save that changed apart. Counts take what each side gained since
// they last matched (base), lists are joined, and the pattern chosen last is kept, so nothing is
// lost or counted twice. With no base (a device that has never saved to this account), everything
// beyond a new player's starting crowns counts as gained here.
function mergeSave(cloud, local, base) {
  const c = cleanSave(cloud), l = cleanSave(local), b = cleanSave(base || { crowns: STARTER_CROWNS });
  const add = (x, y, z) => Math.max(0, x + y - z);
  const stats = { best: Math.max(c.stats.best, l.stats.best) };
  for (const k of ['games', 'wins', 'points', 'kills']) stats[k] = add(c.stats[k], l.stats[k], b.stats[k]);
  const pick = l.equippedAt > c.equippedAt ? l : c;
  return cleanSave({
    crowns: add(c.crowns, l.crowns, b.crowns),
    owned: [...c.owned, ...l.owned],
    claimed: [...c.claimed, ...l.claimed],
    equipped: pick.equipped,
    equippedAt: pick.equippedAt,
    tut: c.tut || l.tut,
    stats,
    profile: l.profile.at > c.profile.at ? l.profile : c.profile,
  });
}

// The account this device last saved to, and the save as it stood then.
function readSync() {
  try { const m = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); return m && m.uid ? m : null; } catch (e) { return null; }
}
function writeSync(m) {
  try { if (m) localStorage.setItem(SYNC_KEY, JSON.stringify(m)); else localStorage.removeItem(SYNC_KEY); } catch (e) { /* storage unavailable */ }
}

// ---------- the service ----------
class Cloud {
  constructor(ui) {
    this.ui = ui;
    this.config = cloudConfig();
    this.enabled = !!this.config;
    this.state = this.enabled ? 'connecting' : 'off';   // off | connecting | signedout | guest | google | offline
    this.user = null;          // { uid, guest, label }
    this.netOk = false;        // may this player use the database for multiplayer?
    this.fb = null;
    this.syncTimer = 0;
    this.syncing = null;
    this.again = false;
    this.syncFailed = false;
    this.lastScore = '';
    this.listed = null;        // code of the lobby this player lists, if any
    this.listedKey = '';
    this.listQ = Promise.resolve();
    this.readyP = new Promise((resolve) => { this.resolveReady = resolve; });
    if (!this.enabled) this.resolveReady();
  }

  // Resolves once connected, or once it is clear that the services can't be reached.
  ready() { return this.readyP; }

  async start() {
    if (!this.enabled) return;
    try {
      const F = this.fb = await import(new URL('vendor/firebase.mjs', document.baseURI).href);
      this.app = F.initializeApp(this.config);
      this.auth = F.initializeAuth(this.app, {
        persistence: [F.indexedDBLocalPersistence, F.browserLocalPersistence],
        popupRedirectResolver: F.browserPopupRedirectResolver,
      });
      this.db = F.getDatabase(this.app);
      if (CLOUD_EMU) {
        F.connectAuthEmulator(this.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        F.connectDatabaseEmulator(this.db, '127.0.0.1', 9000);
      }
      await withTimeout(this.auth.authStateReady(), CLOUD_TIMEOUT_MS, 'Signing in');
      if (!this.auth.currentUser) await this.guestSignIn();
      F.onAuthStateChanged(this.auth, (u) => this.onUser(u));
      // Multiplayer goes through the database only where this player may use it.
      if (this.auth.currentUser) {
        try {
          await withTimeout(F.get(F.query(F.ref(this.db, 'lobbies'), F.limitToFirst(1))), CLOUD_TIMEOUT_MS, 'The database');
          this.netOk = true;
        } catch (e) {
          console.warn('Borderfall: the database refused or did not answer (are the rules in database.rules.json published?). Multiplayer uses public relays.', e);
        }
      }
    } catch (e) {
      console.warn('Borderfall: online services are unavailable.', e);
      this.setState('offline');
    } finally {
      this.resolveReady();
      this.ui.renderAccount();
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.user) this.flush(); });
  }

  async guestSignIn() {
    try {
      await withTimeout(this.fb.signInAnonymously(this.auth), CLOUD_TIMEOUT_MS, 'Signing in');
    } catch (e) {
      console.warn('Borderfall: could not sign in as a guest (is Anonymous sign-in enabled in the Firebase console?).', e);
      this.setState('signedout');
    }
  }

  onUser(u) {
    if (!u) {
      this.user = null;
      this.setState('connecting');
      this.guestSignIn();
      return;
    }
    this.user = { uid: u.uid, guest: u.isAnonymous, label: u.isAnonymous ? '' : u.displayName || u.email || 'your Google account' };
    this.setState(u.isAnonymous ? 'guest' : 'google');
    this.sync();
  }

  setState(s) {
    this.state = s;
    this.ui.renderAccount();
  }

  // The database connection is kept only while it's needed, because the free Firebase plan
  // counts the players connected at once. A single-player match drops it; saving, the
  // leaderboard and online play bring it back.
  online() {
    if (this.db && this.resting) { this.resting = false; this.fb.goOnline(this.db); }
  }
  rest() {
    if (this.db && !this.resting && !this.listed && !this.syncing) { this.resting = true; this.fb.goOffline(this.db); }
  }

  // ----- saving -----
  // Something worth saving changed on this device.
  dirty() {
    if (!this.user) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), SYNC_DELAY_MS);
  }
  flush() {
    clearTimeout(this.syncTimer);
    return this.user ? this.sync() : Promise.resolve();
  }
  sync() {
    this.online();
    if (this.syncing) { this.again = true; return this.syncing; }
    this.syncing = this.runSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  async runSync() {
    const F = this.fb;
    do {
      this.again = false;
      const user = this.user;
      if (!user) return;
      this.online();
      const meta = readSync();
      const base = meta && meta.uid === user.uid ? meta.base : null;
      const sent = cleanSave(localSave(this.ui));
      let saved;
      try {
        // No time limit: once this commits, the base below must be written, or gains would count twice.
        const res = await F.runTransaction(F.ref(this.db, 'users/' + user.uid), (cur) => (cur ? mergeSave(cur, sent, base) : sent));
        saved = cleanSave(res.snapshot.val());
      } catch (e) {
        console.warn('Borderfall: could not save to your account.', e);
        this.syncFailed = true;
        this.ui.renderAccount();
        return;
      }
      writeSync({ uid: user.uid, base: saved });
      this.syncFailed = false;
      if (!this.user || this.user.uid !== user.uid) return;
      // Anything gained on this device while the save was on its way stays on top of it.
      const now = cleanSave(localSave(this.ui));
      const next = sameSave(now, sent) ? saved : mergeSave(saved, now, sent);
      this.apply(next);
      if (!sameSave(next, saved)) this.again = true;
      try { await this.writeScore(); } catch (e) { console.warn('Borderfall: could not update the leaderboard.', e); }
    } while (this.again);
    this.ui.renderAccount();
  }

  apply(d) {
    const ui = this.ui, S = ui.shop;
    S.crowns = d.crowns;
    S.owned = d.owned.slice();
    S.claimed = d.claimed.slice();
    S.equipped = d.equipped;
    S.equippedAt = d.equippedAt;
    saveShop(S);
    ui.stats = cleanStats(d.stats);
    saveStats(ui.stats);
    ui.profile = cleanProfile(d.profile);
    saveProfile(ui.profile);
    if (d.tut) { try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch (e) { /* storage unavailable */ } }
    ui.onSaveApplied();
  }

  // The public leaderboard row: the name and colour of the nation last played, and the results.
  async writeScore() {
    const st = this.ui.stats, pr = this.ui.profile, user = this.user, F = this.fb;
    if (!user || !st.games) return;
    const row = { name: pr.name || 'Nation', color: pr.color, best: st.best, points: st.points, wins: st.wins, games: st.games };
    const key = user.uid + JSON.stringify(row);
    if (key === this.lastScore) return;
    await withTimeout(F.set(F.ref(this.db, 'scores/' + user.uid), { ...row, at: F.serverTimestamp() }), CLOUD_TIMEOUT_MS, 'The leaderboard');
    this.lastScore = key;
  }

  // A finished game, or one left after a few minutes: count it and keep its points.
  recordGame(g, me) {
    if (!me || !me.spawned || g.coached || g.scoreRecorded) return null;
    g.scoreRecorded = true;
    const pts = scoreForGame(g, me), won = !!(g.over && g.over.winner === me.id), s = this.ui.stats;
    const best = pts > s.best;
    s.games++;
    if (won) s.wins++;
    s.points += pts;
    s.kills += me.kills || 0;
    s.best = Math.max(s.best, pts);
    saveStats(s);
    if (me.name) {
      this.ui.profile = cleanProfile({ name: me.name, color: Array.isArray(me.color) ? rgbHex(me.color) : this.ui.color, at: Date.now() });
      saveProfile(this.ui.profile);
    }
    this.dirty();
    return { pts, best, won };
  }

  // ----- signing in and out -----
  // Returns '' when signed in, 'cancelled', or a message saying what went wrong.
  async signInGoogle() {
    const F = this.fb, provider = new F.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cur = this.auth.currentUser;
    try {
      if (cur && cur.isAnonymous) {
        // The guest account becomes a Google account: same account, same save.
        await this.linkGoogle(cur, provider);
        this.onUser(this.auth.currentUser);
      } else {
        await this.signInWithGoogle(provider);
      }
      return '';
    } catch (e) {
      const code = (e && e.code) || '';
      if (code === 'auth/credential-already-in-use') {
        // That Google account already has a save: this device's progress joins it, and the guest
        // goes. The sign-in window's answer usually carries the account; if not, ask again.
        const cred = F.GoogleAuthProvider.credentialFromError(e);
        await this.dropGuest(cur.uid);
        try {
          if (cred) await F.signInWithCredential(this.auth, cred);
          else await this.signInWithGoogle(provider);
        } catch (e2) {
          // Still the guest: save its progress again.
          this.onUser(this.auth.currentUser);
          const c2 = (e2 && e2.code) || '';
          return c2 === 'auth/popup-closed-by-user' || c2 === 'auth/cancelled-popup-request' ? 'cancelled' : 'Sign-in failed. Try again.';
        }
        return '';
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return 'cancelled';
      if (code === 'auth/popup-blocked') return 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
      if (code === 'auth/unauthorized-domain') return `Sign-in isn't allowed on ${location.hostname} yet. Add it to the authorized domains in the Firebase console.`;
      if (code === 'auth/operation-not-allowed') return "Google sign-in isn't turned on in the Firebase project yet.";
      if (code === 'auth/network-request-failed') return "Couldn't reach Google. Check your connection and try again.";
      console.warn('Borderfall: sign-in failed.', e);
      return 'Sign-in failed. Try again.';
    }
  }

  // Google's sign-in window. Tests replace these two with the emulator's test credentials.
  linkGoogle(user, provider) { return this.fb.linkWithPopup(user, provider); }
  signInWithGoogle(provider) { return this.fb.signInWithPopup(this.auth, provider); }

  // Stop saving for the guest and delete its online copy; its progress is still on this device.
  async dropGuest(uid) {
    clearTimeout(this.syncTimer);
    if (this.syncing) await this.syncing.catch(() => {});
    this.user = null;
    const F = this.fb;
    await Promise.all([F.remove(F.ref(this.db, 'users/' + uid)), F.remove(F.ref(this.db, 'scores/' + uid))]).catch(() => {});
  }

  // Returns '' when signed out, or why not. The account keeps its progress; this device starts
  // again as a new guest (only the tutorial stays done).
  async signOut() {
    try { await withTimeout(this.flush(), 8000, 'Saving'); } catch (e) { this.syncFailed = true; }
    if (this.syncFailed) return "Couldn't save to your account, so you are still signed in. Try again when you're online.";
    clearTimeout(this.syncTimer);
    this.user = null;
    this.lastScore = '';
    writeSync(null);
    this.apply(cleanSave({ crowns: STARTER_CROWNS }));
    await this.fb.signOut(this.auth);
    return '';
  }

  // ----- the leaderboard -----
  async leaderboard(tab) {
    const F = this.fb, field = (BOARD_TABS[tab] || BOARD_TABS.best).field;
    this.online();
    const snap = await withTimeout(F.get(F.query(F.ref(this.db, 'scores'), F.orderByChild(field), F.limitToLast(BOARD_FETCH))), CLOUD_TIMEOUT_MS, 'The leaderboard');
    const rows = [];
    snap.forEach((c) => {
      const v = c.val();
      if (v && v.games > 0) rows.push({ uid: c.key, name: String(v.name || ''), color: String(v.color || '#888888'), best: v.best | 0, points: v.points | 0, wins: v.wins | 0, games: v.games | 0, at: v.at || 0 });
    });
    rows.sort((a, b) => (b[field] - a[field]) || (b.points - a.points) || (a.at - b.at));
    return rows;
  }

  // ----- open lobbies -----
  lobbiesQuery() {
    const F = this.fb;
    this.online();
    return F.query(F.ref(this.db, 'lobbies'), F.orderByChild('at'), F.limitToLast(40));
  }
  static lobbyRows(snap) {
    const out = [];
    snap.forEach((c) => { const v = c.val(); if (v && /^[A-Z]{5}$/.test(c.key)) out.push({ code: c.key, ...v }); });
    return out;
  }
  async openLobbies() {
    const snap = await withTimeout(this.fb.get(this.lobbiesQuery()), CLOUD_TIMEOUT_MS, 'Finding a match');
    return Cloud.lobbyRows(snap);
  }
  // Calls fn with the open lobbies now and whenever they change; returns a function that stops.
  watchLobbies(fn) {
    if (!this.netOk) return () => {};
    return this.fb.onValue(this.lobbiesQuery(), (snap) => fn(Cloud.lobbyRows(snap)), () => fn([]));
  }

  // Show a hosted lobby in the open games list (show = false takes it off). The entry goes by
  // itself if the host's connection drops.
  listLobby(L, show) {
    this.listQ = this.listQ.then(() => this.writeListing(L, show)).catch((e) => console.warn('Borderfall: could not list the lobby.', e));
    return this.listQ;
  }
  async writeListing(L, show) {
    if (!this.user || !this.netOk) return;
    this.online();
    const F = this.fb, r = F.ref(this.db, 'lobbies/' + L.code);
    if (!show || L.started) {
      if (this.listed !== L.code) return;
      this.listed = null;
      this.listedKey = '';
      await F.onDisconnect(r).cancel();
      await F.remove(r);
      return;
    }
    const host = L.players[0];
    const row = { name: String((host && host.name) || 'Host').slice(0, 16), mode: L.settings.mode, map: mapLabel(L.settings.type).slice(0, 40),
      players: L.players.length, max: NET_MAX_PLAYERS, auto: !!L.isPublic };
    const key = JSON.stringify(row);
    if (this.listed === L.code && key === this.listedKey) return;
    if (this.listed !== L.code) {
      await F.onDisconnect(r).remove();
      await F.set(r, { ...row, host: this.user.uid, at: F.serverTimestamp() });
      this.listed = L.code;
    } else {
      await F.update(r, row);
    }
    this.listedKey = key;
  }
}
