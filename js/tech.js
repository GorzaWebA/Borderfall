'use strict';
// Game modes, eras and the technology tree.

const START_YEAR = 1500;

const MODES = {
  realistic: {
    label: 'Realistic',
    secPerYear: 4.5,      // 1500 to 2000 takes about 37 minutes at 1x
    timeGate: true,       // technologies wait for their year
    politics: true,       // stability, control, administration, revolts
    popGrowth: 0.02,
    research: 1,
    attackSpeed: 0.27,    // pre-industrial fronts crawl; railroads and engines speed them up
    defense: 1.7,
    attrition: 0.018,     // share of an offensive lost to supply each second
    absorb: 0.22,         // share of a conquered region's people who join the conqueror
    endYear: 2000,        // if nobody holds 70% by then, the largest nation wins
    minutes: 37,
    desc: 'Technologies open up as the years pass. Grow your population, keep your people loyal and hold on to what you conquer.',
  },
  blitz: {
    label: 'Blitz',
    secPerYear: 4.5,      // 1500 to 1700 takes 15 minutes at 1x
    timeGate: false,
    politics: false,
    openBuildings: true,  // every building, missile silos included, can be built from the start
    popGrowth: 0.036,
    research: 1.05,
    attackSpeed: 0.45,
    defense: 1.45,
    attrition: 0.012,
    absorb: 0.3,
    endYear: 1700,
    minutes: 15,
    desc: 'A fast war. Every building can be built from the start, missile silos included, and research makes you stronger. No stability or revolts, and fronts move quickly.',
  },
};

const ERAS = [
  { name: 'Renaissance', from: 1500 },
  { name: 'Early Modern', from: 1600 },
  { name: 'Enlightenment', from: 1700 },
  { name: 'Industrial', from: 1800 },
  { name: 'Modern', from: 1900 },
  { name: 'Atomic', from: 1945 },
];

function eraIndex(year) {
  let k = 0;
  for (let i = 0; i < ERAS.length; i++) if (year >= ERAS[i].from) k = i;
  return k;
}

