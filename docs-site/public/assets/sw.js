/// Content negotiation for agent markdown on static docs.
/// Intercepts same-origin fetches when Accept includes text/markdown.
self.addEventListener("fetch", (event) => {
  const accept = event.request.headers.get("Accept") ?? "";
  if (!accept.includes("text/markdown") && !accept.includes("text/x-markdown")) return;

  const url = new URL(event.request.url);
  if (!url.pathname.endsWith("/") && !url.pathname.endsWith(".html")) return;

  const slugMatch = url.pathname.match(/\/([^/]+)\/?$/);
  if (!slugMatch) return;

  const slug = slugMatch[1];
  if (slug === "assets" || slug === "agent" || slug === "api" || slug === ".well-known") return;

  const mdUrl = `${url.origin}${url.pathname.replace(/\/?$/, "").replace(/\/[^/]+$/, "")}/agent/${slug}.md`;
  event.respondWith(
    fetch(mdUrl, { headers: { Accept: "text/markdown" } }).then((res) => {
      if (!res.ok) return fetch(event.request);
      return new Response(res.body, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Vary": "Accept",
          "Link": `<${mdUrl}>; rel="alternate"; type="text/markdown"`
        }
      });
    })
  );
});
