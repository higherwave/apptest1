// The landing page's picture: a row of rounded bars (the Signal Flow mark, enlarged to fill the top of the page) that rise and fall like a signal.
// It holds still for anyone who asks for reduced motion, and the browser pauses frames while the tab is hidden.
(function () {
  if (window.__dgBandMotion) return;
  window.__dgBandMotion = true;
  const host = document.querySelector('[data-eq]');
  if (!host) return;
  const palette = ['#a8d8c4', '#8ec5f0', '#1b61c9', '#7c5cd6', '#c3b5f2'];
  const n = 44;
  const bars = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement('i');
    const f = (i / (n - 1)) * (palette.length - 1);
    const c1 = palette[Math.floor(f)];
    const c2 = palette[Math.min(palette.length - 1, Math.floor(f) + 1)];
    b.style.background = 'linear-gradient(180deg,' + c2 + ',' + c1 + ')';
    host.appendChild(b);
    bars.push(b);
  }
  // The tallest a bar gets is most of the hero's height, so the picture scales with the page.
  function draw(s) {
    const h = host.clientHeight * 0.92;
    bars.forEach((el, i) => {
      const x = i / n;
      const env = Math.sin(Math.PI * x) * 0.6 + 0.4;
      const w = Math.sin(x * 9 - s * 0.9) * 0.5 + Math.sin(x * 23 + s * 0.6) * 0.25 + 0.75;
      el.style.height = Math.max(0.05 * h, (env * w / 1.5) * h).toFixed(1) + 'px';
    });
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  let still = 1.5;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    draw(t / 1000);
  }
  function sync() {
    cancelAnimationFrame(raf);
    raf = 0;
    if (reduce.matches) { draw(still); return; }
    raf = requestAnimationFrame(frame);
  }
  reduce.addEventListener('change', sync);
  window.addEventListener('resize', () => { if (reduce.matches) draw(still); });
  sync();
})();
