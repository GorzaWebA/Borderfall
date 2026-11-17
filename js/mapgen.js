'use strict';
// Procedural world generation.

const T_DEEP = 0, T_SEA = 1, T_PLAINS = 2, T_FOREST = 3, T_DESERT = 4, T_TUNDRA = 5, T_HILLS = 6, T_MOUNTAIN = 7;

// cost: troops multiplier to take a tile, speed: how fast fronts advance,
// def: defender multiplier, value: contributes to troop cap and gold income.
const TERRAIN = [
  { name: 'Deep ocean', water: true, color: [16, 42, 64] },
  { name: 'Sea', water: true, color: [30, 72, 102] },
  { name: 'Plains', cost: 1.0, speed: 1.0, def: 1.0, value: 1.0, color: [128, 158, 90] },
  { name: 'Forest', cost: 1.35, speed: 0.7, def: 1.25, value: 0.85, color: [66, 112, 64] },
  { name: 'Desert', cost: 1.1, speed: 0.9, def: 0.95, value: 0.45, color: [214, 192, 134] },
  { name: 'Tundra', cost: 1.2, speed: 0.8, def: 1.05, value: 0.55, color: [176, 184, 170] },
  { name: 'Hills', cost: 1.6, speed: 0.55, def: 1.5, value: 0.75, color: [150, 136, 96] },
  { name: 'Mountains', cost: 2.4, speed: 0.32, def: 2.1, value: 0.35, color: [122, 112, 106] },
];

const T_COST = new Float32Array(TERRAIN.map((t) => t.cost || 0));
const T_SPEED = new Float32Array(TERRAIN.map((t) => t.speed || 0));
const T_DEF = new Float32Array(TERRAIN.map((t) => t.def || 0));
const T_VALUE = new Float32Array(TERRAIN.map((t) => t.value || 0));

const MAP_SIZES = {
  small: { label: 'Small', w: 420, h: 260 },
  medium: { label: 'Medium', w: 560, h: 350 },
  large: { label: 'Large', w: 720, h: 450 },
};

