(() => {
  const mqDesktop = window.matchMedia("(min-width: 901px)");
  const stack = document.querySelector(".story-phone-stack");
  const chapters = document.querySelectorAll(".story-chapter[data-screen]");
  if (!stack || !chapters.length) return;

  const imgs = [...stack.querySelectorAll("img[data-screen]")];
  const byScreen = new Map(imgs.map((img) => [img.dataset.screen, img]));

  function setActive(screen) {
    if (!screen || !byScreen.has(screen)) return;
    imgs.forEach((img) => {
      img.classList.toggle("is-active", img.dataset.screen === screen);
    });
  }

  let observer;

  function bindObserver() {
    if (!mqDesktop.matches) {
      observer?.disconnect();
      observer = null;
      return;
    }
    if (observer) return;
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target;
        if (top) setActive(top.dataset.screen);
      },
      {
        root: null,
        rootMargin: "-35% 0px -35% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    chapters.forEach((ch) => observer.observe(ch));
  }

  const first = chapters[0]?.dataset.screen;
  if (first) setActive(first);
  bindObserver();
  mqDesktop.addEventListener("change", bindObserver);
})();