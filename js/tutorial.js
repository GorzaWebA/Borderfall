'use strict';
// Tutorials. The controls lesson runs on a hand-laid practice island (buildTutorialMap) and
// teaches one control at a time; the guided game is a real match in which an advisor sets
// objectives and drops tips through most of the game. Neither can be won by conquest: each ends
// with a closing screen when its last step is reached, and the guided game can then be played on.
// Both are plans run by a Coach: a list of steps, each with text, an optional map marker or
// highlighted control, and a test for when it's done.

const TUT_DONE_KEY = 'borderfall.tutorialDone';
const OPTIONAL_SECONDS = 150;   // an optional objective moves on by itself after this long

const tutTribe = (c, spot) => c.ui.game.players.find((p) => p && p.tutSpot === spot);
const tutShare = (c) => c.ui.game.landShare(c.me);
const pctText = (x) => `${Math.round(x * 100)}%`;

const LESSON = {
  id: 'lesson',
  reward: 50,
  label: (i, n) => `Lesson, step ${i} of ${n}`,
  quit: 'Leave the lesson',
  steps: [
    {
      title: 'The controls',
      text: () => 'This lesson teaches the controls on a small practice island. It takes about three minutes, and nobody will attack you.',
      next: 'Start',
    },
    {
      title: 'Found your nation',
      text: () => 'Click inside the gold ring to found your nation there.',
      marks: () => [{ spot: 'home', r: 7, label: 'Found your nation here' }],
      spawnSpot: 'home',
      done: (c) => c.me.spawned,
    },
    {
      title: 'Move the map',
      text: () => 'Drag the map with the mouse, or with a finger on a touch screen. You can also hold W, A, S and D or the arrow keys.',
      enter: (c) => { c.mem.p = c.ui.r.userPanned; },
      done: (c) => c.ui.r.userPanned - c.mem.p > 200,
    },
    {
      title: 'Zoom in and out',
      text: () => 'Scroll the mouse wheel, or pinch on a touch screen. Press H at any time to jump back to your nation.',
      enter: (c) => { c.mem.z = c.ui.r.userZoomed; },
      done: (c) => c.ui.r.userZoomed - c.mem.z > 0.4,
    },
    {
      title: 'Choose how many troops to send',
      text: () => 'The Attack with slider at the bottom sets the share of your troops each click sends; the rest stay home to defend you. Raise it to about 30% while the land around you is empty. Q and E change it too.',
      target: () => document.querySelector('.dock-sliders .slider'),
      done: (c) => c.ui.ratio >= 0.28,
      progress: (c) => `Sending ${Math.round(c.ui.ratio * 100)}%`,
    },
    {
      title: 'Take empty land',
      text: (c) => `Click the empty land to the east, toward the gold ring. Your troops settle it, and your border grows toward the spot you click. Keep going until your border touches the ${esc(tutTribe(c, 'tribe').name)}.`,
      marks: (c) => [{ player: tutTribe(c, 'tribe'), r: 7, label: tutTribe(c, 'tribe').name }],
      done: (c) => { const t = tutTribe(c, 'tribe'); return !t.alive || c.ui.game.neighbors[c.me.id].has(t.id); },
      progress: (c) => `${fmt(c.me.tiles)} tiles`,
    },
    {
      title: 'Absorb a tribe',
      text: (c) => { const t = tutTribe(c, 'tribe'); return `The ${esc(t.name)} are a tribe: a small, weak people sitting on ${fmtMoney(nicePrice(t.gold))} of treasure, shown in gold under their name. Click their land to attack. When the last of it falls, the treasure is yours.`; },
      marks: (c) => { const t = tutTribe(c, 'tribe'); return t.alive ? [{ player: t, r: 7, label: 'Click to attack' }] : []; },
      done: (c) => !tutTribe(c, 'tribe').alive,
      progress: (c) => `${fmt(tutTribe(c, 'tribe').tiles)} of their tiles left`,
    },
    {
      title: 'The right-click menu',
      text: () => 'Right-click your own land; on a touch screen, press and hold. The menu lists what you can build there. On other land it offers attacks, fleets, alliances and gifts.',
      enter: (c) => { c.mem.t = performance.now(); },
      done: (c) => !!(c.ui.lastCtx && c.ui.lastCtx.own && c.ui.lastCtx.at > c.mem.t),
    },
    {
      title: 'Build a city',
      text: () => 'Choose Build city in that menu, or press 1 (or click City in the bottom bar) and then click your land. Building takes ten seconds; the ring around it fills as the work goes on. Cities house people and earn money: watch what yours earns rise above it.',
      target: () => document.querySelector('#builds .bbtn'),
      done: (c) => c.me.counts.city >= 1,
    },
    {
      title: 'Reach the shore',
      skip: (c) => c.me.coastal > 0,
      text: () => 'Fleets sail from your own coast. Click the land to the east until your border reaches the sea.',
      marks: () => [{ tile: tutShore(), r: 5, label: 'The shore' }],
      done: (c) => c.me.coastal > 0,
    },
    {
      title: 'Send a fleet',
      text: (c) => `The ${esc(tutTribe(c, 'islandTribe').name)} live on the island across the strait, which you can only reach by sea. Right-click the water next to the island and choose Send fleet. Fleets sail slowly and wait briefly at anchor before landing.`,
      marks: () => [{ tile: tutStrait(), r: 5, label: 'Right-click the water here' }],
      enter: (c) => { c.mem.f = c.me.fleetsLaunched || 0; },
      done: (c) => (c.me.fleetsLaunched || 0) > c.mem.f,
    },
    {
      title: 'Choose research',
      text: () => 'The buttons at the top right open the big screens. Click Technology (or press T, or click the year) and pick something to research. The research budget at the top of that screen sets how much of your income it gets.',
      target: () => document.querySelector('#command [data-open="tech"]'),
      done: (c) => !!c.me.research && !c.me.autoResearch,
    },
    {
      title: 'Government and ideology',
      text: () => 'Now open Government, or press G. It holds your national priority, army or economy. Beside it is the Ideology tab (or press I): a set of strengths and weaknesses you can build on. Pick one if you like.',
      target: () => document.querySelector('#command [data-open="gov"]'),
      enter: (c) => { c.mem.t = performance.now(); },
      done: (c) => !!(c.ui.lastOpen && (c.ui.lastOpen.tab === 'gov' || c.ui.lastOpen.tab === 'ideo') && c.ui.lastOpen.at > c.mem.t),
    },
    {
      title: 'Pause and speed up',
      text: () => 'Close that screen, then press Space or Pause to stop time, and again to carry on. 2× and 4× make time pass faster.',
      target: () => document.querySelector('#command .speed'),
      check: (c) => { if (c.ui.speed === 0) c.mem.paused = true; },
      done: (c) => !c.ui.modalOpen && ((c.mem.paused && c.ui.speed > 0) || c.ui.speed >= 2),
    },
    // The last step isn't a card: finishing the lesson ends it with a closing screen.
    {
      title: 'Lesson complete',
      text: () => 'You can move around, take land, build, sail and use the big screens. Next comes a guided game: a whole match with an advisor beside you, from your first city to a great power.',
      actions: [['menu', 'Back to the menu', 'ghost'], ['guide', 'Play the guided game', 'primary']],
      final: true,
    },
  ],
};

