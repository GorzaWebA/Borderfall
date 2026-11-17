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
    desc: 'About 35–40 minutes. Starts in 1500 and ends in 2000. Technologies open up as the years pass. Grow your population, keep your people loyal and hold on to what you conquer.',
  },
  blitz: {
    label: 'Blitz',
    secPerYear: 4.5,      // 1500 to 1700 takes 15 minutes at 1x
    timeGate: false,
    politics: false,
    popGrowth: 0.036,
    research: 1.7,
    attackSpeed: 0.36,
    defense: 1.45,
    attrition: 0.012,
    absorb: 0.3,
    endYear: 1700,
    minutes: 15,
    desc: 'About 15 minutes. Research anything once you know what it builds on. No stability or revolts, faster growth. Ends in 1700 if nobody has won.',
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
const TECHS = [
  // Renaissance
  { id: 'drill', name: 'Military Drill', year: 1500, cost: 120, req: [], kind: 'mil', unlock: ['barracks'], desc: 'Unlocks Barracks.' },
  { id: 'printing', name: 'Printing Press', year: 1500, cost: 120, req: [], kind: 'sci', unlock: ['university'], fx: { research: 0.15 }, desc: 'Unlocks University. Research +15%.' },
  { id: 'cartography', name: 'Cartography', year: 1520, cost: 200, req: [], kind: 'eco', fx: { fleetSpeed: 0.3, fleetCap: 1 }, desc: 'Fleets sail 30% faster. +1 fleet.' },
  { id: 'bastion', name: 'Star Forts', year: 1540, cost: 280, req: ['drill'], kind: 'mil', fx: { fort: 0.5, fortRadius: 2 }, desc: 'Fortresses are 25% stronger and reach 2 tiles farther.' },
  { id: 'crops', name: 'New World Crops', year: 1550, cost: 300, req: ['cartography'], kind: 'eco', fx: { popCap: 0.15 }, desc: 'Land feeds 15% more people.' },
  { id: 'banking', name: 'Banking', year: 1570, cost: 350, req: ['printing'], kind: 'eco', fx: { gold: 0.15 }, desc: 'Gold income +15%.' },
  // Early Modern
  { id: 'standing', name: 'Standing Army', year: 1600, cost: 500, req: ['drill'], kind: 'mil', fx: { mobil: 0.03, recruit: 0.15 }, desc: '3% more of your people can serve. Recruiting +15%.' },
  { id: 'bureaucracy', name: 'Bureaucracy', year: 1610, cost: 550, req: ['printing'], kind: 'gov', unlock: ['courthouse'], fx: { admin: 0.25 }, desc: 'Unlocks Courthouse. Administration +25%.' },
  { id: 'scimethod', name: 'Scientific Method', year: 1640, cost: 650, req: ['printing'], kind: 'sci', fx: { research: 0.25 }, desc: 'Research +25%.' },
  { id: 'mercantilism', name: 'Mercantilism', year: 1650, cost: 700, req: ['banking', 'cartography'], kind: 'eco', fx: { trade: 0.5 }, desc: 'Harbor trade +50%.' },
  { id: 'flintlock', name: 'Flintlock Muskets', year: 1660, cost: 750, req: ['standing'], kind: 'mil', fx: { atk: 0.1 }, desc: 'Attacks lose 10% fewer troops.' },
  { id: 'absolutism', name: 'Absolutism', year: 1680, cost: 800, req: ['bureaucracy'], kind: 'gov', fx: { stability: 8 }, desc: 'Stability +8.' },
  // Enlightenment
  { id: 'agri', name: 'Agricultural Revolution', year: 1720, cost: 1100, req: ['crops', 'scimethod'], kind: 'eco', fx: { popGrowth: 0.3, popCap: 0.2 }, desc: 'Population grows 30% faster. Land feeds 20% more people.' },
  { id: 'constitution', name: 'Constitutionalism', year: 1760, cost: 1300, req: ['absolutism', 'scimethod'], kind: 'gov', fx: { stability: 8, research: 0.1 }, desc: 'Stability +8. Research +10%.' },
  { id: 'levee', name: 'Levée en Masse', year: 1790, cost: 1500, req: ['flintlock'], kind: 'mil', fx: { mobil: 0.06 }, desc: '6% more of your people can serve.' },
  // Industrial
  { id: 'steam', name: 'Steam Power', year: 1800, cost: 1700, req: ['scimethod'], kind: 'sci', unlock: ['factory'], fx: { fleetSpeed: 0.4 }, desc: 'Unlocks Factory. Fleets sail 40% faster.' },
  { id: 'railroad', name: 'Railroads', year: 1830, cost: 2100, req: ['steam'], kind: 'eco', fx: { speed: 0.25, admin: 0.25 }, desc: 'Fronts advance 25% faster. Administration +25%.' },
  { id: 'nationalism', name: 'Nationalism', year: 1840, cost: 2200, req: ['constitution'], kind: 'gov', fx: { stability: 10, weariness: -0.5 }, desc: 'Stability +10. War weariness halved.' },
  { id: 'rifling', name: 'Rifled Arms', year: 1850, cost: 2400, req: ['levee', 'steam'], kind: 'mil', fx: { atk: 0.1, def: 0.1 }, desc: 'Attacks lose 10% fewer troops. Defense +10%.' },
  { id: 'medicine', name: 'Modern Medicine', year: 1870, cost: 2600, req: ['agri'], kind: 'eco', fx: { popGrowth: 0.3 }, desc: 'Population grows 30% faster.' },
  { id: 'electricity', name: 'Electricity', year: 1880, cost: 2900, req: ['steam'], kind: 'sci', fx: { research: 0.2, gold: 0.1 }, desc: 'Research +20%. Gold income +10%.' },
  // Modern
  { id: 'machinegun', name: 'Machine Guns', year: 1900, cost: 3400, req: ['rifling'], kind: 'mil', fx: { def: 0.2 }, desc: 'Defense +20%.' },
  { id: 'combustion', name: 'Combustion Engine', year: 1905, cost: 3600, req: ['electricity', 'railroad'], kind: 'eco', fx: { speed: 0.25, fleetSpeed: 0.3 }, desc: 'Fronts advance 25% faster. Fleets 30% faster.' },
  { id: 'totalwar', name: 'Total War', year: 1914, cost: 4000, req: ['machinegun', 'nationalism'], kind: 'mil', fx: { mobil: 0.06, recruit: 0.2 }, desc: '6% more of your people can serve. Recruiting +20%.' },
  { id: 'radar', name: 'Radar', year: 1935, cost: 4800, req: ['electricity', 'combustion'], kind: 'mil', unlock: ['aa'], desc: 'Unlocks Air Defense.' },
  // Atomic
  { id: 'rocketry', name: 'Rocketry', year: 1944, cost: 5500, req: ['radar'], kind: 'mil', unlock: ['silo'], desc: 'Unlocks Missile Silo.' },
  { id: 'fission', name: 'Nuclear Fission', year: 1950, cost: 7000, req: ['rocketry'], kind: 'mil', fx: { missile: 0.5 }, desc: 'Missiles strike 50% wider and harder.' },
  { id: 'computers', name: 'Computers', year: 1960, cost: 7500, req: ['electricity'], kind: 'sci', fx: { research: 0.25, admin: 0.25 }, desc: 'Research +25%. Administration +25%.' },
];

const TECH_BY_ID = {};
for (const t of TECHS) { t.era = eraIndex(t.year); TECH_BY_ID[t.id] = t; }

function defaultMods() {
  return {
    research: 0, gold: 0, popCap: 0, popGrowth: 0, mobil: 0.08, recruit: 0, atk: 0, def: 0, speed: 0,
    fleetSpeed: 0, fleetCap: 0, trade: 0, admin: 0, stability: 0, weariness: 0, fort: 0, fortRadius: 0, missile: 0,
  };
}
