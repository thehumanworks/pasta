(function () {
  const STORAGE_KEY = "pasta-docs-audience";
  const body = document.body;
  const buttons = document.querySelectorAll(".audience-btn");
  const humanPanel = document.querySelector('[data-audience-panel="human"]');
  const agentPanel = document.querySelector('[data-audience-panel="agent"]');
  const tocPanels = document.querySelectorAll("[data-audience-toc]");
  const routeAudience = document.documentElement.dataset.routeAudience === "agent" ? "agent" : "human";
  const metaNode = document.getElementById("pasta-page-meta");
  let pageMeta = {};

  try {
    pageMeta = JSON.parse(metaNode?.textContent || "{}");
  } catch {
    pageMeta = {};
  }

  function setAudience(audience, navigate) {
    const value = audience === "agent" ? "agent" : "human";
    if (navigate && value !== routeAudience) {
      const targetUrl = value === "agent" ? pageMeta.agentUrl : pageMeta.humanUrl;
      if (typeof targetUrl === "string" && targetUrl.length > 0) {
        window.location.assign(targetUrl);
        return;
      }
    }
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
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => setAudience(btn.dataset.audience ?? "human", true));
  });

  setAudience(routeAudience, false);

  if ("serviceWorker" in navigator) {
    const base = document.documentElement.dataset.base ?? "/";
    navigator.serviceWorker.register(`${base}assets/sw.js`).catch(() => {});
  }
})();
