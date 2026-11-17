'use strict';
// Canvas renderer: terrain + territory bitmap, icons, fleets, missiles, labels.

const BORDER_DARKEN = 0.62;
const TERRITORY_MIX = 0.55;
const FALLOUT_COLOR = [96, 112, 54];

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
    this.resize();
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
    this.redrawAll();
  }

  buildTerrain() {
    const m = this.map, { W, H, N } = m, out = this.terrainRGB;
    const deep = TERRAIN[T_DEEP].color, sea = TERRAIN[T_SEA].color;
    const sand = [222, 206, 158];
    for (let i = 0; i < N; i++) {
      const t = m.terrain[i];
      const x = i % W, y = (i - x) / W;
      const n = ((Math.imul(i, 2654435761) >>> 24) / 255 - 0.5) * 8;
      let r, g, b;
      if (t <= T_SEA) {
        const f = clamp((m.waterDist[i] - 1) / 16, 0, 1);
        const k = f * f * (3 - 2 * f);
        r = lerp(sea[0], deep[0], k); g = lerp(sea[1], deep[1], k); b = lerp(sea[2], deep[2], k);
        if (m.waterDist[i] === 1) { r += 14; g += 18; b += 16; }
        r += n * 0.3; g += n * 0.3; b += n * 0.4;
      } else {
        const c = TERRAIN[t].color;
        const h = m.heights[i];
        const hl = x > 0 && y > 0 ? m.heights[i - W - 1] : h;
        const shade = 1 + clamp((h - hl) * 9, -0.22, 0.22) + (h - 0.3) * 0.12;
        r = c[0] * shade; g = c[1] * shade; b = c[2] * shade;
        if (m.coast[i] && t !== T_MOUNTAIN && t !== T_HILLS && t !== T_TUNDRA) {
          r = lerp(r, sand[0], 0.45); g = lerp(g, sand[1], 0.45); b = lerp(b, sand[2], 0.45);
        }
        r += n; g += n; b += n;
      }
      out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
    }
  }

  pixel(i) {
    const d = this.img.data, tr = this.terrainRGB, k = i * 4, j = i * 3;
    const g = this.game;
    const o = g ? g.owner[i] : 0;
    let r = tr[j], gg = tr[j + 1], b = tr[j + 2];
    if (o) {
      const c = g.players[o].color;
      const W = this.map.W, x = i % W, own = g.owner;
      const border = x === 0 || x === W - 1 || i < W || i >= this.map.N - W ||
        own[i - 1] !== o || own[i + 1] !== o || own[i - W] !== o || own[i + W] !== o;
      if (border) {
        r = c[0] * BORDER_DARKEN; gg = c[1] * BORDER_DARKEN; b = c[2] * BORDER_DARKEN;
      } else {
        r = lerp(r, c[0], TERRITORY_MIX); gg = lerp(gg, c[1], TERRITORY_MIX); b = lerp(b, c[2], TERRITORY_MIX);
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
  zoomAt(sx, sy, factor) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const [cx, cy] = this.viewCenter();
    this.cam.zoom = clamp(this.cam.zoom * factor, this.minZoom(), 40);
    this.cam.x = wx - (sx - cx) / this.cam.zoom;
    this.cam.y = wy - (sy - cy) / this.cam.zoom;
    this.clampCam();
  }
  pan(dx, dy) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCam();
  }
  centerOn(x, y, zoom) {
    this.cam.x = x; this.cam.y = y;
    if (zoom) this.cam.zoom = Math.max(this.cam.zoom, zoom);
    this.clampCam();
  }

  // ---------- drawing ----------
  draw(alpha) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#102a40';
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (!this.map) return;
    this.flush();
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
    this.drawFronts(ox, oy, z, now);
    this.drawBuildings(ox, oy, z);
    this.drawCapitals(ox, oy, z);
    this.drawShips(ox, oy, z, alpha);
    this.drawMissiles(ox, oy, z, alpha);
    this.drawEffects(ox, oy, z);
    this.drawLabels(ox, oy, z);
    this.drawMode(ox, oy, z);
  }

  visible(sx, sy, pad) {
    return sx > -pad && sy > -pad && sx < this.cw + pad && sy < this.ch + pad;
  }

  drawCapitals(ox, oy, z) {
    const ctx = this.ctx, g = this.game, W = this.map.W;
    const size = clamp(z * 2.2, 6, 22);
    for (let k = 1; k < g.players.length; k++) {
      const p = g.players[k];
      if (!p.alive || p.capital < 0) continue;
      const x = p.capital % W, y = (p.capital - x) / W;
      const sx = ox + (x + 0.5) * z, sy = oy + (y + 0.5) * z;
      if (!this.visible(sx, sy, size)) continue;
      drawStar(ctx, sx, sy, size * 0.55, p.color);
    }
  }

  startShake(mag, dur) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.shake = { mag, dur, until: performance.now() + dur };
  }

  // Attacks involving me: pulse the contested border and show the troops committed there.
  drawFronts(ox, oy, z, now) {
    const ctx = this.ctx, g = this.game, me = this.myId, W = this.map.W;
    const pulse = 0.5 + 0.5 * Math.sin(now / 200);
    const px = Math.max(2, z);
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
      const rgb = incoming ? '255,72,52' : '255,214,90';
      const sz = Math.max(3, z * 1.6);
      let cx = 0, cy = 0;
      for (const t of tiles) { const x = t % W; cx += x; cy += (t - x) / W; }
      cx /= tiles.length; cy /= tiles.length;
      // Anchor the badge on the actual front: the sampled tile nearest the front's centre.
      let ax = cx, ay = cy, bd = 1e18;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(10,18,26,0.85)';
      ctx.fillStyle = `rgba(${rgb},${0.55 + 0.45 * pulse})`;
      for (const t of tiles) {
        const x = t % W, y = (t - x) / W;
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bd) { bd = d; ax = x; ay = y; }
        const sx = ox + (x + 0.5) * z - sz / 2, sy = oy + (y + 0.5) * z - sz / 2;
        if (sx > -sz && sy > -sz && sx < this.cw && sy < this.ch) { ctx.fillRect(sx, sy, sz, sz); ctx.strokeRect(sx, sy, sz, sz); }
      }
      const bx = ox + (ax + 0.5) * z, by = oy + (ay + 0.5) * z - 20;
      if (!this.visible(bx, by, 60)) continue;
      const label = fmt(a.troops);
      ctx.font = '700 14px "Barlow Condensed", sans-serif';
      const w = ctx.measureText(label).width + 30, h = 22;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx - w / 2, by - h / 2, w, h, 6) : ctx.rect(bx - w / 2, by - h / 2, w, h);
      ctx.fillStyle = 'rgba(11,26,37,0.9)';
      ctx.fill();
      ctx.strokeStyle = `rgb(${rgb})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      // crossed swords
      const sx = bx - w / 2 + 11, sy = by;
      ctx.beginPath();
      ctx.moveTo(sx - 5, sy - 5); ctx.lineTo(sx + 5, sy + 5);
      ctx.moveTo(sx + 5, sy - 5); ctx.lineTo(sx - 5, sy + 5);
      ctx.moveTo(sx - 5, sy + 2); ctx.lineTo(sx - 2, sy + 5);
      ctx.moveTo(sx + 5, sy + 2); ctx.lineTo(sx + 2, sy + 5);
      ctx.strokeStyle = `rgb(${rgb})`;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = '#f4efe2';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sx + 10, by + 1);
    }
  }

  drawBuildings(ox, oy, z) {
    const ctx = this.ctx, g = this.game;
    const low = this.quality === 'low';
    if (low && z < 0.9) return;
    const base = clamp(z * 3.6, 11, 38);
    for (const b of g.buildings) {
      if (!b.alive) continue;
      const lvl = b.level || 1;
      const size = (low ? Math.min(base, 16) : base) * (1 + 0.08 * (lvl - 1));
      const sx = ox + (b.x + 0.5) * z, sy = oy + (b.y + 0.5) * z;
      if (!this.visible(sx, sy, size)) continue;
      const c = g.players[b.owner].color;
      if (!low) {
        ctx.beginPath();
        ctx.arc(sx + 1.5, sy + 2.5, size * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(5,12,18,0.45)';
        ctx.fill();
      }
      drawBuildingIcon(ctx, b.type, sx, sy, size, c, b.cooldown > 0 && (b.type === 'silo' || b.type === 'aa'));
      if (lvl > 1) {
        const r = Math.max(6, size * 0.24), bx = sx + size * 0.45, by = sy - size * 0.45;
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = '#f1d58a';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(11,26,37,0.9)';
        ctx.stroke();
        ctx.fillStyle = '#1b1607';
        ctx.font = `700 ${Math.round(r * 1.5)}px "Barlow Condensed", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(lvl), bx, by + 0.5);
      }
    }
  }

  shipPos(s, alpha) {
    const W = this.map.W, path = s.path;
    const pos = Math.min(path.length - 1, s.pos + (s.dead ? 0 : alpha * SHIP_SPEED));
    const k = Math.floor(pos), f = pos - k;
    const a = path[k], b = path[Math.min(path.length - 1, k + 1)];
    const ax = a % W, ay = (a - ax) / W, bx = b % W, by = (b - bx) / W;
    return [lerp(ax, bx, f) + 0.5, lerp(ay, by, f) + 0.5, Math.atan2(by - ay, bx - ax)];
  }

  drawShips(ox, oy, z, alpha) {
    const ctx = this.ctx, g = this.game;
    const size = clamp(z * 2.2, 6, 20);
    for (const s of g.ships) {
      if (s.dead) continue;
      const [wx, wy, ang] = this.shipPos(s, alpha);
      const sx = ox + wx * z, sy = oy + wy * z;
      if (!this.visible(sx, sy, 40)) continue;
      const c = g.players[s.owner].color;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(size * 0.75, 0);
      ctx.lineTo(size * 0.2, -size * 0.38);
      ctx.lineTo(-size * 0.6, -size * 0.32);
      ctx.lineTo(-size * 0.6, size * 0.32);
      ctx.lineTo(size * 0.2, size * 0.38);
      ctx.closePath();
      ctx.fillStyle = rgbCss(c);
      ctx.strokeStyle = '#f4efe2';
      ctx.lineWidth = Math.max(1, size * 0.1);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (z >= 2.5) {
        ctx.font = `600 ${Math.round(clamp(z * 2.2, 10, 15))}px "Barlow Condensed", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(8,18,28,0.85)';
        ctx.strokeText(fmt(s.troops), sx, sy - size * 0.5);
        ctx.fillStyle = '#f4efe2';
        ctx.fillText(fmt(s.troops), sx, sy - size * 0.5);
      }
    }
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

  drawLabels(ox, oy, z) {
    const ctx = this.ctx, g = this.game;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let k = 1; k < g.players.length; k++) {
      const p = g.players[k];
      if (!p.alive || !p.spawned) continue;
      const L = p.label;
      const sx = ox + L.x * z, sy = oy + L.y * z;
      let fs = Math.min(L.size * z * 0.62, 46);
      if (fs < (this.quality === 'low' ? 11 : 7.5)) continue;
      if (!this.visible(sx, sy, 200)) continue;
      ctx.font = `700 ${fs}px "Barlow Condensed", sans-serif`;
      const w = ctx.measureText(p.name).width;
      const maxW = L.size * z * 1.9;
      if (w > maxW) {
        fs *= maxW / w;
        if (fs < 7.5) continue;
        ctx.font = `700 ${fs}px "Barlow Condensed", sans-serif`;
      }
      const troopFs = fs * 0.78;
      ctx.lineWidth = Math.max(2, fs * 0.16);
      ctx.strokeStyle = 'rgba(10,20,30,0.75)';
      const mine = p.id === this.myId;
      ctx.fillStyle = mine ? '#fff6d8' : '#f4efe2';
      ctx.strokeText(p.name, sx, sy - troopFs * 0.45);
      ctx.fillText(p.name, sx, sy - troopFs * 0.45);
      ctx.font = `600 ${troopFs}px "Barlow Condensed", sans-serif`;
      ctx.lineWidth = Math.max(2, troopFs * 0.16);
      const t = fmt(p.troops);
      ctx.strokeText(t, sx, sy + fs * 0.5);
      ctx.fillStyle = g.isAllied(this.myId, p.id) ? '#9fe0c9' : (mine ? '#f1d58a' : '#e6dfcc');
      ctx.fillText(t, sx, sy + fs * 0.5);
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
      drawBuildingIcon(ctx, mode.type, sx, sy, clamp(z * 3.6, 14, 38), err ? [150, 60, 50] : me.color, false);
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

// Building glyphs: a filled plate in the owner's colour carrying a pale symbol.
function drawBuildingIcon(ctx, type, x, y, s, color, dim) {
  const h = s / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const fill = rgbCss([color[0] * 0.8, color[1] * 0.8, color[2] * 0.8].map(Math.round));
  const ink = dim ? 'rgba(244,239,226,0.45)' : '#f4efe2';
  ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.strokeStyle = '#f4efe2';
  ctx.fillStyle = fill;
  ctx.beginPath();
  if (type === 'fort') {
    ctx.moveTo(0, -h);
    ctx.lineTo(h, -h * 0.55);
    ctx.lineTo(h * 0.8, h * 0.45);
    ctx.lineTo(0, h);
    ctx.lineTo(-h * 0.8, h * 0.45);
    ctx.lineTo(-h, -h * 0.55);
    ctx.closePath();
  } else if (type === 'aa' || type === 'harbor' || type === 'university') {
    ctx.arc(0, 0, h, 0, Math.PI * 2);
  } else if (type === 'courthouse') {
    ctx.moveTo(0, -h);
    ctx.lineTo(h, 0);
    ctx.lineTo(0, h);
    ctx.lineTo(-h, 0);
    ctx.closePath();
  } else if (type === 'silo') {
    ctx.moveTo(0, -h * 1.05);
    ctx.lineTo(h * 0.95, h * 0.8);
    ctx.lineTo(-h * 0.95, h * 0.8);
    ctx.closePath();
  } else {
    const r = s * 0.18;
    ctx.moveTo(-h + r, -h);
    ctx.arcTo(h, -h, h, h, r);
    ctx.arcTo(h, h, -h, h, r);
    ctx.arcTo(-h, h, -h, -h, r);
    ctx.arcTo(-h, -h, h, -h, r);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (s < 9) { ctx.restore(); return; }
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1, s * 0.085);
  ctx.beginPath();
  const u = h * 0.55;
  switch (type) {
    case 'city':
      ctx.moveTo(-u, u * 0.8); ctx.lineTo(-u, -u * 0.1); ctx.lineTo(0, -u * 0.85); ctx.lineTo(u, -u * 0.1); ctx.lineTo(u, u * 0.8);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(-u * 0.25, u * 0.2, u * 0.5, u * 0.6);
      ctx.fill();
      break;
    case 'barracks':
      ctx.moveTo(-u, -u * 0.1); ctx.lineTo(0, -u * 0.75); ctx.lineTo(u, -u * 0.1);
      ctx.moveTo(-u, u * 0.6); ctx.lineTo(0, -u * 0.05); ctx.lineTo(u, u * 0.6);
      ctx.stroke();
      break;
    case 'fort':
      ctx.moveTo(-u * 0.75, -u * 0.35); ctx.lineTo(-u * 0.75, u * 0.65); ctx.lineTo(u * 0.75, u * 0.65); ctx.lineTo(u * 0.75, -u * 0.35);
      ctx.moveTo(-u * 0.75, -u * 0.35); ctx.lineTo(-u * 0.35, -u * 0.35); ctx.lineTo(-u * 0.35, 0);
      ctx.moveTo(u * 0.75, -u * 0.35); ctx.lineTo(u * 0.35, -u * 0.35); ctx.lineTo(u * 0.35, 0);
      ctx.stroke();
      break;
    case 'harbor':
      ctx.moveTo(0, -u * 0.85); ctx.lineTo(0, u * 0.8);
      ctx.moveTo(-u * 0.45, -u * 0.4); ctx.lineTo(u * 0.45, -u * 0.4);
      ctx.moveTo(-u * 0.8, u * 0.15);
      ctx.quadraticCurveTo(-u * 0.6, u * 0.85, 0, u * 0.8);
      ctx.quadraticCurveTo(u * 0.6, u * 0.85, u * 0.8, u * 0.15);
      ctx.stroke();
      break;
    case 'aa':
      ctx.arc(0, u * 0.5, u * 0.95, Math.PI * 1.15, Math.PI * 1.85);
      ctx.moveTo(u * 0.48, u * 0.5 - u * 0.55);
      ctx.arc(0, u * 0.5, u * 0.5, Math.PI * 1.2, Math.PI * 1.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, u * 0.5, u * 0.18, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'university':
      // open book
      ctx.moveTo(0, -u * 0.45); ctx.lineTo(0, u * 0.65);
      ctx.moveTo(0, -u * 0.45); ctx.quadraticCurveTo(-u * 0.45, -u * 0.75, -u * 0.95, -u * 0.5); ctx.lineTo(-u * 0.95, u * 0.45);
      ctx.quadraticCurveTo(-u * 0.45, u * 0.2, 0, u * 0.65);
      ctx.moveTo(0, -u * 0.45); ctx.quadraticCurveTo(u * 0.45, -u * 0.75, u * 0.95, -u * 0.5); ctx.lineTo(u * 0.95, u * 0.45);
      ctx.quadraticCurveTo(u * 0.45, u * 0.2, 0, u * 0.65);
      ctx.stroke();
      break;
    case 'courthouse':
      // columns under a pediment
      ctx.moveTo(-u * 0.75, -u * 0.25); ctx.lineTo(0, -u * 0.75); ctx.lineTo(u * 0.75, -u * 0.25); ctx.closePath();
      ctx.moveTo(-u * 0.5, -u * 0.1); ctx.lineTo(-u * 0.5, u * 0.5);
      ctx.moveTo(0, -u * 0.1); ctx.lineTo(0, u * 0.5);
      ctx.moveTo(u * 0.5, -u * 0.1); ctx.lineTo(u * 0.5, u * 0.5);
      ctx.moveTo(-u * 0.75, u * 0.62); ctx.lineTo(u * 0.75, u * 0.62);
      ctx.stroke();
      break;
    case 'factory':
      // saw-tooth roof with a chimney
      ctx.moveTo(-u * 0.85, u * 0.7); ctx.lineTo(-u * 0.85, -u * 0.05); ctx.lineTo(-u * 0.35, -u * 0.4); ctx.lineTo(-u * 0.35, -u * 0.05);
      ctx.lineTo(u * 0.15, -u * 0.4); ctx.lineTo(u * 0.15, -u * 0.05); ctx.lineTo(u * 0.5, -u * 0.05); ctx.lineTo(u * 0.5, -u * 0.9);
      ctx.lineTo(u * 0.85, -u * 0.9); ctx.lineTo(u * 0.85, u * 0.7); ctx.closePath();
      ctx.stroke();
      break;
    case 'silo':
      ctx.moveTo(0, -u * 0.9); ctx.lineTo(u * 0.3, -u * 0.3); ctx.lineTo(u * 0.3, u * 0.7); ctx.lineTo(-u * 0.3, u * 0.7); ctx.lineTo(-u * 0.3, -u * 0.3);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.restore();
}

// Capital marker: a five-point star in the nation's colour with a pale outline.
function drawStar(ctx, x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = '#f1d58a';
  ctx.strokeStyle = rgbCss([color[0] * 0.55, color[1] * 0.55, color[2] * 0.55].map(Math.round));
  ctx.lineWidth = Math.max(1.2, r * 0.22);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
