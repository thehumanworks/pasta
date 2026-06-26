#!/usr/bin/env bun
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { marked } from "marked";

const ROOT = import.meta.dir;
const CONTENT_DIR = join(ROOT, "content");
const PUBLIC_DIR = join(ROOT, "public");
const DIST_DIR = join(ROOT, "dist");
const TEMPLATE_PATH = join(ROOT, "templates", "page.html");

interface PageMeta {
  title: string;
  slug: string;
  description: string;
  nav_order: number;
  icon?: string;
}

interface PageDoc {
  meta: PageMeta;
  humanMd: string;
  agentMd: string;
}

const NAV_ICONS: Record<string, string> = {
  "quick-start": "⚡",
  overview: "🍝",
  installation: "⬇",
  "cli-reference": "⌨",
  architecture: "🏗",
  protocol: "🔐",
  pairing: "🔗",
  "daemon-shell": "👻",
  payloads: "📦",
  security: "🛡",
  "deploy-relay": "☁",
  development: "🔧",
  "agent-handbook": "🤖"
};

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: match[2] };
}

function splitAudience(body: string): { humanMd: string; agentMd: string } {
  const humanMatch = body.match(/<!--\s*@human\s*-->([\s\S]*?)(?=<!--\s*@agent\s*-->|$)/);
  const agentMatch = body.match(/<!--\s*@agent\s*-->([\s\S]*)$/);
  if (!humanMatch || !agentMatch) {
    throw new Error("Content must include <!-- @human --> and <!-- @agent --> sections");
  }
  return { humanMd: humanMatch[1].trim(), agentMd: agentMatch[1].trim() };
}

async function loadPages(): Promise<PageDoc[]> {
  const files = (await readdir(CONTENT_DIR)).filter((f) => f.endsWith(".md")).sort();
  const pages: PageDoc[] = [];
  for (const file of files) {
    const raw = await readFile(join(CONTENT_DIR, file), "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const { humanMd, agentMd } = splitAudience(body);
    const slug = meta.slug ?? file.replace(/\.md$/, "");
    pages.push({
      meta: {
        title: meta.title ?? slug,
        slug,
        description: meta.description ?? "",
        nav_order: Number.parseInt(meta.nav_order ?? "99", 10),
        icon: NAV_ICONS[slug] ?? "·"
      },
      humanMd,
      agentMd
    });
  }
  return pages.sort((a, b) => a.meta.nav_order - b.meta.nav_order);
}

function renderMarkdown(md: string, basePath: string): string {
  const html = marked.parse(md, { gfm: true, breaks: false }) as string;
  return html.replace(/href="\/([^"]+)"/g, `href="${basePath}$1"`);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildNav(pages: PageDoc[], activeSlug: string, basePath: string): string {
  return pages
    .map((p) => {
      const active = p.meta.slug === activeSlug ? ' aria-current="page"' : "";
      return `<a class="nav-link${p.meta.slug === activeSlug ? " nav-link--active" : ""}" href="${basePath}${p.meta.slug}/"${active}><span class="nav-icon">${p.meta.icon}</span>${escapeHtml(p.meta.title)}</a>`;
    })
    .join("\n");
}

async function copyPublic(): Promise<void> {
  async function walk(src: string, dest: string): Promise<void> {
    const { readdir: rd, stat: st, copyFile: cp } = await import("node:fs/promises");
    await mkdir(dest, { recursive: true });
    for (const entry of await rd(src, { withFileTypes: true })) {
      const from = join(src, entry.name);
      const to = join(dest, entry.name);
      if (entry.isDirectory()) await walk(from, to);
      else await cp(from, to);
    }
  }
  await walk(PUBLIC_DIR, DIST_DIR);
}

