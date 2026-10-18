(() => {
  'use strict';

  const AUTOPLAY_MS = 5500;
  const stage = document.getElementById('stage');
  const rail = document.getElementById('rail');
  const slides = [...rail.querySelectorAll('.slide')];
  const thumbs = [...document.querySelectorAll('#thumbs button')];
  const n = slides.length;
  const live = document.getElementById('live');
  const progress = document.getElementById('progress');
  const playBtn = document.getElementById('playBtn');
  const fsBtn = document.getElementById('fsBtn');
  const counterCol = document.getElementById('counterCol');
  const ambs = [...document.querySelectorAll('.amb')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pad = (v) => String(v).padStart(2, '0');

  let cur = 0;
  let ambIdx = 0;
  let playing = false;
  let paused = false;          // hover / hidden pause while playing
  let tStart = 0;
  let elapsed = 0;
  let raf = 0;

  /* ---------- counter ---------- */
  counterCol.innerHTML = slides.map((_, i) => `<span>${pad(i + 1)}</span>`).join('');
  document.getElementById('counterTotal').textContent = pad(n);

  /* ---------- image load state ---------- */
  slides.forEach((s) => {
    const img = s.querySelector('img');
    const done = () => img.classList.add('loaded');
    if (img.complete && img.naturalWidth) done();
    else { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }
    // decode off-thread to avoid jank on first transition
    if (img.decode) img.decode().catch(() => {});
  });

  /* ---------- ambient background ---------- */
  function setAmbient(i) {
    const src = slides[i].querySelector('img').currentSrc || slides[i].querySelector('img').src;
    const next = ambs[ambIdx ^ 1];
    next.style.backgroundImage = `url("${src}")`;
    next.classList.add('on');
    ambs[ambIdx].classList.remove('on');
    ambIdx ^= 1;
  }

  /* ---------- render ---------- */
  function offsetOf(i) {
    let d = (((i - cur) % n) + n) % n;
    if (d > n / 2) d -= n;
    return d;
  }

  function render(first = false) {
    slides.forEach((el, i) => {
      const o = offsetOf(i);
      const prev = parseFloat(el.dataset.o);
      const wrap = first || (!Number.isNaN(prev) && Math.abs(o - prev) > 2);
      if (wrap) el.classList.add('jump');
      el.dataset.o = o;
      el.dataset.pos = Math.abs(o) === 1 ? '1' : Math.abs(o) === 0 ? '0' : '2';
      el.style.setProperty('--o', o);
      el.style.setProperty('--a', Math.min(Math.abs(o), 2));
      const active = o === 0;
      const wasActive = el.classList.contains('is-active');
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-hidden', active ? 'false' : 'true');
      if (active && !wasActive) {
        el.classList.remove('shine');
        void el.offsetWidth;
        el.classList.add('shine');
      }
      if (wrap) {
        void el.offsetWidth;
        requestAnimationFrame(() => el.classList.remove('jump'));
      }
    });

    thumbs.forEach((b, i) => b.setAttribute('aria-current', i === cur ? 'true' : 'false'));
    counterCol.style.transform = `translateY(calc(${-cur} * 1.3em))`;
    setAmbient(cur);
    live.textContent = `الشريحة ${cur + 1} من ${n}`;
    try { history.replaceState(null, '', `#${cur + 1}`); } catch (_) {}
    elapsed = 0; tStart = performance.now();
    progress.style.transform = 'scaleX(0)';
  }

  function go(i) {
    const t = ((i % n) + n) % n;
    if (t === cur) return;
    cur = t;
    render();
  }
  const next = () => go(cur + 1);
  const prev = () => go(cur - 1);

  /* ---------- autoplay (rAF driven so progress bar stays accurate) ---------- */
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!playing || paused) { tStart = now - elapsed; return; }
    elapsed = now - tStart;
    progress.style.transform = `scaleX(${Math.min(elapsed / AUTOPLAY_MS, 1)})`;
    if (elapsed >= AUTOPLAY_MS) next();
  }
  function setPlaying(v) {
    playing = v;
    playBtn.setAttribute('aria-pressed', String(v));
    playBtn.setAttribute('aria-label', v ? 'إيقاف العرض التلقائي' : 'تشغيل العرض التلقائي');
    elapsed = 0; tStart = performance.now();
    progress.style.transform = 'scaleX(0)';
  }
  raf = requestAnimationFrame(tick);

  playBtn.addEventListener('click', () => setPlaying(!playing));
  stage.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') paused = true; });
  stage.addEventListener('pointerleave', () => { paused = false; });
  document.addEventListener('visibilitychange', () => { paused = document.hidden; });

  /* ---------- buttons / thumbs ---------- */
  document.getElementById('nextBtn').addEventListener('click', next);
  document.getElementById('prevBtn').addEventListener('click', prev);
  thumbs.forEach((b) => b.addEventListener('click', () => go(+b.dataset.i)));

  /* ---------- keyboard (RTL aware: left = next) ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowLeft': case 'PageDown': next(); break;
      case 'ArrowRight': case 'PageUp': prev(); break;
      case 'Home': go(0); break;
      case 'End': go(n - 1); break;
      case ' ':
        if (e.target.closest && e.target.closest('button')) return;
        e.preventDefault(); setPlaying(!playing); break;
      case 'f': case 'F': toggleFs(); break;
      default: return;
    }
  });

  /* ---------- wheel / trackpad ---------- */
  let wheelLock = 0;
  stage.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 24) return;
    e.preventDefault();
    const now = performance.now();
    if (now < wheelLock) return;
    wheelLock = now + 750;
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    // horizontal: content follows the fingers (RTL: next sits on the left); vertical: down = next
    if (horizontal) { d > 0 ? prev() : next(); } else { d > 0 ? next() : prev(); }
  }, { passive: false });

  /* ---------- drag / swipe with live follow ---------- */
  let drag = null;
  let suppressClick = false;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.nav')) return;
    drag = { id: e.pointerId, x0: e.clientX, x: e.clientX, t0: performance.now(), moved: false };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved && Math.abs(dx) > 6) {
      drag.moved = true;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      rail.classList.add('dragging');
      stage.classList.add('grabbing');
    }
    if (drag.moved) {
      drag.x = e.clientX;
      rail.style.setProperty('--dx', `${dx}px`);
    }
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const dx = drag.x - drag.x0;
    const dt = Math.max(performance.now() - drag.t0, 1);
    const v = Math.abs(dx) / dt;
    const moved = drag.moved;
    drag = null;
    rail.classList.remove('dragging');
    stage.classList.remove('grabbing');
    void rail.offsetWidth;
    rail.style.setProperty('--dx', '0px');
    if (moved) {
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
      if (Math.abs(dx) > 60 || v > 0.45) { dx > 0 ? next() : prev(); }
    }
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // clicking a peeking neighbour jumps to it
  slides.forEach((el, i) => el.addEventListener('click', () => {
    if (suppressClick) return;
    if (!el.classList.contains('is-active')) go(i);
  }));

  /* ---------- fullscreen ---------- */
  const root = document.documentElement;
  function toggleFs() {
    if (!root.requestFullscreen) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen().catch(() => {});
  }
  if (!root.requestFullscreen) fsBtn.hidden = true;
  fsBtn.addEventListener('click', toggleFs);
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    fsBtn.classList.toggle('is-fs', on);
    root.classList.toggle('is-fs', on);
    fsBtn.setAttribute('aria-label', on ? 'إنهاء ملء الشاشة' : 'ملء الشاشة');
  });

  /* ---------- deep link + init ---------- */
  const h = parseInt(location.hash.slice(1), 10);
  if (h >= 1 && h <= n) cur = h - 1;
  window.addEventListener('hashchange', () => {
    const v = parseInt(location.hash.slice(1), 10);
    if (v >= 1 && v <= n) go(v - 1);
  });
  render(true);
  if (reduced) playBtn.setAttribute('title', 'تشغيل تلقائي');
})();