// The water a few tiles off the practice island's west coast, and the home island's east shore.
function tutStrait() {
  const g = window.borderfall.ui.game, W = g.W, [sx, sy] = TUTORIAL_SPOTS.islandTribe;
  let x = sx;
  while (x > 0 && !g.isWater(sy * W + x)) x--;
  return sy * W + Math.max(0, x - 3);
}
function tutShore() {
  const g = window.borderfall.ui.game, W = g.W, [sx, sy] = TUTORIAL_SPOTS.tribe;
  let x = sx;
  while (x < W - 1 && !g.isWater(sy * W + x + 1)) x++;
  return sy * W + x;
}

const GUIDE = {
  id: 'guide',
  reward: 100,
  label: (i, n) => `Guided game, objective ${i} of ${n}`,
  quit: 'Dismiss the advisor',
  steps: [
    {
      title: 'Choose your homeland',
      text: () => 'This is a real match against twelve rival nations on easy, and nobody will attack you for the first five minutes. Found your nation on open plains, ideally near a coast so you can build harbors and fleets later. Pick for me works too.',
      done: (c) => c.me.spawned,
    },
    {
      title: 'Grab the empty land',
      text: () => 'Raise the Attack slider to 30–40% while the land around you is empty, and click outward in every direction. Empty land costs only a few troops; the race is to claim it before your rivals do.',
      target: () => document.querySelector('.dock-sliders .slider'),
      done: (c) => c.me.tiles >= 700,
      progress: (c) => `${fmt(c.me.tiles)} of 700 tiles`,
    },
    {
      title: 'Build your first city',
      text: () => 'A city costs $2M and takes ten seconds to build. It houses 20,000 people, earns money and extends your administration. Build it well inside your land: press 1, or right-click your land.',
      target: () => document.querySelector('#builds .bbtn'),
      done: (c) => c.me.counts.city >= 1,
      progress: (c) => `Treasury ${fmtMoney(c.me.gold)}`,
    },
    {
      title: 'Set your research',
      text: () => 'Open Technology (T) and choose what to research. Military Drill unlocks barracks; Printing Press unlocks universities. Leave the research budget at 20% for now.',
      target: () => document.querySelector('#command [data-open="tech"]'),
      done: (c) => !!c.me.research && !c.me.autoResearch,
    },
    {
      title: 'Raid a tribe',
      optional: true,
      skip: (c) => !c.ui.game.players.some((p) => p && p.tribe && p.alive),
      text: () => 'Tribes are labelled in italics, with their treasure in gold underneath. Expand until you border one, then attack it: when it falls, its stores are yours.',
      enter: (c) => { c.mem.n = c.ui.game.events.length ? c.ui.game.events[c.ui.game.events.length - 1].id : 0; },
      done: (c) => c.ui.game.events.some((e) => e.id > c.mem.n && e.to === c.me.id && e.text.startsWith('You absorbed')),
    },
    {
      title: 'Choose an ideology',
      optional: true,
      text: () => 'Your nation starts with Moderation: small bonuses and no drawbacks. Open the Ideology screen (press I, or Government and then its Ideology tab) to choose another; the first change is free. Commerce brings money, Militarism a stronger army, Reason faster research. Or keep Moderation and skip this step.',
      target: () => document.querySelector('#command [data-open="gov"]'),
      done: (c) => !c.me.ideologyDefault,
    },
    {
      title: 'Build a harbor',
      optional: true,
      skip: (c) => c.me.coastal === 0,
      text: () => 'Harbors go on the coast. Each one earns trade from every other harbor in the world and adds a fleet. Watch the merchant ships set sail from it.',
      target: () => document.querySelectorAll('#builds .bbtn')[3],
      done: (c) => c.me.counts.harbor >= 1,
    },
    {
      title: 'Make a friend',
      optional: true,
      text: () => 'Right-click a neighbour, or open Diplomacy (P), and propose an alliance. Nations that like you accept, and allies never attack each other. A gift of money warms them up first.',
      target: () => document.querySelector('#command [data-open="dipl"]'),
      done: (c) => c.me.allies.size >= 1,
    },
    {
      title: 'Grow to 5% of the world',
      text: () => 'Keep expanding, and build a second and third city as money comes in: each one soon pays for itself.',
      done: (c) => tutShare(c) >= 0.05,
      progress: (c) => `${pctText(tutShare(c))} of the world`,
    },
    {
      title: 'Win a war',
      text: () => 'Once the empty land is gone, the only way to grow is to take it. Compare troops in the nations list, pick a weaker neighbour, raise the Attack slider and click their land. Keep enough troops at home to defend.',
      check: (c) => {
        const g = c.ui.game;
        for (const a of g.attacks) if (!a.dead && a.attacker === c.me.id && a.target && !g.players[a.target].tribe && a.taken >= 25) c.mem.won = true;
      },
      done: (c) => !!c.mem.won,
    },
    {
      title: 'Strengthen your ideology',
      skip: (c) => !c.me.ideology,
      text: () => 'Open the Ideology screen (I) and buy a doctrine from your ideology\'s tree. The first one opens two branches; the last needs both.',
      target: () => document.querySelector('#command [data-open="gov"]'),
      done: (c) => c.me.doctrines.size >= 1,
    },
    {
      title: 'Build for the long run',
      text: () => 'Barracks raise troops faster and universities speed up research. Build one of each once you have researched them.',
      done: (c) => c.me.counts.barracks >= 1 && c.me.counts.university >= 1,
      progress: (c) => `Barracks ${Math.min(1, c.me.counts.barracks)} of 1, university ${Math.min(1, c.me.counts.university)} of 1`,
    },
    {
      title: 'Set your national priority',
      optional: true,
      text: () => 'In Government, lean your nation toward the army when you are at war and toward the economy in peacetime. Try War footing before your next war.',
      target: () => document.querySelector('#command [data-open="gov"]'),
      done: (c) => Math.abs(c.me.focus - 0.5) > 0.05,
    },
    {
      title: 'Grow to 12% of the world',
      text: () => 'You know everything you need for this: grab land, build cities, keep troops at home, and strike neighbours that are weaker than you.',
      done: (c) => tutShare(c) >= 0.12,
      progress: (c) => `${pctText(tutShare(c))} of the world`,
    },
    {
      title: 'Take to the sea',
      optional: true,
      skip: (c) => c.me.coastal === 0,
      text: () => 'Right-click near a foreign coast and send a fleet. A landing opens a second front behind your enemy\'s lines.',
      enter: (c) => { c.mem.f = c.me.fleetsLaunched || 0; },
      done: (c) => (c.me.fleetsLaunched || 0) > c.mem.f,
    },
    {
      title: 'Govern what you hold',
      skip: (c) => !c.ui.game.politics,
      text: () => 'A big nation needs administration. Research Bureaucracy and build a courthouse: it lets you govern more land and brings nearby land under full control, which keeps stability up.',
      done: (c) => c.me.counts.courthouse >= 1,
    },
    {
      title: 'Grow to 20% of the world',
      text: () => 'Rival nations will band together against whoever grows too big. Keep allies close, strike one enemy at a time, and keep troops at home on every border.',
      done: (c) => tutShare(c) >= 0.2,
      progress: (c) => `${pctText(tutShare(c))} of the world`,
    },
    {
      title: 'Enter the industrial age',
      text: () => 'From 1800, Steam Power unlocks factories, which earn far more than cities and speed up recruiting. Research it and build a factory.',
      done: (c) => c.me.counts.factory >= 1,
      progress: (c) => c.me.techs.has('steam') ? 'Steam Power researched' : `It is ${c.ui.game.year}`,
    },
    {
      title: 'Grow to 30% of the world',
      text: () => 'Railroads and combustion engines speed up your fronts. Use them to push your borders further than ever.',
      done: (c) => tutShare(c) >= 0.3,
      progress: (c) => `${pctText(tutShare(c))} of the world`,
    },
    // Finishing ends the tutorial with a closing screen; you can play on in the same world.
    {
      title: 'Tutorial complete',
      text: () => 'You have the tools to win: land, money, research, ideology, armies and fleets. The guided game ends here. You can carry on in this world on your own, where the usual rules apply: hold 70% of the land, with no time limit.',
      actions: [['keep', 'Keep playing on my own', 'ghost'], ['menu', 'Back to the menu', 'primary']],
      stats: true,
      final: true,
    },
  ],
  // The tutorial ends late in the 1800s whether or not every objective is done.
  handover: (c) => c.ui.game.year >= 1880,
  tips: [
    {
      id: 'attacked',
      when: (c) => c.ui.game.attacks.some((a) => !a.dead && a.target === c.me.id && a.attacker && !c.ui.game.players[a.attacker].tribe),
      text: 'You\'re under attack: the red dots and tag show where, and the wars panel on the left lists every front. Troops at home defend your land, so don\'t send them all away. A fortress makes land near it far harder to take.',
    },
    {
      id: 'fleet',
      when: (c) => c.ui.game.ships.some((s) => !s.dead && s.target === c.me.id),
      text: 'An enemy fleet is sailing for your coast. It waits at anchor before landing, which gives your troops at home time to meet it.',
    },
    {
      id: 'stability',
      when: (c) => c.ui.game.politics && c.me.stability < 40,
      text: 'Stability is falling. Open Government to see why. Cities and courthouses extend your administration, and martial law or a celebration helps in a pinch. Below 30, regions can revolt and break away.',
    },
    {
      id: 'thin',
      when: (c) => c.ui.game.attacks.some((a) => !a.dead && a.attacker === c.me.id && a.target) && c.me.troops < c.ui.game.troopCap(c.me) * 0.12,
      text: 'Almost all your troops are out fighting. If a neighbour attacks now, little stands in the way. Lower the Attack slider, or wait for your troops to regrow.',
    },
    {
      id: 'money',
      check: (c) => {
        const cheapest = Math.min(...BUILD_ORDER.filter((t) => c.ui.game.buildingAvailable(t) && c.ui.game.buildingUnlocked(c.me, t)).map((t) => c.ui.game.buildCost(c.me, t)));
        if (c.me.gold > cheapest * 4) c.tipMem.rich = c.tipMem.rich || c.ui.game.time; else c.tipMem.rich = 0;
      },
      when: (c) => c.tipMem.rich && c.ui.game.time - c.tipMem.rich > 30,
      text: 'Your treasury is piling up. Spend it: cities and harbors earn money back, universities speed up research and barracks raise troops.',
    },
    {
      id: 'era',
      when: (c) => c.ui.game.year >= 1600,
      text: 'A new era has begun. New technologies open with each era, so look at the Technology screen now and then.',
    },
  ],
};

