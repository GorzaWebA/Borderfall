'use strict';
// The shop: patterns for your nation's land, bought with crowns earned by playing.
// Patterns are drawn into the map one tile at a time, so they read as part of the pixel map.
// Each pattern is a function of a tile's x and y returning a tone: positive lightens the
// nation's colour there, negative darkens it, 0 leaves it plain.

const SKINS = [
  { id: 'plain', name: 'Plain', desc: 'A flat wash of your colour', price: 0, tone: () => 0 },
  { id: 'barry', name: 'Barry', desc: 'Horizontal bands', price: 0, tone: (x, y) => (y % 6 < 2 ? 1 : 0) },
  { id: 'chequy', name: 'Chequy', desc: 'A chessboard of light and dark', price: 60, tone: (x, y) => (((x >> 2) + (y >> 2)) & 1 ? 0.9 : -0.35) },
  { id: 'seme', name: 'Semé', desc: 'Scattered dots', price: 60, tone: (x, y) => (x % 6 < 2 && (y + ((x / 6 | 0) & 1) * 3) % 6 < 2 ? 1.2 : 0) },
  { id: 'lozengy', name: 'Lozengy', desc: 'Diamonds', price: 120, tone: (x, y) => (Math.abs((x % 8) - 3.5) + Math.abs((y % 8) - 3.5) < 4 ? 0.9 : -0.3) },
  { id: 'chevronny', name: 'Chevronny', desc: 'Stacked chevrons', price: 120, tone: (x, y) => ((y + Math.abs((x % 8) - 4)) % 8 < 3 ? 1 : 0) },
  { id: 'wavy', name: 'Barry wavy', desc: 'Rolling waves', price: 150, tone: (x, y) => (((y + Math.round(Math.sin(x * 0.55) * 1.6)) % 6 + 6) % 6 < 2 ? 1 : 0) },
  {
    id: 'masoned', name: 'Masoned', desc: 'Brickwork', price: 150,
    tone: (x, y) => (y % 4 === 0 || (x + ((y >> 2) & 1) * 4) % 8 === 0 ? -1 : 0.35),
  },
  { id: 'tartan', name: 'Tartan', desc: 'Crossing bands', price: 200, tone: (x, y) => (x % 8 < 2 ? 0.7 : 0) + (y % 8 < 2 ? 0.7 : 0) - (x % 8 === 4 || y % 8 === 4 ? 0.6 : 0) },
  {
    id: 'papelonny', name: 'Papelonny', desc: 'Overlapping scales', price: 200,
    tone: (x, y) => { const row = y >> 2, xx = x + (row & 1) * 2, d = Math.hypot((xx % 4) - 1.5, y % 4); return d > 2.1 && d < 3.1 ? -1 : 0.25; },
  },
  {
    id: 'crusily', name: 'Crusily', desc: 'A field of small crosses', price: 250,
    tone: (x, y) => { const a = x % 7, b = y % 7; return (a === 3 && b >= 2 && b <= 4) || (b === 3 && a >= 2 && a <= 4) ? 1.3 : 0; },
  },
  {
    id: 'stars', name: 'Semé of stars', desc: 'A field of stars', price: 300,
    tone: (x, y) => { const row = STAR_ART[y % 8]; return row && row[(x + ((y >> 3) & 1) * 4) % 8] === '#' ? 1.3 : 0; },
  },
  {
    id: 'ermine', name: 'Ermine', desc: 'The royal fur: a pale field with black tails', price: 400,
    tone: (x, y) => { const row = ERMINE_ART[y % 6]; return row && row[(x + ((y / 6 | 0) & 1) * 3) % 6] === '#' ? -1.6 : 0.7; },
  },
];
const STAR_ART = ['...#....', '..###...', '#######.', '.#####..', '.##.##..', '........', '........', '........'];
const ERMINE_ART = ['..#...', '.###..', '..#...', '.#.#..', '......', '......'];
const SKIN_BY_ID = {};
for (const s of SKINS) SKIN_BY_ID[s.id] = s;

const SHOP_KEY = 'borderfall.shop';
const STARTER_CROWNS = 100;

// Saved progress: crowns, owned patterns, the equipped one, and which one-off rewards are claimed.
function loadShop() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SHOP_KEY) || 'null'); } catch (e) { /* storage unavailable */ }
  if (!d || typeof d !== 'object') d = { crowns: STARTER_CROWNS, owned: [], equipped: 'plain', claimed: [] };
  d.crowns = Math.max(0, Number(d.crowns) || 0);
  d.owned = Array.isArray(d.owned) ? d.owned.filter((id) => SKIN_BY_ID[id]) : [];
  for (const s of SKINS) if (s.price === 0 && !d.owned.includes(s.id)) d.owned.push(s.id);
  if (!SKIN_BY_ID[d.equipped] || !d.owned.includes(d.equipped)) d.equipped = 'plain';
  d.claimed = Array.isArray(d.claimed) ? d.claimed : [];
  return d;
}
function saveShop(d) {
  try { localStorage.setItem(SHOP_KEY, JSON.stringify(d)); } catch (e) { /* storage unavailable */ }
}

// Crowns for a finished (or abandoned after a few minutes) game.
function crownsForGame(g, me) {
  if (!me || !me.spawned) return 0;
  const peak = me.peakTiles / g.map.landCount * 100;
  let c = Math.round(peak) + me.kills * 3 + Math.min(10, Math.floor(g.time / 60));
  if (g.over && g.over.winner === me.id) c += g.mode.politics ? 120 : 60;
  return Math.max(0, c);
}

// The colour a pattern gives a territory tile. r, g, b is the washed colour already mixed with the
// terrain; tone comes from the pattern.
function applySkinTone(rgb, tone) {
  if (!tone) return rgb;
  if (tone > 0) { const k = Math.min(0.32, 0.16 * tone); return [rgb[0] + (246 - rgb[0]) * k, rgb[1] + (238 - rgb[1]) * k, rgb[2] + (220 - rgb[2]) * k]; }
  const k = 1 - Math.min(0.4, 0.2 * -tone);
  return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
}

// A pixel preview of a pattern in a colour over plains, drawn tile by tile like the map.
function paintSkinPreview(canvas, skinId, color) {
  const tw = 36, th = 20, ctx = canvas.getContext('2d');
  canvas.width = tw; canvas.height = th;
  const img = ctx.createImageData(tw, th), plains = TERRAIN[T_PLAINS].color, skin = SKIN_BY_ID[skinId] || SKINS[0];
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const edge = x === 0 || y === 0 || x === tw - 1 || y === th - 1;
      const band = !edge && (x < 3 || y < 3 || x >= tw - 3 || y >= th - 3);
      let c;
      if (edge) c = color.map((v) => v * 0.5);
      else {
        const mix = band ? 0.8 : 0.56;
        c = plains.map((v, k) => v + (color[k] - v) * mix);
        c = applySkinTone(c, skin.tone(x, y));
      }
      const i = (y * tw + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