// Random worlds. Competitive maps are mirrored or rotated copies of one region so
// every part of the map has a twin; they always use the same terrain seed.
const MAP_TYPES = {
  continents: { label: 'Continents', freq: 2.4, warp: 0.35, edge: 0.07, land: 0.42, mount: 0.06, hills: 0.13 },
  pangaea: { label: 'Pangaea', freq: 2.0, warp: 0.3, edge: 0.1, land: 0.5, radial: 1.2, mount: 0.06, hills: 0.13 },
  archipelago: { label: 'Archipelago', freq: 4.2, warp: 0.25, edge: 0.05, land: 0.34, mount: 0.05, hills: 0.12 },
  highlands: { label: 'Highlands', freq: 2.8, warp: 0.4, edge: 0.06, land: 0.55, mount: 0.11, hills: 0.22 },
  duel: {
    label: 'Mirror Strait', competitive: true, w: 600, h: 340, seed: 7301, sym: 'x', ai: 9,
    freq: 3.0, warp: 0.3, edge: 0.06, land: 0.5, mount: 0.07, hills: 0.14,
    desc: 'Two mirrored continents face each other across a strait, joined by a single land bridge.',
    shape(ex, ey) {
      const fx = Math.min(ex, 1 - ex);
      const lobe = 0.62 - Math.hypot((fx - 0.24) / 0.3, (ey - 0.5) / 0.46);
      const strait = Math.exp(-(((ex - 0.5) / 0.04) ** 2));
      const bridges = Math.exp(-(((ey - 0.3) / 0.045) ** 2)) + Math.exp(-(((ey - 0.7) / 0.045) ** 2));
      return lobe * 0.55 - 0.6 * strait + 0.85 * strait * Math.min(1, bridges);
    },
  },
  quad: {
    label: 'Four Kingdoms', competitive: true, w: 520, h: 520, seed: 9142, sym: 'xy', ai: 11,
    freq: 3.2, warp: 0.3, edge: 0.06, land: 0.48, mount: 0.07, hills: 0.14,
    desc: 'Four identical realms in two pairs, with a contested island in the middle.',
    shape(ex, ey) {
      const fx = Math.min(ex, 1 - ex), fy = Math.min(ey, 1 - ey);
      let e = (0.6 - Math.hypot((fx - 0.25) / 0.22, (fy - 0.25) / 0.22)) * 0.6;
      const chx = Math.exp(-(((ex - 0.5) / 0.04) ** 2)), chy = Math.exp(-(((ey - 0.5) / 0.04) ** 2));
      e -= 0.55 * Math.max(chx, chy);
      // One crossing over each arm of the channel cross, and a central island.
      e += 0.9 * chy * Math.exp(-(((fx - 0.27) / 0.035) ** 2));
      e += 0.9 * chx * Math.exp(-(((fy - 0.27) / 0.035) ** 2));
      e += 1.6 * Math.exp(-((ex - 0.5) ** 2 + (ey - 0.5) ** 2) / 0.004);
      return e;
    },
  },
  ring: {
    label: 'Ring Sea', competitive: true, w: 540, h: 540, seed: 5520, sym: 'rot6', ai: 11,
    freq: 3.4, warp: 0.25, edge: 0.05, land: 0.4, mount: 0.07, hills: 0.13,
    desc: 'A ring of land with six matching sectors around an inner sea and its island.',
    shape(ex, ey) {
      const r = Math.hypot(ex - 0.5, ey - 0.5) / 0.5;
      return 0.75 * Math.exp(-(((r - 0.64) / 0.19) ** 2)) - 0.45 * Math.exp(-((r / 0.33) ** 2)) +
        0.85 * Math.exp(-((r / 0.09) ** 2)) - 0.4;
    },
  },
  isthmus: {
    label: 'Twin Continents', competitive: true, w: 560, h: 420, seed: 3317, sym: 'y', ai: 9,
    freq: 2.8, warp: 0.3, edge: 0.06, land: 0.46, mount: 0.07, hills: 0.14,
    desc: 'North and south mirror each other, joined by one mountainous isthmus.',
    shape(ex, ey) {
      const fy = Math.min(ey, 1 - ey);
      let e = (0.62 - Math.hypot((ex - 0.5) / 0.44, (fy - 0.2) / 0.19)) * 0.6;
      e -= 0.55 * Math.exp(-(((ey - 0.5) / 0.07) ** 2));
      e += 0.75 * Math.exp(-(((ex - 0.5) / 0.05) ** 2) - (((ey - 0.5) / 0.16) ** 2));
      e += 0.35 * Math.exp(-(((ex - 0.5) / 0.015) ** 2) - (((ey - 0.5) / 0.1) ** 2));
      return e;
    },
  },
};

// Real-world maps live in maps/<id>.js and load only when picked.
const PREMADE_LIST = [
  { id: 'world', label: 'World', ai: 24 },
  { id: 'europe', label: 'Europe', ai: 18 },
  { id: 'africa', label: 'Africa', ai: 16 },
  { id: 'americas', label: 'The Americas', ai: 18 },
  { id: 'namerica', label: 'North America', ai: 14 },
  { id: 'samerica', label: 'South America', ai: 10 },
  { id: 'oceania', label: 'Oceania', ai: 12 },
  { id: 'cyprus', label: 'Cyprus', ai: 6 },
];
const PREMADE = {};
const MAP_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function isPremade(type) { return PREMADE_LIST.some((m) => m.id === type); }
function isFixedMap(type) { return isPremade(type) || !!(MAP_TYPES[type] && MAP_TYPES[type].competitive); }
function mapLabel(type) {
  const p = PREMADE_LIST.find((m) => m.id === type);
  return p ? p.label : (MAP_TYPES[type] || MAP_TYPES.continents).label;
}
function recommendedRivals(type) {
  const p = PREMADE_LIST.find((m) => m.id === type);
  if (p) return p.ai;
  return MAP_TYPES[type] && MAP_TYPES[type].ai;
}

function registerPremadeMap(meta, data) { PREMADE[meta.id] = { meta, data }; }

function loadPremadeMap(id) {
  if (PREMADE[id]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `maps/${id}.js`;
    s.onload = () => (PREMADE[id] ? resolve() : reject(new Error('Map file was empty.')));
    s.onerror = () => { s.remove(); reject(new Error('Map file failed to load.')); };
    document.head.appendChild(s);
  });
}

