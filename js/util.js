'use strict';
// Shared helpers: seeded RNG, noise, colours, names, formatting.

function makeRng(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  return rng;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedFromInput(text) {
  const t = String(text || '').trim();
  if (!t) return (Math.random() * 4294967296) >>> 0;
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  return hashString(t);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

class Noise2D {
  constructor(rng) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  static grad(h, x, y) {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x * 1.41;
      case 5: return -x * 1.41;
      case 6: return y * 1.41;
      default: return -y * 1.41;
    }
  }
  noise(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const P = this.perm;
    const u = fade(xf), v = fade(yf);
    const aa = P[P[xi] + yi], ab = P[P[xi] + yi + 1];
    const ba = P[P[xi + 1] + yi], bb = P[P[xi + 1] + yi + 1];
    const x1 = lerp(Noise2D.grad(aa, xf, yf), Noise2D.grad(ba, xf - 1, yf), u);
    const x2 = lerp(Noise2D.grad(ab, xf, yf - 1), Noise2D.grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.75;
  }
  fbm(x, y, octaves) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  }
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [200, 60, 60];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const rgbCss = (c, a) => (a === undefined ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);

function colorDistance(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
}

function fmt(n) {
  n = Math.floor(n);
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 1 : 2).replace(/\.0+$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
  if (abs >= 1e4) return (n / 1e3).toFixed(abs >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
  if (abs >= 1e3) return (n / 1e3).toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + 'K';
  return String(n);
}

function fmtMoney(n) {
  return (n < 0 ? '−$' : '$') + fmt(Math.abs(n));
}

function fmtTime(sec) {
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

const NATION_NAMES = [
  'Aldmere', 'Brightvale', 'Corvania', 'Drakmoor', 'Eastreach', 'Faelund', 'Gorvath', 'Highmarch',
  'Istria', 'Jarnholm', 'Kalvoria', 'Lothmere', 'Myrkwald', 'Norrhaven', 'Ostravia', 'Pellaria',
  'Quorinth', 'Ravenmark', 'Solmara', 'Tarvos', 'Ulmaren', 'Valdris', 'Westhollow', 'Xandrel',
  'Yrsenland', 'Zephyra', 'Ashkarra', 'Belmonte', 'Cindral', 'Duskhaven', 'Emberfall', 'Frosthelm',
  'Glenmora', 'Hallowind', 'Ironvale', 'Jadeport', 'Kestrelia', 'Lunaris', 'Marrowgate', 'Nythera',
  'Obsidra', 'Pyrewatch', 'Ruskvald', 'Saltmarsh', 'Thornwick', 'Umbravia', 'Verdance', 'Wyvernhold',
  'Corsaria', 'Stormcrest', 'Goldmere', 'Tidegard', 'Vossberg', 'Sundara', 'Kharnak', 'Elmshire',
  'Brakken', 'Calderon', 'Mistral', 'Orlenne', 'Pallisade', 'Sevrin', 'Teshkent', 'Varnholt',
  'Aquilonia', 'Barrowmere', 'Carthenne', 'Dunmarrow', 'Estrava', 'Falkreach', 'Galdoria', 'Hesperon',
  'Ilvaria', 'Jorvik', 'Korrin', 'Lysandor', 'Meridia', 'Nordvik', 'Oakhaven', 'Parthis',
  'Rhovanion', 'Sarnath', 'Tolvara', 'Uthmar', 'Vellmoor', 'Westmarch', 'Yarrowby', 'Zarovia',
  'Ambervale', 'Blackmoor', 'Coralis', 'Drovenia', 'Elmaria', 'Fenwick', 'Greystone', 'Harrowgate',
  'Isenmark', 'Kingsreach', 'Larkspur', 'Montclaire', 'Novaria', 'Ostmark', 'Pinecrest', 'Redcliff',
];
