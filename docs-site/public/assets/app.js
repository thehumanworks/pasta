(function () {
  const STORAGE_KEY = "pasta-docs-audience";
  const body = document.body;
  const buttons = document.querySelectorAll(".audience-btn");
  const humanPanel = document.querySelector('[data-audience-panel="human"]');
  const agentPanel = document.querySelector('[data-audience-panel="agent"]');
  const tocPanels = document.querySelectorAll("[data-audience-toc]");

  function setAudience(audience) {
    const value = audience === "agent" ? "agent" : "human";
    body.dataset.audience = value;
    buttons.forEach((btn) => {
      const active = btn.dataset.audience === value;
      btn.classList.toggle("audience-btn--active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    humanPanel?.classList.toggle("hidden", value !== "human");
    agentPanel?.classList.toggle("hidden", value !== "agent");
    tocPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.audienceToc !== value);
    });
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore */
    }
    const url = new URL(window.location.href);
    if (value === "agent") url.searchParams.set("audience", "agent");
    else url.searchParams.delete("audience");
    window.history.replaceState({}, "", url);
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => setAudience(btn.dataset.audience ?? "human"));
  });

  const params = new URLSearchParams(window.location.search);
  let initial = params.get("audience") === "agent" ? "agent" : "human";
  if (!params.has("audience")) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "agent" || stored === "human") initial = stored;
    } catch {
      /* ignore */
    }
  }
  setAudience(initial);

  if ("serviceWorker" in navigator) {
    const base = document.documentElement.dataset.base ?? "/";
    navigator.serviceWorker.register(`${base}assets/sw.js`).catch(() => {});
  }
})();