function buildPremadeMap(id, seed) {
  const { meta, data } = PREMADE[id];
  const W = meta.w, H = meta.h, N = W * H;
  const lookup = new Int8Array(128).fill(0);
  for (let k = 0; k < MAP_ALPHA.length; k++) lookup[MAP_ALPHA.charCodeAt(k)] = k;
  const terrain = new Uint8Array(N);
  const raw = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = lookup[data.charCodeAt(i)];
    terrain[i] = c >> 3;
    raw[i] = (c & 7) / 7;
  }
  // Soften the stored height steps (two box-blur passes) and add fine texture for hillshading.
  const R = meta.blur || 2;
  const tmp = new Float32Array(N), smooth = raw.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      const row = y * W;
      for (let x = -R; x <= R; x++) acc += smooth[row + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = acc / (2 * R + 1);
        acc += smooth[row + Math.min(W - 1, x + R + 1)] - smooth[row + Math.max(0, x - R)];
      }
    }
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let y = -R; y <= R; y++) acc += tmp[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        smooth[y * W + x] = acc / (2 * R + 1);
        acc += tmp[Math.min(H - 1, y + R + 1) * W + x] - tmp[Math.max(0, y - R) * W + x];
      }
    }
  }
  const heights = new Float32Array(N);
  const nz = new Noise2D(makeRng(hashString(id)));
  for (let i = 0; i < N; i++) {
    const t = terrain[i];
    if (t <= T_SEA) continue;
    const x = i % W, y = (i - x) / W;
    const rough = t === T_MOUNTAIN ? 0.09 : t === T_HILLS ? 0.06 : 0.025;
    heights[i] = clamp(smooth[i] * 0.8 + 0.08 + nz.fbm(x / 9, y / 9, 3) * rough, 0, 1);
  }
  return finalizeMap(W, H, terrain, heights, { seed, type: id, size: 'fixed', name: meta.name });
}

function generateMap(opts) {
  const P = MAP_TYPES[opts.type] || MAP_TYPES.continents;
  const size = MAP_SIZES[opts.size] || MAP_SIZES.medium;
  const W = P.competitive ? P.w : size.w, H = P.competitive ? P.h : size.h, N = W * H;
  const rng = makeRng(P.competitive ? P.seed : opts.seed);
  const nE = new Noise2D(rng), nW = new Noise2D(rng), nM = new Noise2D(rng), nT = new Noise2D(rng);
  const offX = rng() * 200, offY = rng() * 200;
  const cx = (W - 1) / 2, cy = (H - 1) / 2, seg = Math.PI / 3;
  // Map a tile onto its canonical twin so mirrored areas get identical noise.
  const fold = (x, y) => {
    if (P.sym === 'x') return [Math.min(x, W - 1 - x), y];
    if (P.sym === 'y') return [x, Math.min(y, H - 1 - y)];
    if (P.sym === 'xy') return [Math.min(x, W - 1 - x), Math.min(y, H - 1 - y)];
    if (P.sym === 'rot6') {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      let th = ((Math.atan2(dy, dx) % seg) + seg) % seg;
      if (th > seg / 2) th = seg - th;
      return [cx + r * Math.cos(th), cy + r * Math.sin(th)];
    }
    return [x, y];
  };

  const elev = new Float32Array(N);
  const fx = new Float32Array(N), fy = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const [ax, ay] = fold(x, y);
      fx[i] = ax; fy[i] = ay;
      const nx = ax / H + offX, ny = ay / H + offY;
      const wx = nW.fbm(nx * 1.5 + 11.3, ny * 1.5 + 3.7, 4) * P.warp;
      const wy = nW.fbm(nx * 1.5 + 47.1, ny * 1.5 + 21.9, 4) * P.warp;
      let e = nE.fbm((nx + wx) * P.freq, (ny + wy) * P.freq, 6);
      const ex = x / (W - 1), ey = y / (H - 1);
      const edge = Math.min(ex, 1 - ex, ey, 1 - ey);
      e -= (1 - smoothstep(0, P.edge, edge)) * 0.6;
      if (P.radial) {
        const dx = (ex - 0.5) * 2, dy = (ey - 0.5) * 2;
        e += (0.55 - Math.sqrt(dx * dx + dy * dy)) * P.radial * 0.5;
      }
      if (P.shape) e += P.shape(ex, ey);
      elev[i] = e;
    }
  }

  const sorted = Float32Array.from(elev).sort();
  const sea = sorted[Math.floor((1 - P.land) * (N - 1))];
  const top = sorted[N - 1];

  const terrain = new Uint8Array(N);
  const landVals = [];
  for (let i = 0; i < N; i++) if (elev[i] >= sea) landVals.push(elev[i]);
  const lv = Float32Array.from(landVals).sort();
  const mountQ = lv[Math.floor((1 - P.mount) * (lv.length - 1))];
  const hillQ = lv[Math.floor((1 - P.mount - P.hills) * (lv.length - 1))];

  const heights = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const e = elev[i];
    if (e < sea) { terrain[i] = T_SEA; continue; }
    const nx = fx[i] / H + offX, ny = fy[i] / H + offY;
    const lat = Math.abs(fy[i] / H - 0.5) * 2;
    const h = (e - sea) / (top - sea);
    heights[i] = clamp(h, 0, 1);
    const m = nM.fbm(nx * 2.4 + 5, ny * 2.4 + 9, 5) * 1.6 + 0.5;
    const t = 1 - lat * lat * 1.1 + nT.fbm(nx * 3 + 2, ny * 3 + 7, 3) * 0.35 - h * 0.25;
    let ter;
    if (e >= mountQ) ter = T_MOUNTAIN;
    else if (e >= hillQ) ter = T_HILLS;
    else if (t < 0.12) ter = T_TUNDRA;
    else if (m < 0.36 && t > 0.5) ter = T_DESERT;
    else if (m > 0.53) ter = T_FOREST;
    else ter = T_PLAINS;
    terrain[i] = ter;
  }

  cleanupComponents(W, H, terrain);
  return finalizeMap(W, H, terrain, heights, { seed: opts.seed, type: opts.type, size: P.competitive ? 'fixed' : opts.size, name: P.label });
}

