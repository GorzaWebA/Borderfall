'use strict';
// Canvas renderer. The map is drawn like a printed campaign atlas: terrain with engraved
// water lines, nations as colour washes with a stronger band inside each border, map symbols
// for buildings and capitals, letter-spaced labels and staff-map arrows for every front.

const BORDER_DARKEN = 0.5;
const TERRITORY_MIX = 0.56;
const BAND_MIX = 0.8;
const FALLOUT_COLOR = [96, 112, 54];
const INK = '#241c15';
const PAPER = '#f3ead6';
const FONT_LABEL = '"Alegreya SC", Georgia, serif';
const FONT_BOOK = 'Alegreya, Georgia, serif';
const FONT_NUM = '"Alegreya Sans", system-ui, sans-serif';
const POPUP_SECONDS = 8;        // each money building shows its earnings this often
const POPUP_MS = 1500;          // how long a popup floats

// Pixel art, facing right. F flag, M mast, S sail, H/h hull in the owner's colour;
// t tan sail, W/w wooden hull for merchant ships.
const SHIP_ART = {
  fleet: [
    '..FFM......',
    '....M......',
    '...SMSS....',
    '..SSMSSS...',
    '..SSMSSS...',
    'HH..M......',
    'HHHHHHHHHHH',
    '.HHHHHHHHH.',
    '..hhhhhhh..',
  ],
  trade: [
    '....M....',
    '..ttMt...',
    '.tttMtt..',
    '.tttMtt..',
    'W...M...W',
    'WWWWWWWWW',
    '.wwwwwww.',
  ],
};

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cw = 0; this.ch = 0;
    this.map = null;
    this.game = null;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.hoverTile = -1;
    this.insetLeft = 0;        // px hidden behind the start menu
    this.myId = 1;             // the nation this screen plays as
    this.quality = 'high';     // 'high' or 'low'
    this.mode = null;          // { kind: 'build', type } | { kind: 'missile' } | { kind: 'spawn' }
    this.timeScale = 0;        // game speed this frame, 0 while paused; drives merchant ships
    this.sprites = new Map();  // cached pixel-art ship sprites
    this.marks = [];           // tutorial rings: { x, y, r, label } in tile coordinates
    this.userPanned = 0;
    this.userZoomed = 0;
    this.resetTrade();
    this.resize();
    // Canvas text only uses a web font once it has loaded, so ask for the map faces up front.
    if (document.fonts && document.fonts.load) {
      for (const f of [`700 20px ${FONT_LABEL}`, `italic 500 16px ${FONT_BOOK}`, `700 13px ${FONT_NUM}`]) document.fonts.load(f).catch(() => {});
    }
  }

  resize() {
    this.dpr = this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.cw = window.innerWidth;
    this.ch = window.innerHeight;
    this.cv.width = Math.round(this.cw * this.dpr);
    this.cv.height = Math.round(this.ch * this.dpr);
    this.cv.style.width = this.cw + 'px';
    this.cv.style.height = this.ch + 'px';
    if (this.map) this.clampCam();
  }

  setMap(map) {
    this.map = map;
    this.game = null;
    const { W, H, N } = map;
    this.off = document.createElement('canvas');
    this.off.width = W; this.off.height = H;
    this.octx = this.off.getContext('2d');
    this.img = this.octx.createImageData(W, H);
    this.terrainRGB = new Uint8ClampedArray(N * 3);
    // Scratch arrays for the merchant-route search, kept apart from the simulation's own.
    this.rStamp = new Uint32Array(N);
    this.rParent = new Int32Array(N);
    this.rQueue = new Int32Array(N);
    this.rSt = 0;
    this.resetTrade();
    this.buildTerrain();
    this.redrawAll();
    this.fit();
  }

  setQuality(q) {
    this.quality = q === 'low' ? 'low' : 'high';
    this.resize();
  }

  setGame(game) {
    this.game = game;
    this.resetTrade();
    this.redrawAll();
  }

  buildTerrain() {
    const m = this.map, { W, H, N } = m, out = this.terrainRGB;
    const deep = TERRAIN[T_DEEP].color, sea = TERRAIN[T_SEA].color;
    const sand = [222, 206, 158];
    for (let i = 0; i < N; i++) {
      const t = m.terrain[i];
      const x = i % W, y = (i - x) / W;
      const n = ((Math.imul(i, 2654435761) >>> 24) / 255 - 0.5) * 6;
      let r, g, b;
      if (t <= T_SEA) {
        const wd = m.waterDist[i];
        const f = clamp((wd - 1) / 16, 0, 1);
        const k = f * f * (3 - 2 * f);
        r = lerp(sea[0], deep[0], k); g = lerp(sea[1], deep[1], k); b = lerp(sea[2], deep[2], k);
        if (wd === 1) { r += 12; g += 16; b += 14; }
        // Engraved water lines: faint rings that follow the coast, as on old charts.
        else if (wd === 3 || wd === 6 || wd === 10) { const e = wd === 3 ? 13 : wd === 6 ? 9 : 6; r += e; g += e * 1.1; b += e * 1.2; }
        r += n * 0.3; g += n * 0.3; b += n * 0.4;
      } else {
        const c = TERRAIN[t].color;
        // Relief from a smoothed slope, so hills read as shading rather than streaks.
        const hs = (j) => m.heights[j];
        const h = m.heights[i];
        let slope = 0;
        if (x > 1 && y > 1 && x < W - 2 && y < H - 2) {
          slope = (hs(i - W - 1) + hs(i - W) + hs(i - 1)) - (hs(i + W + 1) + hs(i + W) + hs(i + 1));
          slope /= 3;
        }
        const shade = 1 + clamp(slope * 4.5, -0.15, 0.15) + (h - 0.3) * 0.1;
        r = c[0] * shade; g = c[1] * shade; b = c[2] * shade;
        if (m.coast[i] && t !== T_MOUNTAIN && t !== T_HILLS && t !== T_TUNDRA) {
          r = lerp(r, sand[0], 0.45); g = lerp(g, sand[1], 0.45); b = lerp(b, sand[2], 0.45);
        }
        r += n; g += n; b += n;
      }
      out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
    }
  }

  // Inside each nation: a light wash, a stronger band two tiles deep along the border,
  // and a dark line on the border itself, like the hand-coloured political maps of atlases.
  pixel(i) {
    const d = this.img.data, tr = this.terrainRGB, k = i * 4, j = i * 3;
    const g = this.game;
    const o = g ? g.owner[i] : 0;
    let r = tr[j], gg = tr[j + 1], b = tr[j + 2];
    if (o) {
      const c = g.players[o].color;
      const W = this.map.W, N = this.map.N, x = i % W, own = g.owner;
      const border = x === 0 || x === W - 1 || i < W || i >= N - W ||
        own[i - 1] !== o || own[i + 1] !== o || own[i - W] !== o || own[i + W] !== o;
      if (border) {
        r = c[0] * BORDER_DARKEN; gg = c[1] * BORDER_DARKEN; b = c[2] * BORDER_DARKEN;
      } else {
        const band = x < 2 || x >= W - 2 || i < 2 * W || i >= N - 2 * W ||
          own[i - 2] !== o || own[i + 2] !== o || own[i - 2 * W] !== o || own[i + 2 * W] !== o ||
          own[i - W - 1] !== o || own[i - W + 1] !== o || own[i + W - 1] !== o || own[i + W + 1] !== o;
        const mix = band ? BAND_MIX : TERRITORY_MIX;
        r = lerp(r, c[0], mix); gg = lerp(gg, c[1], mix); b = lerp(b, c[2], mix);
        // The nation's pattern from the shop, if it has one.
        const skin = g.players[o].skin;
        if (skin && skin !== 'plain' && SKIN_BY_ID[skin]) {
          const t = applySkinTone([r, gg, b], SKIN_BY_ID[skin].tone(x, (i - x) / W));
          r = t[0]; gg = t[1]; b = t[2];
        }
        // Occupied or poorly governed land shows diagonal hatching.
        if (g.politics && g.control[i] < 50 && ((x + ((i - x) / W)) % 4) === 0) {
          r *= 0.72; gg *= 0.72; b *= 0.72;
        }
      }
    } else if (g && g.fallout[i]) {
      r = lerp(r, FALLOUT_COLOR[0], 0.65) * 0.8; gg = lerp(gg, FALLOUT_COLOR[1], 0.65) * 0.8; b = lerp(b, FALLOUT_COLOR[2], 0.65) * 0.8;
    }
    d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
  }

  redrawAll() {
    if (!this.map) return;
    for (let i = 0; i < this.map.N; i++) this.pixel(i);
    this.octx.putImageData(this.img, 0, 0);
    if (this.game) {
      this.game.dirty.fill(0);
      this.game.dirtyList.length = 0;
    }
  }

  flush() {
    const g = this.game;
    if (!g || g.dirtyList.length === 0) return;
    const list = g.dirtyList;
    if (list.length > this.map.N / 3) {
      this.redrawAll();
      return;
    }
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const W = this.map.W;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      g.dirty[i] = 0;
      this.pixel(i);
      const x = i % W, y = (i - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    list.length = 0;
    this.octx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  // ---------- camera ----------
  viewW() { return Math.max(100, this.cw - this.insetLeft); }
  minZoom() { return Math.min(this.viewW() / this.map.W, this.ch / this.map.H) * 0.92; }
  fit() {
    this.zoomGlide = this.panGlide = null;
    this.cam.zoom = this.minZoom();
    this.cam.x = this.map.W / 2;
    this.cam.y = this.map.H / 2;
  }
  clampCam() {
    const z = this.cam;
    z.zoom = clamp(z.zoom, this.minZoom(), 40);
    const W = this.map.W, H = this.map.H;
    const hw = this.viewW() / 2 / z.zoom, hh = this.ch / 2 / z.zoom;
    z.x = W < hw * 2 ? W / 2 : clamp(z.x, hw * 0.6, W - hw * 0.6);
    z.y = H < hh * 2 ? H / 2 : clamp(z.y, hh * 0.6, H - hh * 0.6);
  }
  viewCenter() { return [this.insetLeft + this.viewW() / 2, this.ch / 2]; }
  origin() {
    const z = this.cam, [cx, cy] = this.viewCenter();
    return [cx - z.x * z.zoom, cy - z.y * z.zoom];
  }
  screenToWorld(sx, sy) {
    const [ox, oy] = this.origin();
    return [(sx - ox) / this.cam.zoom, (sy - oy) / this.cam.zoom];
  }
  screenToTile(sx, sy) {
    if (!this.map) return -1;
    const [wx, wy] = this.screenToWorld(sx, sy);
    const x = Math.floor(wx), y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= this.map.W || y >= this.map.H) return -1;
    return y * this.map.W + x;
  }
  // Zoom about a screen point. With smooth set (the mouse wheel), the zoom eases toward its
  // target over a few frames while the point under the cursor stays put.
  zoomAt(sx, sy, factor, smooth) {
    this.userZoomed += Math.abs(Math.log(factor));   // the lesson counts zooming done by the player
    const [wx, wy] = this.screenToWorld(sx, sy);
    if (smooth) {
      const from = this.zoomGlide ? this.zoomGlide.zoom : this.cam.zoom;
      this.zoomGlide = { zoom: clamp(from * factor, this.minZoom(), 40), sx, sy, wx, wy };
      this.panGlide = null;
      return;
    }
    this.zoomGlide = null;
    this.setZoomAbout(clamp(this.cam.zoom * factor, this.minZoom(), 40), sx, sy, wx, wy);
  }
  setZoomAbout(zoom, sx, sy, wx, wy) {
    const [cx, cy] = this.viewCenter();
    this.cam.zoom = zoom;
    this.cam.x = wx - (sx - cx) / zoom;
    this.cam.y = wy - (sy - cy) / zoom;
    this.clampCam();
  }
  pan(dx, dy) {
    this.userPanned += Math.hypot(dx, dy);           // and panning, in screen pixels
    this.panGlide = null;
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCam();
  }
  // Glide to a spot (and at least the given zoom) instead of jumping there.
  centerOn(x, y, zoom) {
    this.zoomGlide = null;
    this.panGlide = { x, y, zoom: zoom ? Math.max(this.cam.zoom, zoom) : this.cam.zoom };
  }
  // Advance any camera glide; k is the share of the remaining distance covered this frame.
  stepCamera(dt) {
    const k = 1 - Math.exp(-dt * 11);
    const Z = this.zoomGlide;
    if (Z) {
      const z = this.cam.zoom + (Z.zoom - this.cam.zoom) * k;
      const done = Math.abs(Z.zoom - z) / Z.zoom < 0.002;
      this.setZoomAbout(done ? Z.zoom : z, Z.sx, Z.sy, Z.wx, Z.wy);
      if (done) this.zoomGlide = null;
    }
    const P = this.panGlide;
    if (P) {
      const c = this.cam;
      c.x += (P.x - c.x) * k; c.y += (P.y - c.y) * k; c.zoom += (P.zoom - c.zoom) * k;
      const done = Math.hypot(P.x - c.x, P.y - c.y) * c.zoom < 0.5 && Math.abs(P.zoom - c.zoom) / P.zoom < 0.002;
      if (done) { c.x = P.x; c.y = P.y; c.zoom = P.zoom; this.panGlide = null; }
      this.clampCam();
    }
  }

  // ---------- drawing ----------
  draw(alpha) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0f2638';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!this.map) return;
    this.flush();
    const t = performance.now();
    this.stepCamera(this.lastDraw ? Math.min(0.1, (t - this.lastDraw) / 1000) : 0);
    this.lastDraw = t;
    let [ox, oy] = this.origin();
    // Screen shake after a missile hits us; it eases out over its duration.
    const now = performance.now();
    if (this.shake && now < this.shake.until) {
      const k = (this.shake.until - now) / this.shake.dur;
      ox += (Math.random() * 2 - 1) * this.shake.mag * k;
      oy += (Math.random() * 2 - 1) * this.shake.mag * k;
    }
    const z = this.cam.zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, ox, oy, this.map.W * z, this.map.H * z);
    const g = this.game;
    if (!g) return;
    this.updateTrade(now);
    this.drawTrade(ox, oy, z);
    this.drawFronts(ox, oy, z, now);
    this.drawBuildings(ox, oy, z);
    this.drawCapitals(ox, oy, z);
    this.drawShips(ox, oy, z, alpha);
    this.drawPopups(ox, oy, z, now);
    this.drawMissiles(ox, oy, z, alpha);
    this.drawEffects(ox, oy, z);
    this.drawLabels(ox, oy, z);
    this.drawMarks(ox, oy, z, now);
    this.drawMode(ox, oy, z);
  }

  // Tutorial pointers: a slowly turning dashed gold ring with a label above it.
  drawMarks(ox, oy, z, now) {
    if (!this.marks.length) return;
    const ctx = this.ctx, pulse = 0.5 + 0.5 * Math.sin(now / 320);
    for (const m of this.marks) {
      const sx = ox + m.x * z, sy = oy + m.y * z, r = Math.max(18, m.r * z) * (1 + pulse * 0.06);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(230,199,121,${0.08 + pulse * 0.06})`;
      ctx.fill();
      ctx.setLineDash([10, 7]);
      ctx.lineDashOffset = -now / 60;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(28,20,14,0.85)';
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#e6c779';
      ctx.stroke();
      ctx.setLineDash([]);
      if (m.label) {
        ctx.font = `700 15px ${FONT_NUM}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(28,20,14,0.9)';
        ctx.strokeText(m.label, sx, sy - r - 6);
        ctx.fillStyle = '#f1d27f';
        ctx.fillText(m.label, sx, sy - r - 6);
      }
      ctx.restore();
    }
  }

  visible(sx, sy, pad) {
    return sx > -pad && sy > -pad && sx < this.cw + pad && sy < this.ch + pad;
  }

  drawCapitals(ox, oy, z) {
    const ctx = this.ctx, g = this.game, W = this.map.W;
    const r = clamp(z * 1.1, 6, 34);
    for (let k = 1; k < g.players.length; k++) {
      const p = g.players[k];
      if (!p.alive || p.capital < 0) continue;
      const x = p.capital % W, y = (p.capital - x) / W;
      const sx = ox + (x + 0.5) * z, sy = oy + (y + 0.5) * z;
      if (!this.visible(sx, sy, r * 2)) continue;
      drawCapital(ctx, sx, sy, r, p.color);
    }
  }

  startShake(mag, dur) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.shake = { mag, dur, until: performance.now() + dur };
  }

  // Attacks involving me: a dotted line of contact along the front and a tag with the troops
  // committed there, set on the front itself.
  drawFronts(ox, oy, z, now) {
    const ctx = this.ctx, g = this.game, me = this.myId, W = this.map.W;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    const dot = Math.max(1.3, z * 0.42);
    for (const a of g.attacks) {
      if (a.dead || !a.target || (a.attacker !== me && a.target !== me)) continue;
      let tiles = a.fs;
      if (!tiles && a.frontier) {
        tiles = [];
        const step = Math.max(1, Math.ceil(a.frontier.length / 120));
        for (let k = 0; k < a.frontier.length; k += step) tiles.push(a.frontier[k]);
      }
      if (!tiles || !tiles.length) continue;
      const incoming = a.target === me;
      const rgb = incoming ? '214,90,60' : '230,199,121';
      let cx = 0, cy = 0;
      for (const t of tiles) { const x = t % W; cx += x; cy += (t - x) / W; }
      cx /= tiles.length; cy /= tiles.length;
      let ax = cx, ay = cy, bd = 1e18;
      ctx.fillStyle = `rgba(${rgb},${0.45 + 0.45 * pulse})`;
      ctx.beginPath();
      for (const t of tiles) {
        const x = t % W, y = (t - x) / W;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bd) { bd = d; ax = x; ay = y; }
        const sx = ox + (x + 0.5) * z, sy = oy + (y + 0.5) * z;
        if (sx > -4 && sy > -4 && sx < this.cw + 4 && sy < this.ch + 4) { ctx.moveTo(sx + dot, sy); ctx.arc(sx, sy, dot, 0, Math.PI * 2); }
      }
      ctx.fill();
      const bx = ox + (ax + 0.5) * z, by = oy + (ay + 0.5) * z;
      if (!this.visible(bx, by, 60)) continue;
      drawFrontTag(ctx, bx, by, fmt(a.troops), `rgb(${rgb})`, incoming);
    }
  }

  drawBuildings(ox, oy, z) {
    const ctx = this.ctx, g = this.game;
    const low = this.quality === 'low';
    if (low && z < 0.9) return;
    // Tokens grow with the map so they stay readable up close; buildings sit at least 4 tiles apart.
    const base = clamp(z * 3, 13, 120);
    for (const b of g.buildings) {
      if (!b.alive) continue;
      const lvl = b.level || 1;
      const size = (low ? Math.min(base, 16) : base) * (1 + 0.06 * (lvl - 1));
      const sx = ox + (b.x + 0.5) * z, sy = oy + (b.y + 0.5) * z;
      if (!this.visible(sx, sy, size)) continue;
      drawBuildingIcon(ctx, b.type, sx, sy, size, g.players[b.owner].color, b.cooldown > 0 && (b.type === 'silo' || b.type === 'aa'), lvl, low);
    }
  }

  // Position along a tile path at a fractional index, in tile coordinates, plus heading.
  pathPoint(path, pos) {
    const W = this.map.W;
    pos = clamp(pos, 0, path.length - 1);
    const k = Math.min(path.length - 2, Math.floor(pos)), f = pos - Math.max(0, k);
    const a = path[Math.max(0, k)], b = path[Math.min(path.length - 1, Math.max(0, k) + 1)];
    const ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    return [lerp(ax, bx, f) + 0.5, lerp(ay, by, f) + 0.5, bx - ax, by - ay];
  }

  shipPos(s, alpha) {
    const end = s.path.length - 1;
    const pos = s.dead ? s.pos : Math.min(end, s.pos + alpha * (s.speed || SHIP_SPEED));
    return this.pathPoint(s.path, pos).concat(pos);
  }

  // Pixel-art sprite for a ship, drawn once per kind, colour and heading and then scaled up
  // with crisp pixels like the map itself.
  sprite(kind, color, left) {
    const key = `${kind}|${color.join(',')}|${left ? 1 : 0}`;
    let cv = this.sprites.get(key);
    if (cv) return cv;
    const rows = SHIP_ART[kind];
    const w = rows[0].length, h = rows.length;
    const shade = (k) => rgbCss(color.map((v) => Math.round(v * k)));
    const pal = {
      F: rgbCss(color), H: shade(0.82), h: shade(0.56), S: PAPER, M: '#2a2018',
      t: '#d8c08a', W: '#7c5434', w: '#553822',
    };
    cv = document.createElement('canvas');
    cv.width = w + 2; cv.height = h + 2;
    const c = cv.getContext('2d');
    const at = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== '.';
    c.fillStyle = '#1c140e';
    for (let y = -1; y <= h; y++) {
      for (let x = -1; x <= w; x++) {
        if (at(x, y)) continue;
        if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) c.fillRect((left ? w - 1 - x : x) + 1, y + 1, 1, 1);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        c.fillStyle = pal[ch];
        c.fillRect((left ? w - 1 - x : x) + 1, y + 1, 1, 1);
      }
    }
    this.sprites.set(key, cv);
    return cv;
  }

  shipUnit(z) { return clamp(Math.round(z * 0.45), 2, 8); }

  // Draws a ship sprite with its waterline on (sx, sy).
  blitShip(kind, color, left, sx, sy, u) {
    const cv = this.sprite(kind, color, left);
    const water = SHIP_ART[kind].length - 1;   // padded row of the lower hull
    const x = Math.round(sx - (cv.width * u) / 2), y = Math.round(sy - water * u);
    this.ctx.drawImage(cv, x, y, cv.width * u, cv.height * u);
    return y;
  }

  // Fleets: the nation's colours, a flag at the masthead and a pixel wake spreading behind them.
  drawShips(ox, oy, z, alpha) {
    const ctx = this.ctx, g = this.game, u = this.shipUnit(z);
    for (const s of g.ships) {
      if (s.dead) continue;
      const [wx, wy, dx, , pos] = this.shipPos(s, alpha);
      const sx = ox + wx * z, sy = oy + wy * z;
      if (!this.visible(sx, sy, 80)) continue;
      if (dx) s.face = dx < 0 ? -1 : 1;
      const moving = pos < s.path.length - 1;
      if (moving && this.quality !== 'low') {
        for (let k = 1; k <= 8; k++) {
          const [bx, by, ddx, ddy] = this.pathPoint(s.path, pos - k * 0.55);
          if (pos - k * 0.55 < 0) break;
          const len = Math.hypot(ddx, ddy) || 1, px = -ddy / len, py = ddx / len;
          const spread = u * (0.6 + k * 0.45);
          const cx = ox + bx * z, cy = oy + by * z;
          ctx.fillStyle = `rgba(226,240,246,${(0.8 * (1 - k / 9)).toFixed(2)})`;
          for (const side of [-1, 1]) {
            const fx = Math.round((cx + px * spread * side) / u) * u, fy = Math.round((cy + py * spread * side) / u) * u;
            ctx.fillRect(fx, fy, u, u);
          }
          if (k <= 2) ctx.fillRect(Math.round(cx / u) * u, Math.round(cy / u) * u, u, u);
        }
      }
      const top = this.blitShip('fleet', g.players[s.owner].color, s.face === -1, sx, sy, u);
      if (z >= 2.2) {
        ctx.font = `700 ${Math.round(clamp(z * 2, 11, 15))}px ${FONT_NUM}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(243,234,214,0.9)';
        const label = moving ? fmt(s.troops) : `${fmt(s.troops)} landing`;
        ctx.strokeText(label, sx, top - 2);
        ctx.fillStyle = INK;
        ctx.fillText(label, sx, top - 2);
      }
    }
  }

  // ---------- merchant shipping ----------
  // Harbors trade with every other harbor in the world. Merchant ships make that visible: small
  // brown cogs with tan sails and no flag or wake, sailing real sea routes between harbors.
  // They are decoration only and never touch the simulation.
  resetTrade() { this.trade = { ships: [], routes: new Map(), next: new Map(), last: 0, budget: 0 }; this.popups = []; this.popNext = new Map(); }

  seaRoute(a, b) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (this.trade.routes.has(key)) {
      const r = this.trade.routes.get(key);
      return r && a > b ? r.slice().reverse() : r;
    }
    if (this.trade.budget <= 0) return undefined;
    this.trade.budget--;
    const g = this.game, W = this.map.W, H = this.map.H, Q = this.rQueue, P = this.rParent, S = this.rStamp;
    if (++this.rSt >= 0xfffffff0) { S.fill(0); this.rSt = 1; }
    const st = this.rSt, lo = Math.min(a, b), hi = Math.max(a, b);
    const goal = new Set();
    const around = (t, fn) => {
      const x0 = t % W, y0 = (t - x0) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if ((dx || dy) && x >= 0 && y >= 0 && x < W && y < H) fn(y * W + x);
      }
    };
    around(hi, (n) => { if (g.isWater(n)) goal.add(n); });
    let qh = 0, qt = 0, found = -1;
    around(lo, (n) => { if (g.isWater(n) && S[n] !== st) { S[n] = st; P[n] = -1; Q[qt++] = n; } });
    while (qh < qt && qt < 260000) {
      const i = Q[qh++];
      if (goal.has(i)) { found = i; break; }
      around(i, (n) => { if (S[n] !== st && g.isWater(n)) { S[n] = st; P[n] = i; Q[qt++] = n; } });
    }
    let route = null;
    if (found >= 0) {
      route = [];
      for (let c = found; c !== -1; c = P[c]) route.push(c);
      route.reverse();
      if (route.length < 6) route = null;
    }
    this.trade.routes.set(key, route);
    return route && a > b ? route.slice().reverse() : route;
  }

  updateTrade(now) {
    const T = this.trade, g = this.game;
    const dt = T.last ? Math.min(0.25, (now - T.last) / 1000) * this.timeScale : 0;
    T.last = now;
    if (!g || !g.started) return;
    T.budget = 1;   // at most one new route search per frame
    for (const s of T.ships) s.pos += s.speed * dt;
    T.ships = T.ships.filter((s) => s.pos < s.path.length - 1);
    if (!dt) return;
    const harbors = g.buildings.filter((b) => b.alive && b.type === 'harbor');
    if (harbors.length < 2) return;
    const cap = this.quality === 'low' ? 10 : 30;
    const nowS = now / 1000;
    for (const h of harbors) {
      if (T.ships.length >= cap) break;
      const due = T.next.get(h.id);
      if (due === undefined) { T.next.set(h.id, nowS + 2 + Math.random() * 12); continue; }
      if (nowS < due) continue;
      const partners = harbors.filter((x) => x !== h && x.owner !== h.owner);
      const pool = partners.length ? partners : harbors.filter((x) => x !== h);
      const to = pool[Math.floor(Math.random() * pool.length)];
      const route = this.seaRoute(h.tile, to.tile);
      if (route === undefined) { T.next.set(h.id, nowS + 0.3); continue; }
      T.next.set(h.id, nowS + (16 + Math.random() * 16) / Math.max(0.5, Math.sqrt(h.level || 1)));
      if (route) T.ships.push({ path: route, pos: 0, speed: 1.6 + Math.random() * 0.6, face: 1 });
    }
  }

  drawTrade(ox, oy, z) {
    const u = this.shipUnit(z) - (z > 6 ? 1 : 0);
    for (const s of this.trade.ships) {
      const [wx, wy, dx] = this.pathPoint(s.path, s.pos);
      const sx = ox + wx * z, sy = oy + wy * z;
      if (!this.visible(sx, sy, 40)) continue;
      if (dx) s.face = dx < 0 ? -1 : 1;
      this.blitShip('trade', [0, 0, 0], s.face === -1, sx, sy, Math.max(2, u));
    }
  }

  // ---------- income popups ----------
  // Every few seconds each of your cities, harbors and factories shows what it just earned.
  drawPopups(ox, oy, z, now) {
    const ctx = this.ctx, g = this.game, me = g.players[this.myId];
    if (me && me.alive && g.started) {
      for (const b of me.blds) {
        if (!b.alive || b.owner !== this.myId || !(b.type === 'harbor' || BLD_EARN[b.type])) continue;
        const due = this.popNext.get(b.id);
        if (due === undefined) { this.popNext.set(b.id, g.tick + Math.floor(Math.random() * 8 * TPS)); continue; }
        if (g.tick < due) continue;
        this.popNext.set(b.id, g.tick + POPUP_SECONDS * TPS);
        const amount = g.buildingIncome(me, b) * POPUP_SECONDS;
        const sx = ox + (b.x + 0.5) * z, sy = oy + (b.y + 0.5) * z;
        if (amount >= 1 && this.visible(sx, sy, 20) && this.popups.length < 40) this.popups.push({ b, text: `+${fmtMoney(nicePrice(amount))}`, t0: now });
      }
    }
    if (!this.popups.length) return;
    const size = clamp(z * 3, 13, 120);
    ctx.font = `800 ${Math.round(clamp(z * 2.2, 12, 18))}px ${FONT_NUM}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    this.popups = this.popups.filter((p) => now - p.t0 < POPUP_MS);
    for (const p of this.popups) {
      const t = (now - p.t0) / POPUP_MS;
      const ease = 1 - (1 - t) * (1 - t);
      const sx = ox + (p.b.x + 0.5) * z, sy = oy + (p.b.y + 0.5) * z - size * 0.6 - 4 - ease * 22;
      ctx.globalAlpha = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.55) / 0.45);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(28,20,14,0.9)';
      ctx.strokeText(p.text, sx, sy);
      ctx.fillStyle = '#f1d27f';
      ctx.fillText(p.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  missilePoint(m, f) {
    const x = lerp(m.sx, m.tx, f) + 0.5, y = lerp(m.sy, m.ty, f) + 0.5;
    const d = Math.hypot(m.tx - m.sx, m.ty - m.sy);
    return [x, y - Math.sin(Math.PI * f) * Math.min(60, d * 0.3)];
  }

  drawMissiles(ox, oy, z, alpha) {
    const ctx = this.ctx, g = this.game;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
    for (const m of g.missiles) {
      if (m.dead) continue;
      // Target ring.
      const tx = ox + (m.tx + 0.5) * z, ty = oy + (m.ty + 0.5) * z;
      ctx.beginPath();
      ctx.arc(tx, ty, m.rOut * z, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(224,83,61,${0.35 + pulse * 0.4})`;
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      const f = Math.min(1, (m.t + alpha) / m.dur);
      ctx.beginPath();
      const steps = 14;
      for (let s = 0; s <= steps; s++) {
        const ff = Math.max(0, f - 0.18 * (1 - s / steps));
        const [wx, wy] = this.missilePoint(m, ff);
        const px = ox + wx * z, py = oy + wy * z;
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = 'rgba(255,214,150,0.75)';
      ctx.lineWidth = 2;
      ctx.stroke();
      const [hx, hy] = this.missilePoint(m, f);
      const px = ox + hx * z, py = oy + hy * z;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff4d6';
      if (this.quality !== 'low') { ctx.shadowColor = '#ffb347'; ctx.shadowBlur = 12; }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  drawEffects(ox, oy, z) {
    const ctx = this.ctx, g = this.game, now = g.time;
    for (const e of g.effects) {
      const age = now - e.at;
      if (e.type === 'blast') {
        const grow = clamp(age / 0.6, 0, 1);
        const fadeOut = clamp(1 - (age - 0.4) / 2.2, 0, 1);
        if (fadeOut <= 0) continue;
        const sx = ox + e.x * z, sy = oy + e.y * z, r = e.r * z * (0.3 + grow * 1.0);
        if (this.quality === 'low') {
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,150,60,${0.6 * fadeOut})`;
          ctx.fill();
          continue;
        }
        const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        grd.addColorStop(0, `rgba(255,248,220,${0.95 * fadeOut})`);
        grd.addColorStop(0.35, `rgba(255,170,70,${0.8 * fadeOut})`);
        grd.addColorStop(0.75, `rgba(200,60,30,${0.45 * fadeOut})`);
        grd.addColorStop(1, 'rgba(120,30,20,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sx, sy, e.r * z * (0.5 + age * 0.9), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,230,190,${0.5 * fadeOut})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (e.type === 'intercept') {
        const fadeOut = clamp(1 - age / 1.2, 0, 1);
        if (fadeOut <= 0) continue;
        const [wx, wy] = this.missilePoint(e.m, e.arc);
        const sx = ox + wx * z, sy = oy + wy * z;
        ctx.beginPath();
        ctx.arc(sx, sy, 4 + age * 30, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(160,230,255,${fadeOut})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(sx, sy, 3 + age * 8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${fadeOut * 0.8})`;
        ctx.fill();
      }
    }
  }

  // Nation names set like an atlas: letter-spaced small capitals in ink with a paper halo,
  // and the troop count in italic figures underneath.
  drawLabels(ox, oy, z) {
    const ctx = this.ctx, g = this.game;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const spacingOk = 'letterSpacing' in ctx;
    for (let k = 1; k < g.players.length; k++) {
      const p = g.players[k];
      if (!p.alive || !p.spawned) continue;
      const L = p.label;
      const sx = ox + L.x * z, sy = oy + L.y * z;
      let fs = Math.min(L.size * z * 0.5, 38);
      if (fs < (this.quality === 'low' ? 11 : 8)) continue;
      if (!this.visible(sx, sy, 220)) continue;
      const name = p.name;
      // Tribes are peoples rather than states: italic like a map names a people, with the
      // treasure they hold underneath instead of their (small) army.
      const tribe = p.tribe;
      const setName = () => {
        ctx.font = tribe ? `italic 600 ${fs}px ${FONT_BOOK}` : `700 ${fs}px ${FONT_LABEL}`;
        if (spacingOk) ctx.letterSpacing = tribe ? '0px' : `${(fs * 0.14).toFixed(1)}px`;
      };
      setName();
      let w = ctx.measureText(name).width;
      const maxW = L.size * z * 1.9;
      if (w > maxW) {
        fs *= maxW / w;
        if (fs < 8) { if (spacingOk) ctx.letterSpacing = '0px'; continue; }
        setName();
        w = ctx.measureText(name).width;
      }
      const shift = spacingOk && !tribe ? fs * 0.07 : 0;   // the last letter carries trailing spacing
      const mine = p.id === this.myId;
      const ny = sy - fs * 0.38;
      ctx.lineWidth = Math.max(2.5, fs * 0.19);
      ctx.strokeStyle = mine ? 'rgba(246,221,154,0.9)' : 'rgba(243,234,214,0.78)';
      ctx.strokeText(name, sx + shift, ny);
      ctx.fillStyle = INK;
      ctx.fillText(name, sx + shift, ny);
      if (spacingOk) ctx.letterSpacing = '0px';
      const troopFs = Math.max(8, fs * 0.72);
      ctx.font = `italic 500 ${troopFs}px ${FONT_BOOK}`;
      ctx.lineWidth = Math.max(2.5, troopFs * 0.2);
      const t = tribe ? fmtMoney(nicePrice(p.gold)) : fmt(p.troops), ty = sy + fs * 0.55;
      ctx.strokeText(t, sx, ty);
      ctx.fillStyle = tribe ? '#7a5512' : g.isAllied(this.myId, p.id) ? '#1f5e4a' : (mine ? '#6b4a0e' : '#3a2f25');
      ctx.fillText(t, sx, ty);
    }
  }

  drawMode(ox, oy, z) {
    const ctx = this.ctx, g = this.game, mode = this.mode, t = this.hoverTile;
    if (!mode || t < 0) return;
    const W = this.map.W, x = t % W, y = (t - x) / W;
    const sx = ox + (x + 0.5) * z, sy = oy + (y + 0.5) * z;
    if (mode.kind === 'spawn') {
      const ok = g.canSpawnAt(t);
      ctx.beginPath();
      ctx.arc(sx, sy, (SPAWN_RADIUS + 0.5) * z, 0, Math.PI * 2);
      ctx.fillStyle = ok ? rgbCss(g.players[this.myId].color, 0.45) : 'rgba(224,83,61,0.3)';
      ctx.fill();
      ctx.strokeStyle = ok ? '#f4efe2' : '#e0533d';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (mode.kind === 'build') {
      const me = g.players[this.myId];
      const err = g.canBuild(me, mode.type, t);
      const def = BUILDINGS[mode.type];
      if (def.radius) {
        const rad = def.radius + (mode.type === 'fort' ? me.mods.fortRadius : 0);
        ctx.beginPath();
        ctx.arc(sx, sy, rad * z, 0, Math.PI * 2);
        ctx.fillStyle = err ? 'rgba(224,83,61,0.08)' : 'rgba(201,164,76,0.12)';
        ctx.fill();
        ctx.strokeStyle = err ? 'rgba(224,83,61,0.6)' : 'rgba(241,213,138,0.8)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 0.85;
      drawBuildingIcon(ctx, mode.type, sx, sy, clamp(z * 3, 14, 120), err ? [150, 60, 50] : me.color, false, 1, false);
      ctx.globalAlpha = 1;
    } else if (mode.kind === 'missile') {
      const [rIn, rOut] = g.missileRadii(g.players[this.myId]);
      ctx.beginPath();
      ctx.arc(sx, sy, rOut * z, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224,83,61,0.12)';
      ctx.fill();
      ctx.strokeStyle = '#e0533d';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, rIn * z, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,200,170,0.8)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy); ctx.lineTo(sx + 10, sy);
      ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}


// ---------- map symbols ----------
// Every building is a paper token ringed in its owner's colour and stamped with an ink glyph,
// like the symbols on a printed map. Fortresses use the outline of a bastion fort instead.
// Stacked levels show as brass pips under the token.

function starFortPath(ctx, r) {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * 0.62 : r;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}

function polyPath(ctx, u, pts) {
  ctx.moveTo(pts[0] * u, pts[1] * u);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(pts[k] * u, pts[k + 1] * u);
  ctx.closePath();
}

function drawGlyph(ctx, type, u) {
  ctx.beginPath();
  switch (type) {
    case 'city':
      // two houses either side of a church spire
      polyPath(ctx, u, [-0.95, 0.72, -0.95, -0.02, -0.6, -0.38, -0.27, -0.02, -0.27, -0.34, 0, -1.02, 0.27, -0.34,
        0.27, -0.02, 0.6, -0.38, 0.95, -0.02, 0.95, 0.72]);
      ctx.fill();
      break;
    case 'barracks':
      // a swallow-tailed standard on its pole
      ctx.rect(-0.62 * u, -0.95 * u, 0.17 * u, 1.75 * u);
      polyPath(ctx, u, [-0.5, -0.95, 0.9, -0.95, 0.48, -0.56, 0.9, -0.17, -0.5, -0.17]);
      ctx.rect(-0.85 * u, 0.7 * u, 0.62 * u, 0.15 * u);
      ctx.fill();
      break;
    case 'fort':
      ctx.lineWidth = Math.max(1, u * 0.16);
      starFortPath(ctx, u * 0.62);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'harbor':
      ctx.lineWidth = Math.max(1, u * 0.17);
      ctx.arc(0, -0.72 * u, 0.17 * u, 0, Math.PI * 2);
      ctx.moveTo(0, -0.55 * u); ctx.lineTo(0, 0.82 * u);
      ctx.moveTo(-0.42 * u, -0.32 * u); ctx.lineTo(0.42 * u, -0.32 * u);
      ctx.moveTo(-0.8 * u, 0.2 * u);
      ctx.quadraticCurveTo(-0.62 * u, 0.86 * u, 0, 0.84 * u);
      ctx.quadraticCurveTo(0.62 * u, 0.86 * u, 0.8 * u, 0.2 * u);
      ctx.stroke();
      ctx.beginPath();
      polyPath(ctx, u, [-0.96, 0.32, -0.8, 0.05, -0.62, 0.32]);
      polyPath(ctx, u, [0.96, 0.32, 0.8, 0.05, 0.62, 0.32]);
      ctx.fill();
      break;
    case 'university':
      // an open book
      ctx.moveTo(-0.07 * u, -0.5 * u);
      ctx.quadraticCurveTo(-0.5 * u, -0.82 * u, -0.98 * u, -0.6 * u);
      ctx.lineTo(-0.98 * u, 0.58 * u);
      ctx.quadraticCurveTo(-0.5 * u, 0.38 * u, -0.07 * u, 0.72 * u);
      ctx.closePath();
      ctx.moveTo(0.07 * u, -0.5 * u);
      ctx.quadraticCurveTo(0.5 * u, -0.82 * u, 0.98 * u, -0.6 * u);
      ctx.lineTo(0.98 * u, 0.58 * u);
      ctx.quadraticCurveTo(0.5 * u, 0.38 * u, 0.07 * u, 0.72 * u);
      ctx.closePath();
      ctx.fill();
      break;
    case 'courthouse':
      // pediment, three columns and a step
      polyPath(ctx, u, [-0.98, -0.32, 0, -0.98, 0.98, -0.32]);
      ctx.rect(-0.78 * u, -0.2 * u, 0.26 * u, 0.74 * u);
      ctx.rect(-0.13 * u, -0.2 * u, 0.26 * u, 0.74 * u);
      ctx.rect(0.52 * u, -0.2 * u, 0.26 * u, 0.74 * u);
      ctx.rect(-0.98 * u, 0.62 * u, 1.96 * u, 0.24 * u);
      ctx.fill();
      break;
    case 'factory':
      // saw-tooth roof and a chimney
      polyPath(ctx, u, [-0.98, 0.82, -0.98, -0.08, -0.52, -0.46, -0.52, -0.08, -0.06, -0.46, -0.06, -0.08,
        0.38, -0.08, 0.38, -0.98, 0.74, -0.98, 0.74, 0.82]);
      ctx.fill();
      break;
    case 'aa':
      // a radar dish on a mast
      ctx.moveTo(-0.15 * u, -0.1 * u);
      ctx.arc(-0.15 * u, -0.1 * u, 0.72 * u, Math.PI * 0.2, Math.PI * 1.2);
      ctx.closePath();
      ctx.rect(-0.12 * u, 0.0, 0.24 * u, 0.72 * u);
      ctx.rect(-0.62 * u, 0.66 * u, 1.24 * u, 0.2 * u);
      ctx.fill();
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, u * 0.12);
      ctx.moveTo(-0.15 * u, -0.1 * u); ctx.lineTo(0.5 * u, -0.72 * u);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0.55 * u, -0.77 * u, 0.15 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'silo':
    case 'missile':
      if (type === 'missile') ctx.rotate(Math.PI / 4);
      polyPath(ctx, u, [0, -1.02, 0.32, -0.52, 0.32, 0.42, 0.62, 0.86, -0.62, 0.86, -0.32, 0.42, -0.32, -0.52]);
      ctx.fill();
      break;
  }
}

function drawBuildingIcon(ctx, type, x, y, s, color, dim, level = 1, low = false) {
  const h = s / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const rimW = Math.max(1.6, s * 0.11);
  ctx.beginPath();
  if (type === 'fort') starFortPath(ctx, h * 1.08);
  else ctx.arc(0, 0, h, 0, Math.PI * 2);
  if (!low) {
    ctx.lineWidth = rimW + 2.2;
    ctx.strokeStyle = 'rgba(24,18,13,0.72)';
    ctx.stroke();
  }
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = rimW;
  ctx.strokeStyle = rgbCss(color.map((v) => Math.round(v * 0.8)));
  ctx.stroke();
  if (s >= 10) {
    ctx.fillStyle = ctx.strokeStyle = dim ? 'rgba(36,28,21,0.4)' : INK;
    drawGlyph(ctx, type, h * (type === 'fort' ? 0.7 : 0.56));
  }
  ctx.restore();
  if (level > 1) {
    const r = Math.max(1.8, s * 0.075), gap = r * 2.7, y0 = y + h + r + 1.5;
    ctx.beginPath();
    for (let k = 0; k < level; k++) {
      const px = x + (k - (level - 1) / 2) * gap;
      ctx.moveTo(px + r, y0);
      ctx.arc(px, y0, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = '#e6c779';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(24,18,13,0.85)';
    ctx.stroke();
  }
}

// Capital: the atlas symbol, a star inside a ring.
function drawCapital(ctx, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.2);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * 0.3 : r * 0.72;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = rgbCss(color.map((v) => Math.round(v * 0.75)));
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// The troops fighting on a front, on a paper tag edged in the front's colour.
function drawFrontTag(ctx, x, y, label, edge, incoming) {
  ctx.save();
  ctx.font = `700 14px ${FONT_NUM}`;
  const w = ctx.measureText(label).width + 16, h = 21;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 3); else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = incoming ? edge : '#8a6a22';
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
}
