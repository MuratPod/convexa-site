(() => {
  /**
   * @param {HTMLElement} track
   * @param {{
   *   prev?: HTMLElement | null,
   *   next?: HTMLElement | null,
   *   dots?: HTMLElement | null,
   *   slideSelector: string,
   * }} opts
   */
  function initHorizontalCarousel(track, opts) {
    const { prev, next, dots, slideSelector } = opts;

    const reduceMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');

    function preferInstantScroll() {
      return reduceMotionMq.matches;
    }

    function visibleSlides() {
      return [...track.querySelectorAll(slideSelector)].filter(
        (el) => el.getBoundingClientRect().width > 0,
      );
    }

    function scrollPaddingStart() {
      return Number.parseFloat(
        getComputedStyle(track).scrollPaddingInlineStart
        || getComputedStyle(track).scrollPaddingLeft,
      ) || 0;
    }

    function activeIndex() {
      const slides = visibleSlides();
      if (!slides.length) return 0;
      const pad = scrollPaddingStart();
      const anchor = track.scrollLeft + pad;
      let idx = 0;
      let best = Infinity;
      slides.forEach((slide, i) => {
        const d = Math.abs(slide.offsetLeft - anchor);
        if (d < best) {
          best = d;
          idx = i;
        }
      });
      return idx;
    }

    let targetIndex = activeIndex();
    let scrollSettleTimer = 0;

    function scrollLeftForIndex(index) {
      const slides = visibleSlides();
      const slide = slides[index];
      if (!slide) return null;
      if (index === slides.length - 1) {
        return Math.max(0, track.scrollWidth - track.clientWidth);
      }
      return Math.max(0, slide.offsetLeft - scrollPaddingStart());
    }

    function applyScrollToIndex(index, behaviorOverride) {
      const slides = visibleSlides();
      if (!slides.length) return;
      const clamped = Math.max(0, Math.min(slides.length - 1, index));
      targetIndex = clamped;
      const left = scrollLeftForIndex(clamped);
      if (left == null) return;
      const behavior = behaviorOverride ?? (preferInstantScroll() ? 'auto' : 'smooth');
      track.scrollTo({ left, behavior });
      syncDots();
    }

    function stepTarget(dir) {
      const slides = visibleSlides();
      if (!slides.length) return;
      targetIndex = Math.max(0, Math.min(slides.length - 1, targetIndex + dir));
      applyScrollToIndex(targetIndex);
    }

    function syncDots() {
      if (!dots) return;
      const idx = targetIndex;
      dots.querySelectorAll('[data-carousel-dot]').forEach((btn, i) => {
        const on = i === idx;
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.classList.toggle('is-active', on);
        btn.tabIndex = on ? 0 : -1;
      });
    }

    function buildDots() {
      if (!dots) return;
      dots.textContent = '';
      const slides = visibleSlides();
      slides.forEach((slide, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'carousel-dot';
        btn.dataset.carouselDot = String(i);
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-label', slide.getAttribute('aria-label') || `Slide ${i + 1} of ${slides.length}`);
        if (i === 0) {
          btn.classList.add('is-active');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.setAttribute('aria-selected', 'false');
          btn.tabIndex = -1;
        }
        btn.addEventListener('click', () => applyScrollToIndex(i));
        dots.append(btn);
      });
    }

    function onScrollSettled() {
      targetIndex = activeIndex();
      syncDots();
    }

    function scheduleScrollSettled() {
      if (scrollSettleTimer) window.clearTimeout(scrollSettleTimer);
      scrollSettleTimer = window.setTimeout(() => {
        scrollSettleTimer = 0;
        onScrollSettled();
      }, 120);
    }

    prev?.addEventListener('click', () => stepTarget(-1));
    next?.addEventListener('click', () => stepTarget(1));

    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepTarget(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepTarget(1);
      }
      if (dots && (e.key === 'Home' || e.key === 'End')) {
        const slides = visibleSlides();
        if (!slides.length) return;
        e.preventDefault();
        applyScrollToIndex(e.key === 'Home' ? 0 : slides.length - 1);
      }
    });

    track.addEventListener('scroll', () => {
      scheduleScrollSettled();
    }, { passive: true });

    if ('onscrollend' in track) {
      track.addEventListener('scrollend', onScrollSettled, { passive: true });
    }

    buildDots();
    syncDots();

    const layoutMq = window.matchMedia('(min-width: 1024px)');
    const onLayout = () => {
      targetIndex = activeIndex();
      if (dots) buildDots();
      syncDots();
    };
    if (typeof layoutMq.addEventListener === 'function') layoutMq.addEventListener('change', onLayout);
    else layoutMq.addListener(onLayout);

    if (typeof reduceMotionMq.addEventListener === 'function') {
      reduceMotionMq.addEventListener('change', onScrollSettled);
    } else {
      reduceMotionMq.addListener(onScrollSettled);
    }
  }

  const galleryTrack = document.getElementById('gallery-track');
  if (galleryTrack) {
    initHorizontalCarousel(galleryTrack, {
      prev: document.getElementById('gallery-prev'),
      next: document.getElementById('gallery-next'),
      dots: document.getElementById('gallery-dots'),
      slideSelector: '.gallery-slide',
    });
  }

  const bentoTrack = document.getElementById('bento-track');
  if (bentoTrack) {
    initHorizontalCarousel(bentoTrack, {
      prev: document.getElementById('bento-prev'),
      next: document.getElementById('bento-next'),
      dots: document.getElementById('bento-dots'),
      slideSelector: '.bento-carousel-slide',
    });
  }
})();