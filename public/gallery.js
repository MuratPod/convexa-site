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

    function visibleSlides() {
      return [...track.querySelectorAll(slideSelector)].filter(
        (el) => el.getBoundingClientRect().width > 0,
      );
    }

    function slideStep() {
      const slides = visibleSlides();
      const slide = slides[0];
      if (!slide) return track.clientWidth * 0.85;
      const gap = Number.parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 20;
      return slide.offsetWidth + gap;
    }

    function scrollByDir(dir) {
      track.scrollBy({ left: dir * slideStep(), behavior: 'smooth' });
    }

    function scrollToIndex(index) {
      const slides = visibleSlides();
      const slide = slides[index];
      if (!slide) return;
      const pad = Number.parseFloat(getComputedStyle(track).scrollPaddingInlineStart || getComputedStyle(track).scrollPaddingLeft) || 0;
      track.scrollTo({ left: slide.offsetLeft - pad, behavior: 'smooth' });
    }

    function activeIndex() {
      const slides = visibleSlides();
      if (!slides.length) return 0;
      const pad = Number.parseFloat(getComputedStyle(track).scrollPaddingInlineStart || getComputedStyle(track).scrollPaddingLeft) || 0;
      const center = track.scrollLeft + pad + track.clientWidth * 0.2;
      let idx = 0;
      let best = Infinity;
      slides.forEach((slide, i) => {
        const d = Math.abs(slide.offsetLeft - center);
        if (d < best) {
          best = d;
          idx = i;
        }
      });
      return idx;
    }

    function syncDots() {
      if (!dots) return;
      const idx = activeIndex();
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
        btn.addEventListener('click', () => scrollToIndex(i));
        dots.append(btn);
      });
    }

    prev?.addEventListener('click', () => scrollByDir(-1));
    next?.addEventListener('click', () => scrollByDir(1));

    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        scrollByDir(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        scrollByDir(1);
      }
      if (dots && (e.key === 'Home' || e.key === 'End')) {
        const slides = visibleSlides();
        if (!slides.length) return;
        e.preventDefault();
        scrollToIndex(e.key === 'Home' ? 0 : slides.length - 1);
      }
    });

    let dotRaf = 0;
    track.addEventListener('scroll', () => {
      if (dotRaf) cancelAnimationFrame(dotRaf);
      dotRaf = requestAnimationFrame(() => {
        dotRaf = 0;
        syncDots();
      });
    }, { passive: true });

    buildDots();
    syncDots();

    const mq = window.matchMedia('(min-width: 1024px)');
    const onMq = () => {
      if (dots) buildDots();
      syncDots();
    };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMq);
    else mq.addListener(onMq);
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