class Coach {
  constructor(ui, plan) {
    this.ui = ui;
    this.game = ui.game;
    this.plan = plan;
    this.step = -1;
    this.mem = {};
    this.tipMem = {};
    this.tipsSeen = new Set();
    this.tip = null;
    this.card = document.getElementById('tutorial');
  }

  get me() { return this.ui.me; }
  get current() { return this.plan.steps[this.step]; }

  begin() {
    this.card.hidden = false;
    this.card.addEventListener('click', this.onClick = (e) => {
      const b = e.target.closest('button[data-tut]');
      if (b) this.act(b.dataset.tut);
    });
    this.go(0);
  }

  go(k) {
    const steps = this.plan.steps;
    while (k < steps.length - 1 && steps[k].skip && steps[k].skip(this)) k++;
    this.step = k;
    this.mem = { since: this.ui.game ? this.ui.game.time : 0 };
    const s = this.current;
    if (s.final) { this.complete(); return; }
    if (s.enter) s.enter(this);
    this.render();
  }

  act(a) {
    if (a === 'next' || a === 'skipstep') this.advance();
    // Leaving the lesson goes back to the menu; dismissing the advisor turns the guided game
    // into an ordinary match, which can be won at 70%.
    else if (a === 'quit') { this.end(); if (this.plan.id === 'lesson') this.ui.backToMenu(); else this.game.coached = false; }
    else if (a === 'tip') { this.tip = null; this.render(); }
  }

