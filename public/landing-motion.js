(function () {
  if (window.__dgBandMotion) return;
  window.__dgBandMotion = true;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const s = t / 1000;
    document.querySelectorAll('[data-ribbon]').forEach((el, i) => {
      const p = i * 1.7;
      const x = Math.sin(s * 0.22 + p) * 22;
      const y = Math.cos(s * 0.17 + p) * 16;
      const r = Math.sin(s * 0.12 + p) * 2.5;
      el.style.translate = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
      el.style.rotate = r.toFixed(2) + 'deg';
    });
  }
  function sync() {
    cancelAnimationFrame(raf); raf = 0;
    if (reduce.matches) {
      document.querySelectorAll('[data-ribbon]').forEach((el) => { el.style.translate = ''; el.style.rotate = ''; });
      return;
    }
    raf = requestAnimationFrame(frame);
  }
  reduce.addEventListener('change', sync);
  sync();
})();