async function buildSite(): Promise<void> {
  const pages = await loadPages();
  const template = await readFile(TEMPLATE_PATH, "utf8");
  const baseFlag = Bun.argv.indexOf("--base");
  const basePath = baseFlag >= 0 ? (Bun.argv[baseFlag + 1] ?? "/pasta/") : "/pasta/";
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;

  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });
  await copyPublic();

  const agentManifest: Array<{ slug: string; title: string; url: string; markdown_url: string; api_url: string }> = [];

  for (const page of pages) {
    const humanHtml = renderMarkdown(page.humanMd, normalizedBase);
    const agentHtml = renderMarkdown(page.agentMd, normalizedBase);
    const nav = buildNav(pages, page.meta.slug, normalizedBase);
    const agentMdPath = `${normalizedBase}agent/${page.meta.slug}.md`;
    const apiPath = `${normalizedBase}api/${page.meta.slug}.json`;

    const html = template
      .replaceAll("{{TITLE}}", escapeHtml(page.meta.title))
      .replaceAll("{{DESCRIPTION}}", escapeHtml(page.meta.description))
      .replaceAll("{{SLUG}}", page.meta.slug)
      .replaceAll("{{BASE}}", normalizedBase)
      .replaceAll("{{NAV}}", nav)
      .replaceAll("{{HUMAN_HTML}}", humanHtml)
      .replaceAll("{{AGENT_HTML}}", agentHtml)
      .replaceAll("{{AGENT_MD_URL}}", agentMdPath)
      .replaceAll("{{API_URL}}", apiPath);

    const outDir = join(DIST_DIR, page.meta.slug);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "index.html"), html);

    const agentDir = join(DIST_DIR, "agent");
    await mkdir(agentDir, { recursive: true });
    const agentMdFull = `---\ntitle: ${page.meta.title}\nslug: ${page.meta.slug}\naudience: agent\n---\n\n${page.agentMd}\n`;
    await writeFile(join(agentDir, `${page.meta.slug}.md`), agentMdFull);

    const apiDir = join(DIST_DIR, "api");
    await mkdir(apiDir, { recursive: true });
    await writeFile(
      join(apiDir, `${page.meta.slug}.json`),
      JSON.stringify(
        {
          slug: page.meta.slug,
          title: page.meta.title,
          description: page.meta.description,
          audience: "agent",
          format: "markdown",
          body: page.agentMd,
          html_url: `${normalizedBase}${page.meta.slug}/`,
          markdown_url: agentMdPath
        },
        null,
        2
      ) + "\n"
    );

    agentManifest.push({
      slug: page.meta.slug,
      title: page.meta.title,
      url: `${normalizedBase}${page.meta.slug}/`,
      markdown_url: agentMdPath,
      api_url: apiPath
    });
  }

  const homePage = pages.find((p) => p.meta.slug === "quick-start") ?? pages[0];
  const homeHtml = template
    .replaceAll("{{TITLE}}", "Pasta Docs")
    .replaceAll("{{DESCRIPTION}}", "Encrypted clipboard relay for trusted desktops")
    .replaceAll("{{SLUG}}", "home")
    .replaceAll("{{BASE}}", basePath)
    .replaceAll("{{NAV}}", buildNav(pages, "quick-start", normalizedBase))
    .replaceAll("{{HUMAN_HTML}}", renderMarkdown(homePage.humanMd, normalizedBase))
    .replaceAll("{{AGENT_HTML}}", renderMarkdown(homePage.agentMd, normalizedBase))
    .replaceAll("{{AGENT_MD_URL}}", `${normalizedBase}agent/${homePage.meta.slug}.md`)
    .replaceAll("{{API_URL}}", `${normalizedBase}api/${homePage.meta.slug}.json`);

  await writeFile(join(DIST_DIR, "index.html"), homeHtml);

  await mkdir(join(DIST_DIR, ".well-known"), { recursive: true });
  await writeFile(
    join(DIST_DIR, ".well-known", "pasta-docs.json"),
    JSON.stringify(
      {
        name: "Pasta Documentation",
        version: "0.1.0",
        accept_markdown: "Request /agent/{slug}.md with Accept: text/markdown, text/plain, or */*",
        accept_json: "Request /api/{slug}.json with Accept: application/json",
        pages: agentManifest
      },
      null,
      2
    ) + "\n"
  );

  await writeFile(join(DIST_DIR, "agent", "index.json"), JSON.stringify({ pages: agentManifest }, null, 2) + "\n");

  await writeFile(join(DIST_DIR, ".nojekyll"), "");

  console.log(`Built ${pages.length} pages → ${DIST_DIR} (base: ${normalizedBase})`);
}

await buildSite();