  // The last step ends the tutorial: the card goes, the reward is paid once, and a closing
  // screen offers what comes next.
  complete() {
    const s = this.current;
    try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch (e) { /* storage unavailable */ }
    this.end();
    const crowns = this.plan.reward ? this.ui.claimReward(this.plan.id, this.plan.reward) : 0;
    this.ui.showTutorialComplete(this.plan, s, crowns);
  }

  render() {
    // The closing screen isn't counted as a step.
    const s = this.current, n = this.plan.steps.filter((x) => !x.final).length, c = this;
    this.highlight(s.target ? s.target() : null);
    this.updateMarks();
    const actions = `<button type="button" class="text-btn" data-tut="quit">${this.plan.quit}</button>` +
      (s.optional ? '<button type="button" class="ghost" data-tut="skipstep">Skip this</button>' : '') +
      (s.next ? `<button type="button" class="primary" data-tut="next">${s.next}</button>` : (s.optional ? '' : '<span class="tut-wait">Waiting for you…</span>'));
    this.card.innerHTML = `<p class="tut-step">${this.plan.label(this.step + 1, n)}</p>
      <h3>${s.title}</h3><p>${s.text(c)}</p>
      ${s.progress ? `<p class="tut-progress" id="tut-progress">${esc(s.progress(c))}</p>` : ''}
      <div class="tut-actions">${actions}</div>
      ${this.tip ? `<div class="tut-tip"><b>Advisor</b><p>${this.tip.text}</p><button type="button" class="ghost" data-tut="tip">Got it</button></div>` : ''}`;
  }

