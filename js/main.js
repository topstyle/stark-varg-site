(() => {
  'use strict';

  const SEQS = [
    { folder: 'frames/seq1', count: 73 },
    { folder: 'frames/seq2', count: 73 },
    { folder: 'frames/seq3', count: 145 },
    { folder: 'frames/seq4', count: 145 },
    { folder: 'frames/seq5', count: 73 },
  ];
  const pad = n => String(n).padStart(3, '0');

  // Build the unified 509-frame film + chapter ranges from the 5 source clips.
  const frames = [];
  const CHAPTER_RANGES = [];
  SEQS.forEach(seq => {
    const start = frames.length;
    for (let i = 0; i < seq.count; i++) {
      frames.push({ img: new Image(), folder: seq.folder, local: i });
    }
    CHAPTER_RANGES.push([start, frames.length - 1]);
  });
  const TOTAL = frames.length;

  // ---------- Loading (chapter 0 first for fast start) ----------
  const loaderFill = document.getElementById('loaderFill');
  const loaderEl = document.getElementById('loader');
  const priorityEnd = CHAPTER_RANGES[0][1];
  let priorityLoaded = 0;
  let started = false;

  function bindLoad(i, onLoad) {
    const f = frames[i];
    f.img.onload = f.img.onerror = () => { f.loaded = true; if (onLoad) onLoad(); };
    f.img.src = `${f.folder}/f_${pad(f.local + 1)}.jpg`;
  }

  for (let i = 0; i <= priorityEnd; i++) {
    bindLoad(i, () => {
      priorityLoaded++;
      const pct = Math.min(100, Math.round((priorityLoaded / (priorityEnd + 1)) * 100));
      if (loaderFill) loaderFill.style.width = pct + '%';
      if (priorityLoaded > priorityEnd && !started) finishLoading();
    });
  }

  function finishLoading() {
    if (started) return;
    started = true;
    if (loaderEl) loaderEl.classList.add('hidden');
    for (let i = priorityEnd + 1; i < TOTAL; i++) bindLoad(i);
    requestAnimationFrame(tick);
  }
  setTimeout(finishLoading, 4000);

  // ---------- Canvas ----------
  const canvas = document.getElementById('filmCanvas');
  const ctx = canvas.getContext('2d');

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    displayedIndex = -1;
  }
  window.addEventListener('resize', resizeCanvas);

  function drawFrame(i) {
    const img = frames[i].img;
    if (!img.complete || img.naturalWidth === 0) return;
    const cw = canvas.width, ch = canvas.height;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const scale = Math.max(cw / iw, ch / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function nearestLoadedIndex(target) {
    if (frames[target] && frames[target].loaded) return target;
    for (let d = 1; d < TOTAL; d++) {
      const lo = target - d, hi = target + d;
      if (lo >= 0 && frames[lo] && frames[lo].loaded) return lo;
      if (hi < TOTAL && frames[hi] && frames[hi].loaded) return hi;
    }
    return -1;
  }

  // ---------- Playback state ----------
  const LERP = 0.18;
  const IDLE_MS = 180;
  const LOOP_FPS = 18;
  const LOOP_CHAPTERS = new Set([0, CHAPTER_RANGES.length - 1]); // first & last clips idle-loop
  let currentIndex = 0;
  let targetIndex = 0;
  let displayedIndex = -1;
  let lastChapterShown = -1;
  let hasInteracted = false;
  let lastInteraction = -Infinity; // idle from the start, so chapter 0 starts looping right away
  let loopDirection = 1;
  let loopAccum = 0;
  let lastTime = performance.now();

  // Button/dot navigation plays through the frames like a video, at a fixed pace,
  // instead of snapping toward the target the way wheel/touch scrubbing does.
  const PLAY_FPS = 24;
  let playTarget = null;
  let playAccum = 0;

  function setTarget(frameIdx) {
    targetIndex = Math.max(0, Math.min(TOTAL - 1, frameIdx));
    lastInteraction = performance.now();
  }

  function nudgeTarget(deltaFrames) {
    playTarget = null; // manual scrubbing takes over from any in-progress button transition
    setTarget(targetIndex + deltaFrames);
  }

  function startPlay(frameIdx) {
    playTarget = Math.max(0, Math.min(TOTAL - 1, frameIdx));
    lastInteraction = performance.now();
  }

  function onFirstInteract() {
    if (hasInteracted) return;
    hasInteracted = true;
    const hint = document.getElementById('mouseHint');
    if (hint) hint.classList.add('faded');
  }

  // Wheel = primary control. Delta-based (not absolute position) so it can't overshoot.
  const WHEEL_SENSITIVITY = 0.12;
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    onFirstInteract();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= window.innerHeight;
    nudgeTarget(dy * WHEEL_SENSITIVITY);
  }, { passive: false });

  // Touch = relative drag, same delta-based feel as the wheel.
  const TOUCH_SENSITIVITY = 0.6;
  let touchLastX = null;
  window.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchLastX = e.touches && e.touches.length ? e.touches[0].clientX : null;
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!e.touches || !e.touches.length) return;
    e.preventDefault();
    onFirstInteract();
    const x = e.touches[0].clientX;
    if (touchLastX !== null) {
      const dx = touchLastX - x;
      nudgeTarget(dx * TOUCH_SENSITIVITY);
    }
    touchLastX = x;
  }, { passive: false });

  // ---------- Chapters ----------
  const chapterEls = CHAPTER_RANGES.map((_, i) => document.getElementById('chapter' + i));
  const dots = document.querySelectorAll('.dot');
  const progressFill = document.getElementById('progressFill');

  function chapterForIndex(idx) {
    for (let i = 0; i < CHAPTER_RANGES.length; i++) {
      if (idx >= CHAPTER_RANGES[i][0] && idx <= CHAPTER_RANGES[i][1]) return i;
    }
    return CHAPTER_RANGES.length - 1;
  }

  function updateChapter(idx) {
    const ch = chapterForIndex(idx);
    if (ch === lastChapterShown) return;
    lastChapterShown = ch;
    chapterEls.forEach((el, i) => el && el.classList.toggle('active', i === ch));
    dots.forEach((d, i) => d.classList.toggle('active', i === ch));
  }

  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      onFirstInteract();
      const ch = parseInt(dot.dataset.chapter, 10);
      startPlay(CHAPTER_RANGES[ch][0]);
    });
  });

  document.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      onFirstInteract();
      const ch = parseInt(btn.dataset.next, 10);
      startPlay(CHAPTER_RANGES[ch][0]);
    });
  });

  // ---------- Main loop ----------
  function tick(now) {
    const dt = now - lastTime;
    lastTime = now;
    const idle = (now - lastInteraction) > IDLE_MS;
    const curChapter = chapterForIndex(Math.round(currentIndex));

    if (playTarget !== null) {
      loopAccum = 0;
      playAccum += dt;
      const frameDur = 1000 / PLAY_FPS;
      const direction = playTarget > currentIndex ? 1 : (playTarget < currentIndex ? -1 : 0);
      while (playAccum >= frameDur && currentIndex !== playTarget) {
        playAccum -= frameDur;
        currentIndex += direction;
        if ((direction > 0 && currentIndex >= playTarget) || (direction < 0 && currentIndex <= playTarget)) {
          currentIndex = playTarget;
        }
      }
      targetIndex = currentIndex;
      lastInteraction = now;
      if (currentIndex === playTarget) playTarget = null;
    } else if (idle && LOOP_CHAPTERS.has(curChapter)) {
      loopAccum += dt;
      const frameDur = 1000 / LOOP_FPS;
      const [chStart, chEnd] = CHAPTER_RANGES[curChapter];
      while (loopAccum >= frameDur) {
        loopAccum -= frameDur;
        currentIndex += loopDirection;
        if (currentIndex >= chEnd) { currentIndex = chEnd; loopDirection = -1; }
        else if (currentIndex <= chStart) { currentIndex = chStart; loopDirection = 1; }
      }
      targetIndex = currentIndex;
    } else if (!idle) {
      loopAccum = 0;
      currentIndex += (targetIndex - currentIndex) * LERP;
      if (Math.abs(targetIndex - currentIndex) < 0.4) currentIndex = targetIndex;
    } else {
      loopAccum = 0;
    }

    const idx = Math.round(currentIndex);
    if (idx !== displayedIndex) {
      const use = nearestLoadedIndex(idx);
      if (use !== -1) { drawFrame(use); displayedIndex = idx; }
    }
    updateChapter(idx);
    if (progressFill) progressFill.style.width = ((currentIndex / (TOTAL - 1)) * 100) + '%';

    requestAnimationFrame(tick);
  }

  resizeCanvas();
})();