// fx keys add to Player.mods. kind: mil | eco | sci | gov (used by AI preferences).
// Costs below are multiplied by TECH_COST_SCALE.
const TECH_COST_SCALE = 3.8;
const TECHS = [
  // Renaissance
  { id: 'drill', name: 'Military Drill', year: 1500, cost: 120, req: [], kind: 'mil', unlock: ['barracks'], desc: 'Unlocks Barracks.', openFx: { recruit: 0.1 }, openDesc: 'Recruiting +10%.' },
  { id: 'printing', name: 'Printing Press', year: 1500, cost: 120, req: [], kind: 'sci', unlock: ['university'], fx: { research: 0.15 }, desc: 'Unlocks University. Research +15%.' },
  { id: 'guilds', name: 'Craft Guilds', year: 1510, cost: 160, req: [], kind: 'eco', fx: { gold: 0.08, buildCost: -0.1 }, desc: 'Income +8%. Buildings cost 10% less.' },
  { id: 'cartography', name: 'Cartography', year: 1520, cost: 200, req: [], kind: 'eco', fx: { fleetSpeed: 0.3, fleetCap: 1 }, desc: 'Fleets sail 30% faster. +1 fleet.' },
  { id: 'pike', name: 'Pike and Shot', year: 1530, cost: 240, req: ['drill'], kind: 'mil', fx: { def: 0.1 }, desc: 'Defense +10%.' },
  { id: 'bastion', name: 'Star Forts', year: 1540, cost: 280, req: ['drill'], kind: 'mil', fx: { fort: 0.5, fortRadius: 2 }, desc: 'Fortresses are 25% stronger and reach 2 tiles farther.' },
  { id: 'crops', name: 'New World Crops', year: 1550, cost: 300, req: ['cartography'], kind: 'eco', fx: { popCap: 0.15 }, desc: 'Land feeds 15% more people.' },
  { id: 'banking', name: 'Banking', year: 1570, cost: 350, req: ['printing'], kind: 'eco', fx: { gold: 0.15 }, desc: 'Income +15%.' },
  // Early Modern
  { id: 'standing', name: 'Standing Army', year: 1600, cost: 500, req: ['drill'], kind: 'mil', fx: { mobil: 0.03, recruit: 0.15 }, desc: '3% more of your people can serve. Recruiting +15%.' },
  { id: 'bureaucracy', name: 'Bureaucracy', year: 1610, cost: 550, req: ['printing'], kind: 'gov', unlock: ['courthouse'], fx: { admin: 0.25 }, desc: 'Unlocks Courthouse. Administration +25%.' },
  { id: 'lineships', name: 'Ships of the Line', year: 1620, cost: 600, req: ['cartography'], kind: 'mil', fx: { fleetCap: 1, fleetSpeed: 0.2 }, desc: '+1 fleet. Fleets sail 20% faster.' },
  { id: 'charters', name: 'Colonial Charters', year: 1630, cost: 620, req: ['cartography', 'banking'], kind: 'eco', fx: { neutral: -0.2 }, desc: 'Settling empty land costs 20% fewer troops.' },
  { id: 'scimethod', name: 'Scientific Method', year: 1640, cost: 650, req: ['printing'], kind: 'sci', fx: { research: 0.25 }, desc: 'Research +25%.' },
  { id: 'mercantilism', name: 'Mercantilism', year: 1650, cost: 700, req: ['banking', 'cartography'], kind: 'eco', fx: { trade: 0.5 }, desc: 'Harbor trade +50%.' },
  { id: 'flintlock', name: 'Flintlock Muskets', year: 1660, cost: 750, req: ['standing'], kind: 'mil', fx: { atk: 0.1 }, desc: 'Attacks lose 10% fewer troops.' },
  { id: 'jointstock', name: 'Joint-Stock Companies', year: 1670, cost: 780, req: ['mercantilism'], kind: 'eco', fx: { gold: 0.1, trade: 0.25 }, desc: 'Income +10%. Harbor trade +25%.' },
  { id: 'absolutism', name: 'Absolutism', year: 1680, cost: 800, req: ['bureaucracy'], kind: 'gov', fx: { stability: 8 }, desc: 'Stability +8.' },
  { id: 'supply', name: 'Supply Trains', year: 1690, cost: 820, req: ['standing'], kind: 'mil', fx: { attrition: -0.25 }, desc: 'Offensives lose 25% fewer troops to supply.' },
  // Enlightenment
  { id: 'agri', name: 'Agricultural Revolution', year: 1720, cost: 1100, req: ['crops', 'scimethod'], kind: 'eco', fx: { popGrowth: 0.3, popCap: 0.2 }, desc: 'Population grows 30% faster. Land feeds 20% more people.' },
  { id: 'canals', name: 'Canals', year: 1730, cost: 1150, req: ['jointstock'], kind: 'eco', fx: { gold: 0.1, admin: 0.1 }, desc: 'Income +10%. Administration +10%.' },
  { id: 'artillery', name: 'Field Artillery', year: 1740, cost: 1200, req: ['flintlock', 'scimethod'], kind: 'mil', fx: { atk: 0.05, fort: 0.25 }, desc: 'Attacks lose 5% fewer troops. Fortresses 12% stronger.' },
  { id: 'encyclopedia', name: 'Encyclopédie', year: 1750, cost: 1250, req: ['scimethod'], kind: 'sci', fx: { research: 0.15 }, desc: 'Research +15%.' },
  { id: 'constitution', name: 'Constitutionalism', year: 1760, cost: 1300, req: ['absolutism', 'scimethod'], kind: 'gov', fx: { stability: 8, research: 0.1 }, desc: 'Stability +8. Research +10%.' },
  { id: 'inoculation', name: 'Inoculation', year: 1770, cost: 1350, req: ['agri'], kind: 'eco', fx: { popGrowth: 0.2 }, desc: 'Population grows 20% faster.' },
  { id: 'census', name: 'Census and Statistics', year: 1780, cost: 1400, req: ['bureaucracy', 'encyclopedia'], kind: 'gov', fx: { admin: 0.1, stability: 2 }, desc: 'Administration +10%. Stability +2.' },
  { id: 'levee', name: 'Levée en Masse', year: 1790, cost: 1500, req: ['flintlock'], kind: 'mil', fx: { mobil: 0.06 }, desc: '6% more of your people can serve.' },
  // Industrial
  { id: 'steam', name: 'Steam Power', year: 1800, cost: 1700, req: ['scimethod'], kind: 'sci', unlock: ['factory'], fx: { fleetSpeed: 0.4 }, desc: 'Unlocks Factory. Fleets sail 40% faster.' },
  { id: 'railroad', name: 'Railroads', year: 1830, cost: 2100, req: ['steam'], kind: 'eco', fx: { speed: 0.25, admin: 0.25 }, desc: 'Fronts advance 25% faster. Administration +25%.' },
  { id: 'nationalism', name: 'Nationalism', year: 1840, cost: 2200, req: ['constitution'], kind: 'gov', fx: { stability: 10, weariness: -0.5 }, desc: 'Stability +10. War weariness halved.' },
  { id: 'telegraph', name: 'Telegraph', year: 1845, cost: 2250, req: ['steam', 'census'], kind: 'gov', fx: { admin: 0.1, speed: 0.1 }, desc: 'Administration +10%. Fronts advance 10% faster.' },
  { id: 'rifling', name: 'Rifled Arms', year: 1850, cost: 2400, req: ['levee', 'steam'], kind: 'mil', fx: { atk: 0.1, def: 0.1 }, desc: 'Attacks lose 10% fewer troops. Defense +10%.' },
  { id: 'ironclads', name: 'Ironclads', year: 1860, cost: 2500, req: ['steam', 'lineships'], kind: 'mil', fx: { fleetCap: 1, fleetSpeed: 0.2 }, desc: '+1 fleet. Fleets sail 20% faster.' },
  { id: 'steel', name: 'Bessemer Steel', year: 1860, cost: 2550, req: ['steam'], kind: 'eco', fx: { buildCost: -0.15, def: 0.05 }, desc: 'Buildings cost 15% less. Defense +5%.' },
  { id: 'medicine', name: 'Modern Medicine', year: 1870, cost: 2600, req: ['inoculation'], kind: 'eco', fx: { popGrowth: 0.3 }, desc: 'Population grows 30% faster.' },
  { id: 'electricity', name: 'Electricity', year: 1880, cost: 2900, req: ['steam'], kind: 'sci', fx: { research: 0.2, gold: 0.1 }, desc: 'Research +20%. Income +10%.' },
  { id: 'schooling', name: 'Public Schooling', year: 1885, cost: 3000, req: ['constitution', 'encyclopedia'], kind: 'sci', fx: { research: 0.15, stability: 2 }, desc: 'Research +15%. Stability +2.' },
  // Modern
  { id: 'machinegun', name: 'Machine Guns', year: 1900, cost: 3400, req: ['rifling'], kind: 'mil', fx: { def: 0.2 }, desc: 'Defense +20%.' },
  { id: 'combustion', name: 'Combustion Engine', year: 1905, cost: 3600, req: ['electricity', 'railroad'], kind: 'eco', fx: { speed: 0.25, fleetSpeed: 0.3 }, desc: 'Fronts advance 25% faster. Fleets 30% faster.' },
  { id: 'assembly', name: 'Assembly Line', year: 1913, cost: 3800, req: ['electricity', 'steel'], kind: 'eco', fx: { gold: 0.15, recruit: 0.1 }, desc: 'Income +15%. Recruiting +10%.' },
  { id: 'totalwar', name: 'Total War', year: 1914, cost: 4000, req: ['machinegun', 'nationalism'], kind: 'mil', fx: { mobil: 0.06, recruit: 0.2 }, desc: '6% more of your people can serve. Recruiting +20%.' },
  { id: 'aviation', name: 'Aviation', year: 1920, cost: 4200, req: ['combustion'], kind: 'mil', fx: { atk: 0.05, speed: 0.1 }, desc: 'Attacks lose 5% fewer troops. Fronts advance 10% faster.' },
  { id: 'welfare', name: 'Welfare State', year: 1930, cost: 4400, req: ['schooling', 'medicine'], kind: 'gov', fx: { stability: 5, popGrowth: 0.1 }, desc: 'Stability +5. Population grows 10% faster.' },
  { id: 'radar', name: 'Radar', year: 1935, cost: 4800, req: ['electricity', 'combustion'], kind: 'mil', unlock: ['aa'], desc: 'Unlocks Air Defense.', openFx: { def: 0.1 }, openDesc: 'Defense +10%.' },
  { id: 'antibiotics', name: 'Antibiotics', year: 1940, cost: 5000, req: ['medicine'], kind: 'eco', fx: { popCap: 0.1, popGrowth: 0.2 }, desc: 'Land feeds 10% more people. Population grows 20% faster.' },
  // Atomic
  { id: 'rocketry', name: 'Rocketry', year: 1944, cost: 5500, req: ['radar'], kind: 'mil', unlock: ['silo'], desc: 'Unlocks Missile Silo.', openFx: { missile: 0.25 }, openDesc: 'Missiles strike 25% wider and harder.' },
  { id: 'fission', name: 'Nuclear Fission', year: 1950, cost: 7000, req: ['rocketry'], kind: 'mil', fx: { missile: 0.5 }, desc: 'Missiles strike 50% wider and harder.' },
  { id: 'jets', name: 'Jet Engines', year: 1952, cost: 7200, req: ['aviation'], kind: 'mil', fx: { speed: 0.2, attrition: -0.2 }, desc: 'Fronts advance 20% faster. Offensives lose 20% fewer troops to supply.' },
  { id: 'computers', name: 'Computers', year: 1960, cost: 7500, req: ['electricity'], kind: 'sci', fx: { research: 0.25, admin: 0.25 }, desc: 'Research +25%. Administration +25%.' },
  { id: 'greenrev', name: 'Green Revolution', year: 1965, cost: 7800, req: ['antibiotics', 'assembly'], kind: 'eco', fx: { popCap: 0.25 }, desc: 'Land feeds 25% more people.' },
  { id: 'satellites', name: 'Satellites', year: 1970, cost: 8500, req: ['rocketry', 'computers'], kind: 'sci', fx: { research: 0.15, missile: 0.25 }, desc: 'Research +15%. Missiles strike 25% wider and harder.' },
  { id: 'internet', name: 'Internet', year: 1985, cost: 9500, req: ['computers'], kind: 'sci', fx: { research: 0.2, gold: 0.15 }, desc: 'Research +20%. Income +15%.' },
];
for (const t of TECHS) t.cost = Math.round(t.cost * TECH_COST_SCALE / 10) * 10;