// Shared finishing: water depth, deep/shallow split, coastlines and land count.
function finalizeMap(W, H, terrain, heights, meta) {
  const N = W * H;
  const waterDist = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) {
    if (!TERRAIN[terrain[i]].water) { waterDist[i] = 0; queue[qt++] = i; } else waterDist[i] = 255;
  }
  while (qh < qt) {
    const i = queue[qh++];
    const d = waterDist[i];
    if (d >= 30) continue;
    const x = i % W, y = (i - x) / W;
    if (x > 0 && waterDist[i - 1] > d + 1) { waterDist[i - 1] = d + 1; queue[qt++] = i - 1; }
    if (x < W - 1 && waterDist[i + 1] > d + 1) { waterDist[i + 1] = d + 1; queue[qt++] = i + 1; }
    if (y > 0 && waterDist[i - W] > d + 1) { waterDist[i - W] = d + 1; queue[qt++] = i - W; }
    if (y < H - 1 && waterDist[i + W] > d + 1) { waterDist[i + W] = d + 1; queue[qt++] = i + W; }
  }
  const coast = new Uint8Array(N);
  let landCount = 0;
  for (let i = 0; i < N; i++) {
    if (TERRAIN[terrain[i]].water) {
      terrain[i] = waterDist[i] > 4 ? T_DEEP : T_SEA;
      heights[i] = 0;
      continue;
    }
    landCount++;
    const x = i % W, y = (i - x) / W;
    if ((x > 0 && TERRAIN[terrain[i - 1]].water) || (x < W - 1 && TERRAIN[terrain[i + 1]].water) ||
        (y > 0 && TERRAIN[terrain[i - W]].water) || (y < H - 1 && TERRAIN[terrain[i + W]].water)) coast[i] = 1;
  }
  return { W, H, N, terrain, heights, coast, waterDist, landCount, ...meta };
}

// Remove specks of land and fill tiny lakes so the map reads cleanly.
function cleanupComponents(W, H, terrain) {
  const N = W * H;
  const comp = new Int32Array(N).fill(-1);
  const queue = new Int32Array(N);
  const isWater = (i) => TERRAIN[terrain[i]].water;
  let id = 0;
  for (let s = 0; s < N; s++) {
    if (comp[s] !== -1) continue;
    const water = isWater(s);
    let qh = 0, qt = 0;
    queue[qt++] = s; comp[s] = id;
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % W, y = (i - x) / W;
      const nbs = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of nbs) {
        if (n < 0 || comp[n] !== -1 || isWater(n) !== water) continue;
        comp[n] = id; queue[qt++] = n;
      }
    }
    const minSize = water ? 90 : 40;
    if (qt < minSize) {
      for (let k = 0; k < qt; k++) terrain[queue[k]] = water ? T_PLAINS : T_SEA;
    }
    id++;
  }
}
