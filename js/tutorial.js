'use strict';
// Guided first game: a small, gentle world and a card that walks through the basics.

const TUTORIAL_STEPS = [
  {
    title: 'Welcome to Borderfall',
    text: 'You lead a young nation in the year 1500. Grow it by taking land, raising people, building cities and researching new technology. This short tour shows you how. Nobody will attack you while you learn.',
    next: 'Show me',
  },
  {
    title: 'Found your nation',
    text: 'Click any green, unclaimed land to start your nation there. The colored patches already belong to rival nations.',
    done: (ui) => ui.me.spawned,
  },
  {
    title: 'Expand into the wilds',
    text: 'Click empty land a little beyond your border. Your troops settle it, and your border grows toward the spot you clicked. Keep clicking in different directions until you hold about 400 tiles.',
    target: () => document.querySelector('#topbar .stat:nth-child(4)'),
    done: (ui) => ui.me.tiles >= 400,
    progress: (ui) => `${Math.min(400, ui.me.tiles)} of 400 tiles`,
  },
  {
    title: 'How many troops to send',
    text: 'This slider sets the share of your troops each click sends. Troops that stay home defend your borders, so send less once you have neighbors. Q and E change it from the keyboard.',
    target: () => document.querySelector('.dock-sliders .slider'),
    next: 'Got it',
  },
  {
    title: 'People and money',
    text: 'Your people grow toward what your land can feed. Workers pay taxes into your treasury, and your soldiers are drawn from your people. More land means more of both. Later, the Government screen lets you lean your nation toward its army or its economy.',
    target: () => document.getElementById('topbar'),
    next: 'Next',
  },
  {
    title: 'Build a city',
    text: 'Press 1, or click City below, then click well inside your land. Cities house 20,000 people, earn money and keep distant land under control. You have been given enough money for one.',
    target: () => document.querySelector('#builds .bbtn'),
    done: (ui) => ui.me.counts.city >= 1,
  },
  {
    title: 'Research technology',
    text: 'Click the year at the top, or Technology in the top right, to open the technology tree, then pick something to research. The research budget at the top of that screen sets how much of your income goes to research.',
    target: () => document.getElementById('st-year'),
    done: (ui) => !!ui.me.research && !ui.me.autoResearch,
  },
  {
    title: 'Keep your people loyal',
    text: 'Stability shows how orderly your nation is. Expanding faster than your cities can govern, holding freshly conquered land, and costly wars all lower it. Below 30, regions can revolt and break away. Click it any time for the details and for policies like martial law.',
    target: () => document.getElementById('st-stability'),
    next: 'Next',
  },
  {
    title: 'Rivals and diplomacy',
    text: 'When your border meets a rival, click their land to attack it, or right-click it to propose an alliance or send money. Right-click near a coast to send a fleet. Hold 70% of the world, or be the largest nation in 2000, to win.',
    next: 'Start playing',
  },
];

class Tutorial {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.step = 0;
    this.card = document.getElementById('tutorial');
  }

  begin() {
    this.card.hidden = false;
    this.card.addEventListener('click', this.onClick = (e) => {
      const b = e.target.closest('button[data-tut]');
      if (!b) return;
      if (b.dataset.tut === 'skip') this.end();
      else this.advance();
    });
    this.show();
  }

  show() {
    const s = TUTORIAL_STEPS[this.step];
    this.highlight(s.target ? s.target() : null);
    const last = this.step === TUTORIAL_STEPS.length - 1;
    this.card.innerHTML = `<p class="tut-step">Step ${this.step + 1} of ${TUTORIAL_STEPS.length}</p>
      <h3>${s.title}</h3><p>${s.text}</p>
      ${s.progress ? `<p class="tut-progress" id="tut-progress">${s.progress(this.ui)}</p>` : ''}
      <div class="tut-actions">
        ${last ? '' : '<button type="button" class="text-btn" data-tut="skip">Skip tutorial</button>'}
        ${s.next ? `<button type="button" class="primary" data-tut="next">${s.next}</button>` : '<span class="tut-wait">Waiting for you…</span>'}
      </div>`;
  }

  highlight(el) {
    if (this.lit) this.lit.classList.remove('tut-target');
    this.lit = el || null;
    if (el) el.classList.add('tut-target');
  }

  advance() {
    if (this.step >= TUTORIAL_STEPS.length - 1) { this.finish(); return; }
    this.step++;
    this.show();
  }

  // Called by the UI a few times a second: move on once the player has done the step.
  check() {
    const s = TUTORIAL_STEPS[this.step];
    if (!s || !this.ui.game || this.ui.game !== this.game) return;
    if (s.progress) { const el = document.getElementById('tut-progress'); if (el) el.textContent = s.progress(this.ui); }
    if (s.done && s.done(this.ui)) this.advance();
  }

  finish() {
    try { localStorage.setItem('borderfall.tutorialDone', '1'); } catch (e) { /* storage unavailable */ }
    this.end();
    this.ui.notice('Tutorial complete. The rest of the world is yours to take.');
  }

  end() {
    this.highlight(null);
    this.card.hidden = true;
    this.card.innerHTML = '';
    if (this.onClick) this.card.removeEventListener('click', this.onClick);
    if (this.ui.tutorial === this) this.ui.tutorial = null;
  }
}