// In modes where every building is open from the start, a technology's unlock means nothing, so
// its description drops it and the few that only unlocked a building do something else instead.
function techFx(t, mode) {
  return mode && mode.openBuildings && t.openFx ? { ...(t.fx || {}), ...t.openFx } : t.fx;
}
function techDesc(t, mode) {
  if (!mode || !mode.openBuildings || !t.unlock) return t.desc;
  return [t.desc.replace(/Unlocks [^.]*\.\s*/, '').trim(), t.openDesc || ''].filter(Boolean).join(' ');
}

const TECH_BY_ID = {};
for (const t of TECHS) { t.era = eraIndex(t.year); TECH_BY_ID[t.id] = t; }

function defaultMods() {
  return {
    research: 0, gold: 0, popCap: 0, popGrowth: 0, mobil: 0.08, recruit: 0, atk: 0, def: 0, speed: 0,
    fleetSpeed: 0, fleetCap: 0, trade: 0, admin: 0, stability: 0, weariness: 0, fort: 0, fortRadius: 0, missile: 0,
    neutral: 0, buildCost: 0, attrition: 0, troopCap: 0,
  };
}

// ---------- Ideologies ----------
// Each nation may follow one ideology: a set of strengths and weaknesses, plus a tree of six
// doctrines bought with money. Tier I opens two branches, each two doctrines deep, and the
// capstone needs both branches. Moderation is the balanced choice: small bonuses, no drawbacks.
const DOCTRINE_COST = [2000, 6000, 15000, 36000];   // per tier, in old gold units (× MONEY)
const IDEOLOGY_CHANGE_SHOCK = 15;                   // stability lost when you change ideology

