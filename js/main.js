'use strict';
// Boot: wire the renderer and UI together and run the fixed-step game loop.

(function () {
  const canvas = document.getElementById('map');
  const renderer = new Renderer(canvas);
  const ui = new UI(renderer);
  window.borderfall = { ui, renderer };

  const TICK_MS = 1000 / TPS;
  let last = performance.now();
  let acc = 0;
  let frameNo = 0;

  function frame(now) {
    const dt = Math.min(250, now - last);
    last = now;
    const g = ui.game;
    const running = g && g.started && !ui.isPaused();
    if (running) {
      acc += dt * (g.multiplayer ? 1 : ui.speed);
      let n = 0;
      while (acc >= TICK_MS && n < 12) {
        g.step();
        acc -= TICK_MS;
        n++;
      }
      if (n === 12) acc = 0;
    }
    if (ui.net && g) {
      if (ui.net.role === 'host') ui.net.frame();
      else ui.net.clientFrame(dt);
    }
    renderer.timeScale = running || (g && g.multiplayer && g.started) ? (g.multiplayer ? 1 : ui.speed) : 0;
    ui.frame(dt);
    // Low graphics draws every other frame (about 30 fps).
    if (renderer.quality !== 'low' || (frameNo++ & 1) === 0) {
      renderer.draw(running ? Math.min(1, acc / TICK_MS) : 0);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', () => renderer.resize());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ui.drawBuildIcons());
})();
