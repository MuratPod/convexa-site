(() => {
  const track = document.getElementById("gallery-track");
  const prev = document.getElementById("gallery-prev");
  const next = document.getElementById("gallery-next");
  if (!track) return;

  function slideStep() {
    const slide = track.querySelector(".gallery-slide");
    if (!slide) return track.clientWidth * 0.85;
    const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 20;
    return slide.offsetWidth + gap;
  }

  function scrollByDir(dir) {
    track.scrollBy({ left: dir * slideStep(), behavior: "smooth" });
  }

  prev?.addEventListener("click", () => scrollByDir(-1));
  next?.addEventListener("click", () => scrollByDir(1));

  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      scrollByDir(-1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      scrollByDir(1);
    }
  });
})();