const IDEOLOGIES = [
  {
    id: 'crown', name: 'Crown', motto: 'A sovereign who answers to no one.',
    fx: { stability: 7, admin: 0.15, def: 0.08, research: -0.15 },
    tree: [
      { id: 'court', name: 'Royal Court', tier: 0, req: [], fx: { stability: 2, gold: 0.05 } },
      { id: 'intendants', name: 'Intendants', tier: 1, req: ['court'], fx: { admin: 0.15 } },
      { id: 'guard', name: 'Household Guard', tier: 1, req: ['court'], fx: { def: 0.1 } },
      { id: 'roads', name: 'Royal Roads', tier: 2, req: ['intendants'], fx: { admin: 0.1, speed: 0.06 } },
      { id: 'divine', name: 'Divine Right', tier: 2, req: ['guard'], fx: { stability: 4, weariness: -0.25 } },
      { id: 'sunking', name: 'Sun King', tier: 3, req: ['roads', 'divine'], fx: { stability: 3, gold: 0.1, research: 0.12 } },
    ],
  },
  {
    id: 'commerce', name: 'Commerce', motto: 'The state is a trading company.',
    fx: { gold: 0.2, trade: 0.4, recruit: -0.15, troopCap: -0.1 },
    tree: [
      { id: 'ports', name: 'Chartered Ports', tier: 0, req: [], fx: { trade: 0.25 } },
      { id: 'bourse', name: 'Bourse', tier: 1, req: ['ports'], fx: { gold: 0.1 } },
      { id: 'marine', name: 'Merchant Marine', tier: 1, req: ['ports'], fx: { fleetCap: 1, fleetSpeed: 0.2 } },
      { id: 'bank', name: 'Central Bank', tier: 2, req: ['bourse'], fx: { gold: 0.12, buildCost: -0.1 } },
      { id: 'mercenaries', name: 'Mercenary Contracts', tier: 2, req: ['marine'], fx: { recruit: 0.15, troopCap: 0.08 } },
      { id: 'tradeempire', name: 'Trading Empire', tier: 3, req: ['bank', 'mercenaries'], fx: { trade: 0.5, gold: 0.1 } },
    ],
  },
  {
    id: 'militarism', name: 'Militarism', motto: 'The nation exists for its army.',
    fx: { atk: 0.06, recruit: 0.15, gold: -0.15, popGrowth: -0.15 },
    tree: [
      { id: 'drillgrounds', name: 'Drill Grounds', tier: 0, req: [], fx: { recruit: 0.1 } },
      { id: 'academy', name: 'Officer Academy', tier: 1, req: ['drillgrounds'], fx: { atk: 0.05 } },
      { id: 'borders', name: 'Fortified Borders', tier: 1, req: ['drillgrounds'], fx: { def: 0.12, fort: 0.25 } },
      { id: 'shock', name: 'Shock Doctrine', tier: 2, req: ['academy'], fx: { atk: 0.04, speed: 0.1 } },
      { id: 'service', name: 'Universal Service', tier: 2, req: ['borders'], fx: { mobil: 0.02, troopCap: 0.1 } },
      { id: 'inarms', name: 'Nation in Arms', tier: 3, req: ['shock', 'service'], fx: { recruit: 0.12, atk: 0.03, def: 0.05 } },
    ],
  },
  {
    id: 'reason', name: 'Reason', motto: 'Knowledge before tradition.',
    fx: { research: 0.25, recruit: -0.1, stability: -4 },
    tree: [
      { id: 'academies', name: 'Academies', tier: 0, req: [], fx: { research: 0.1 } },
      { id: 'societies', name: 'Learned Societies', tier: 1, req: ['academies'], fx: { research: 0.12 } },
      { id: 'health', name: 'Public Health', tier: 1, req: ['academies'], fx: { popGrowth: 0.2 } },
      { id: 'patents', name: 'Patent Office', tier: 2, req: ['societies'], fx: { research: 0.1, gold: 0.08 } },
      { id: 'rational', name: 'Rational Administration', tier: 2, req: ['health'], fx: { admin: 0.12, stability: 3 } },
      { id: 'agereason', name: 'Age of Reason', tier: 3, req: ['patents', 'rational'], fx: { research: 0.18, popCap: 0.1 } },
    ],
  },
  {
    id: 'frontier', name: 'Frontier', motto: 'There is always more land over the horizon.',
    fx: { neutral: -0.25, speed: 0.1, admin: -0.2, def: -0.08 },
    tree: [
      { id: 'homesteads', name: 'Homesteads', tier: 0, req: [], fx: { neutral: -0.15 } },
      { id: 'pathfinders', name: 'Pathfinders', tier: 1, req: ['homesteads'], fx: { speed: 0.1 } },
      { id: 'settlers', name: 'Settler Towns', tier: 1, req: ['homesteads'], fx: { popCap: 0.1, popGrowth: 0.1 } },
      { id: 'depots', name: 'Supply Depots', tier: 2, req: ['pathfinders'], fx: { attrition: -0.25 } },
      { id: 'grants', name: 'Land Grants', tier: 2, req: ['settlers'], fx: { admin: 0.12, stability: 2 } },
      { id: 'destiny', name: 'Manifest Destiny', tier: 3, req: ['depots', 'grants'], fx: { neutral: -0.15, speed: 0.08, atk: 0.03 } },
    ],
  },
  {
    id: 'moderation', name: 'Moderation', motto: 'A little of everything, nothing in excess.', balanced: true,
    fx: { gold: 0.05, research: 0.05, recruit: 0.05 },
    tree: [
      { id: 'compromise', name: 'Compromise', tier: 0, req: [], fx: { stability: 3, def: 0.03 } },
      { id: 'soundmoney', name: 'Sound Money', tier: 1, req: ['compromise'], fx: { gold: 0.06 } },
      { id: 'militia', name: 'Militia', tier: 1, req: ['compromise'], fx: { def: 0.06, recruit: 0.06 } },
      { id: 'budget', name: 'Balanced Budget', tier: 2, req: ['soundmoney'], fx: { gold: 0.06, research: 0.06 } },
      { id: 'civilservice', name: 'Civil Service', tier: 2, req: ['militia'], fx: { admin: 0.08, stability: 2 } },
      { id: 'goldenmean', name: 'Golden Mean', tier: 3, req: ['budget', 'civilservice'], fx: { gold: 0.06, research: 0.06, recruit: 0.06, def: 0.05 } },
    ],
  },
];
const IDEOLOGY_BY_ID = {};
const DOCTRINE_BY_ID = {};
for (const I of IDEOLOGIES) {
  IDEOLOGY_BY_ID[I.id] = I;
  for (const d of I.tree) {
    d.ideology = I.id;
    d.key = I.id + '.' + d.id;
    d.req = d.req.map((r) => I.id + '.' + r);
    DOCTRINE_BY_ID[d.key] = d;
  }
}

