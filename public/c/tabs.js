(() => {
  const root = document.querySelector(".tabs-section");
  if (!root) return;

  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const panels = [...root.querySelectorAll('[role="tabpanel"]')];
  const phoneImg = root.querySelector("#tabs-phone-img");

  const screenSrc = {
    home: "../assets/01-home.webp",
    analysis: "../assets/02-now.webp",
    positions: "../assets/05-legs.webp",
    "virtual-leg": "../assets/04-virtual-leg.webp",
    vol: "../assets/06-vol.webp",
    settings: "../assets/07-settings.webp",
  };

  function activate(id) {
    tabs.forEach((tab) => {
      const on = tab.id === `tab-${id}`;
      tab.setAttribute("aria-selected", on ? "true" : "false");
      tab.tabIndex = on ? 0 : -1;
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${id}`;
    });
    if (phoneImg && screenSrc[id]) {
      phoneImg.src = screenSrc[id];
      const alt = panels.find((p) => p.id === `panel-${id}`)?.dataset.imgAlt;
      if (alt) phoneImg.alt = alt;
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const id = tab.dataset.screen;
      if (id) activate(id);
    });
    tab.addEventListener("keydown", (e) => {
      const idx = tabs.indexOf(tab);
      let next = idx;
      if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
      if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = tabs.length - 1;
      if (next !== idx) {
        e.preventDefault();
        const id = tabs[next].dataset.screen;
        if (id) {
          activate(id);
          tabs[next].focus();
        }
      }
    });
  });

  const initial = tabs.find((t) => t.getAttribute("aria-selected") === "true")?.dataset.screen || "home";
  activate(initial);
})();