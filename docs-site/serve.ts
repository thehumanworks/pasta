#!/usr/bin/env bun
import { join } from "node:path";

const DIST = join(import.meta.dir, "dist");
const PORT = Number.parseInt(process.env.PORT ?? "4173", 10);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const accept = req.headers.get("Accept") ?? "";

    if (accept.includes("text/markdown") || accept.includes("text/plain") || accept.includes("text/x-markdown")) {
      const slugFromAgent = url.pathname.match(/^\/agent\/([^/]+)\.md$/);
      if (slugFromAgent) {
        const file = Bun.file(join(DIST, "agent", `${slugFromAgent[1]}.md`));
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Vary": "Accept"
            }
          });
        }
      }

      const pageMatch = url.pathname.match(/^\/(?:(human|agent)\/)?([^/]+)\/?$/);
      if (pageMatch && pageMatch[2] !== "assets" && pageMatch[2] !== "api" && pageMatch[2] !== "agent") {
        const file = Bun.file(join(DIST, "agent", `${pageMatch[2]}.md`));
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              "Content-Type": "text/markdown; charset=utf-8",
              "Vary": "Accept",
              "Link": `<${url.origin}/agent/${pageMatch[2]}.md>; rel="alternate"; type="text/markdown"`
            }
          });
        }
      }
    }

    if (accept.includes("application/json") && url.pathname.startsWith("/api/")) {
      const file = Bun.file(join(DIST, url.pathname.slice(1)));
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Content-Type": "application/json; charset=utf-8", "Vary": "Accept" }
        });
      }
    }

    let path = url.pathname;
    if (path.endsWith("/")) path += "index.html";
    if (!path.includes(".")) path = join(path, "index.html").replace(/\\/g, "/");
    const filePath = join(DIST, path.startsWith("/") ? path.slice(1) : path);
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
    const fallback = Bun.file(join(DIST, "index.html"));
    return new Response(fallback);
  }
});

console.log(`Pasta docs dev server → http://localhost:${server.port}`);
