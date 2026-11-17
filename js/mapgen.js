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

const MAP_TYPES = {
  continents: { label: 'Continents', freq: 2.4, warp: 0.35, edge: 0.07, land: 0.42, mount: 0.06, hills: 0.13 },
  pangaea: { label: 'Pangaea', freq: 2.0, warp: 0.3, edge: 0.1, land: 0.5, radial: 1.2, mount: 0.06, hills: 0.13 },
  archipelago: { label: 'Archipelago', freq: 4.2, warp: 0.25, edge: 0.05, land: 0.34, mount: 0.05, hills: 0.12 },
  highlands: { label: 'Highlands', freq: 2.8, warp: 0.4, edge: 0.06, land: 0.55, mount: 0.11, hills: 0.22 },
};

function generateMap(opts) {
  const size = MAP_SIZES[opts.size] || MAP_SIZES.medium;
  const P = MAP_TYPES[opts.type] || MAP_TYPES.continents;
  const W = size.w, H = size.h, N = W * H;
  const rng = makeRng(opts.seed);
  const nE = new Noise2D(rng), nW = new Noise2D(rng), nM = new Noise2D(rng), nT = new Noise2D(rng);
  const offX = rng() * 200, offY = rng() * 200;

  const elev = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = x / H + offX, ny = y / H + offY;
      const wx = nW.fbm(nx * 1.5 + 11.3, ny * 1.5 + 3.7, 4) * P.warp;
      const wy = nW.fbm(nx * 1.5 + 47.1, ny * 1.5 + 21.9, 4) * P.warp;
      let e = nE.fbm((nx + wx) * P.freq, (ny + wy) * P.freq, 6);
      const ex = x / W, ey = y / H;
      const edge = Math.min(ex, 1 - ex, ey, 1 - ey);
      e -= (1 - smoothstep(0, P.edge, edge)) * 0.6;
      if (P.radial) {
        const dx = (ex - 0.5) * 2, dy = (ey - 0.5) * 2;
        e += (0.55 - Math.sqrt(dx * dx + dy * dy)) * P.radial * 0.5;
      }
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

  for (let y = 0; y < H; y++) {
    const lat = Math.abs(y / H - 0.5) * 2;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elev[i];
      if (e < sea) { terrain[i] = T_SEA; continue; }
      const nx = x / H + offX, ny = y / H + offY;
      const h = (e - sea) / (top - sea);
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
  }

  cleanupComponents(W, H, terrain);

  // Distance from land into water (for depth shading and deep/shallow split).
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
  const heights = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (TERRAIN[terrain[i]].water) {
      if (waterDist[i] > 4) terrain[i] = T_DEEP;
      heights[i] = 0;
      continue;
    }
    landCount++;
    heights[i] = clamp((elev[i] - sea) / (top - sea), 0, 1);
    const x = i % W, y = (i - x) / W;
    if ((x > 0 && TERRAIN[terrain[i - 1]].water) || (x < W - 1 && TERRAIN[terrain[i + 1]].water) ||
        (y > 0 && TERRAIN[terrain[i - W]].water) || (y < H - 1 && TERRAIN[terrain[i + W]].water)) coast[i] = 1;
  }

  return { W, H, N, terrain, heights, coast, waterDist, landCount, seed: opts.seed, type: opts.type, size: opts.size };
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