  highlight(el) {
    if (this.lit) this.lit.classList.remove('tut-target');
    this.lit = el || null;
    if (el) el.classList.add('tut-target');
  }

  // Gold rings on the map: around a spot from TUTORIAL_SPOTS, a tile, or a player's label.
  updateMarks() {
    const s = this.current, g = this.ui.game, W = g.W;
    const marks = [];
    for (const m of (s.marks ? s.marks(this) : [])) {
      if (m.spot) { const [x, y] = TUTORIAL_SPOTS[m.spot]; marks.push({ x: x + 0.5, y: y + 0.5, r: m.r, label: m.label }); }
      else if (m.player && m.player.alive) marks.push({ x: m.player.label.x, y: m.player.label.y, r: m.r, label: m.label });
      else if (m.tile !== undefined && m.tile >= 0) marks.push({ x: (m.tile % W) + 0.5, y: Math.floor(m.tile / W) + 0.5, r: m.r, label: m.label });
    }
    this.ui.r.marks = marks;
  }

  // While the lesson asks you to found your nation in the ring, only spots inside it count.
  spawnOk(tile) {
    const s = this.current;
    if (!s || !s.spawnSpot) return true;
    const W = this.ui.game.W, [x, y] = TUTORIAL_SPOTS[s.spawnSpot];
    return Math.hypot((tile % W) - x, Math.floor(tile / W) - y) <= 7.5;
  }
  spawnTile() {
    const s = this.current;
    if (!s || !s.spawnSpot) return -1;
    const [x, y] = TUTORIAL_SPOTS[s.spawnSpot];
    return y * this.ui.game.W + x;
  }