// Effects in words. For these keys a lower number is the good direction.
const FX_LOWER_IS_BETTER = new Set(['neutral', 'buildCost', 'attrition', 'weariness']);
function fxLine(k, v) {
  const pct = Math.round(Math.abs(v) * 100), up = v > 0;
  switch (k) {
    case 'research': return `Research ${up ? '+' : '−'}${pct}%`;
    case 'gold': return `Income ${up ? '+' : '−'}${pct}%`;
    case 'trade': return `Harbor trade ${up ? '+' : '−'}${pct}%`;
    case 'recruit': return `Recruiting ${up ? '+' : '−'}${pct}%`;
    case 'atk': return up ? `Attacks lose ${pct}% fewer troops` : `Attacks lose ${pct}% more troops`;
    case 'def': return `Defense ${up ? '+' : '−'}${pct}%`;
    case 'stability': return `Stability ${up ? '+' : '−'}${Math.abs(v)}`;
    case 'admin': return `Administration ${up ? '+' : '−'}${pct}%`;
    case 'popGrowth': return `Population grows ${pct}% ${up ? 'faster' : 'slower'}`;
    case 'popCap': return `Land feeds ${pct}% ${up ? 'more' : 'fewer'} people`;
    case 'mobil': return `${pct}% ${up ? 'more' : 'fewer'} of your people can serve`;
    case 'speed': return `Fronts advance ${pct}% ${up ? 'faster' : 'slower'}`;
    case 'fleetCap': return `${up ? '+' : '−'}${Math.abs(v)} fleet`;
    case 'fleetSpeed': return `Fleets sail ${pct}% ${up ? 'faster' : 'slower'}`;
    case 'fort': return `Fortresses ${Math.round(Math.abs(v) * 50)}% ${up ? 'stronger' : 'weaker'}`;
    case 'neutral': return `Settling empty land costs ${pct}% ${up ? 'more' : 'fewer'} troops`;
    case 'buildCost': return `Buildings cost ${pct}% ${up ? 'more' : 'less'}`;
    case 'attrition': return `Offensives lose ${pct}% ${up ? 'more' : 'fewer'} troops to supply`;
    case 'troopCap': return `Troop limit ${up ? '+' : '−'}${pct}%`;
    case 'weariness': return `War weariness ${up ? '+' : '−'}${pct}%`;
    default: return `${k} ${v}`;
  }
}
function fxGood(k, v) { return FX_LOWER_IS_BETTER.has(k) ? v < 0 : v > 0; }
function fxSplit(fx) {
  const pros = [], cons = [];
  for (const k in fx) (fxGood(k, fx[k]) ? pros : cons).push(fxLine(k, fx[k]));
  return { pros, cons };
}
