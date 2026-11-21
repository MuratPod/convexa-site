(() => {
  const mqDesktop = window.matchMedia("(min-width: 901px)");
  const stack = document.querySelector(".story-phone-stack");
  const chapters = [...document.querySelectorAll(".story-chapter[data-screen]")];
  if (!stack || !chapters.length) return;

  const imgs = [...stack.querySelectorAll("img[data-screen]")];

  function setActive(screen) {
    const target = screen && imgs.some((img) => img.dataset.screen === screen) ? screen : "home";
    imgs.forEach((img) => {
      img.classList.toggle("is-active", img.dataset.screen === target);
    });
  }

  function chapterTop(ch) {
    return ch.getBoundingClientRect().top + window.scrollY;
  }

  function activeFromScroll() {
    const firstTop = chapterTop(chapters[0]);
    if (window.scrollY < firstTop - 100) return "home";

    const anchor = window.innerHeight * 0.36;
    let best = chapters[0];
    let bestScore = -Infinity;

    for (const ch of chapters) {
      const r = ch.getBoundingClientRect();
      const visibleTop = Math.max(r.top, 0);
      const visibleBottom = Math.min(r.bottom, window.innerHeight);
      const visible = Math.max(0, visibleBottom - visibleTop);
      if (visible < 20) continue;
      if (r.top > window.innerHeight * 0.92) continue;
      const mid = r.top + r.height * 0.25;
      const centeredness = 1 - Math.min(1, Math.abs(mid - anchor) / (window.innerHeight * 0.85));
      const score = visible * centeredness;
      if (score > bestScore) {
        bestScore = score;
        best = ch;
      }
    }
    if (window.scrollY < firstTop + 40 && best === chapters[0]) return "home";
    return best?.dataset.screen || "home";
  }

  let scheduled = false;
  function onScroll() {
    if (!mqDesktop.matches) return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      setActive(activeFromScroll());
    });
  }

  function bindMode() {
    if (mqDesktop.matches) {
      setActive(activeFromScroll());
      window.addEventListener("scroll", onScroll, { passive: true });
    } else {
      window.removeEventListener("scroll", onScroll);
      setActive(chapters[0]?.dataset.screen || "home");
    }
  }

  bindMode();
  mqDesktop.addEventListener("change", () => {
    window.removeEventListener("scroll", onScroll);
    bindMode();
  });
})();