  // Called by the UI a few times a second.
  check() {
    const s = this.current;
    if (!s || !this.ui.game || this.ui.game !== this.game) return;
    if (this.plan.handover && !s.final && this.plan.handover(this)) { this.go(this.plan.steps.length - 1); return; }
    if (s.check) s.check(this);
    if (s.skip && s.skip(this) && !s.final) { this.advance(); return; }
    if (s.progress) { const el = document.getElementById('tut-progress'); if (el) el.textContent = s.progress(this); }
    if (s.marks) this.updateMarks();
    if (s.done && s.done(this)) { this.advance(); return; }
    // Optional objectives don't hold the advisor up for long.
    if (s.optional && this.ui.game.time - (this.mem.since || 0) > OPTIONAL_SECONDS) { this.advance(); return; }
    if (this.plan.tips && !this.tip && this.me.spawned && !s.final) {
      for (const t of this.plan.tips) {
        if (this.tipsSeen.has(t.id)) continue;
        if (t.check) t.check(this);
        if (t.when(this)) { this.tipsSeen.add(t.id); this.tip = t; this.render(); break; }
      }
    }
  }

  advance() {
    if (this.step >= this.plan.steps.length - 1) { this.complete(); return; }
    this.go(this.step + 1);
  }

  end() {
    this.highlight(null);
    this.ui.r.marks = [];
    this.card.hidden = true;
    this.card.innerHTML = '';
    if (this.onClick) this.card.removeEventListener('click', this.onClick);
    if (this.ui.tutorial === this) this.ui.tutorial = null;
  }
}
