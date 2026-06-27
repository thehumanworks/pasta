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
}

interface PageDoc {
  meta: PageMeta;
  humanMd: string;
  agentMd: string;
}

interface TocItem {
  id: string;
  text: string;
  level: number;
}

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
        nav_order: Number.parseInt(meta.nav_order ?? "99", 10)
      },
      humanMd,
      agentMd
    });
  }
  return pages.sort((a, b) => a.meta.nav_order - b.meta.nav_order);
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/giu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "section";
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .trim();
}

function renderMarkdown(md: string, basePath: string): { html: string; toc: TocItem[] } {
  const html = marked.parse(md, { gfm: true, breaks: false }) as string;
  const seen = new Map<string, number>();
  const toc: TocItem[] = [];
  const anchored = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/gu, (_match, levelText: string, inner: string) => {
    const level = Number.parseInt(levelText, 10);
    const text = plainText(inner);
    const baseId = slugifyHeading(text);
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);
    const id = count === 0 ? baseId : `${baseId}-${count + 1}`;
    toc.push({ id, text, level });
    return `<h${level} id="${id}"><a class="heading-anchor" href="#${id}" aria-label="Link to ${escapeHtml(text)}">${inner}</a></h${level}>`;
  });
  return { html: anchored.replace(/href="\/([^"]+)"/g, `href="${basePath}$1"`), toc };
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
    .map((p, index) => {
      const active = p.meta.slug === activeSlug ? ' aria-current="page"' : "";
      const navIndex = String(index + 1).padStart(2, "0");
      return `<a class="nav-link${p.meta.slug === activeSlug ? " nav-link--active" : ""}" href="${basePath}${p.meta.slug}/"${active}><span class="nav-index" aria-hidden="true">${navIndex}</span>${escapeHtml(p.meta.title)}</a>`;
    })
    .join("\n");
}

function buildToc(toc: TocItem[]): string {
  if (toc.length === 0) return `<p class="toc-empty">No page sections</p>`;
  return toc
    .map((item) => `<a class="toc-link toc-link--level-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`)
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
    const humanRendered = renderMarkdown(page.humanMd, normalizedBase);
    const agentRendered = renderMarkdown(page.agentMd, normalizedBase);
    const nav = buildNav(pages, page.meta.slug, normalizedBase);
    const agentMdPath = `${normalizedBase}agent/${page.meta.slug}.md`;
    const apiPath = `${normalizedBase}api/${page.meta.slug}.json`;

    const html = template
      .replaceAll("{{TITLE}}", escapeHtml(page.meta.title))
      .replaceAll("{{DESCRIPTION}}", escapeHtml(page.meta.description))
      .replaceAll("{{SLUG}}", page.meta.slug)
      .replaceAll("{{BASE}}", normalizedBase)
      .replaceAll("{{NAV}}", nav)
      .replaceAll("{{HUMAN_HTML}}", humanRendered.html)
      .replaceAll("{{AGENT_HTML}}", agentRendered.html)
      .replaceAll("{{HUMAN_TOC}}", buildToc(humanRendered.toc))
      .replaceAll("{{AGENT_TOC}}", buildToc(agentRendered.toc))
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
  const homeHumanRendered = renderMarkdown(homePage.humanMd, normalizedBase);
  const homeAgentRendered = renderMarkdown(homePage.agentMd, normalizedBase);
  const homeHtml = template
    .replaceAll("{{TITLE}}", "Pasta Docs")
    .replaceAll("{{DESCRIPTION}}", "Encrypted clipboard relay for trusted desktops")
    .replaceAll("{{SLUG}}", "home")
    .replaceAll("{{BASE}}", basePath)
    .replaceAll("{{NAV}}", buildNav(pages, "quick-start", normalizedBase))
    .replaceAll("{{HUMAN_HTML}}", homeHumanRendered.html)
    .replaceAll("{{AGENT_HTML}}", homeAgentRendered.html)
    .replaceAll("{{HUMAN_TOC}}", buildToc(homeHumanRendered.toc))
    .replaceAll("{{AGENT_TOC}}", buildToc(homeAgentRendered.toc))
    .replaceAll("{{AGENT_MD_URL}}", `${normalizedBase}agent/${homePage.meta.slug}.md`)
    .replaceAll("{{API_URL}}", `${normalizedBase}api/${homePage.meta.slug}.json`);

  await writeFile(join(DIST_DIR, "index.html"), homeHtml);

  await mkdir(join(DIST_DIR, ".well-known"), { recursive: true });
  const agentIndex = {
    name: "Pasta Documentation",
    version: "0.1.8",
    generated_at: "2026-06-27",
    schema_version: "hindsight-agents-v1",
    base_url_assumption: normalizedBase,
    accept_markdown: "Request /agent/{slug}.md with Accept: text/markdown, text/plain, or */*",
    accept_json: "Request /api/{slug}.json with Accept: application/json",
    source_material: [
      "AGENTS.md",
      "GOAL.md",
      "docs/ORCHESTRATION.md",
      "docs/goals/*.md",
      "docs-site/content/*.md",
      "ios/App",
      "ios/Keyboard",
      "ios/Sources/PastaCore",
      "src/shared",
      "src/worker"
    ],
    verification_commands: [
      "cd docs-site && bun run build -- --base /",
      "cd docs-site && PORT=4173 bun run serve.ts",
      "curl http://localhost:4173/.well-known/agents.json",
      "curl -H 'Accept: text/markdown' http://localhost:4173/native-ios/"
    ],
    pages: agentManifest.map((page) => ({
      slug: page.slug,
      title: page.title,
      purpose: purposeForPage(page.slug),
      html_url: page.url,
      content_negotiated_url: page.url,
      markdown_url: page.markdown_url,
      api_url: page.api_url
    }))
  };

  await writeFile(join(DIST_DIR, ".well-known", "pasta-docs.json"), JSON.stringify(agentIndex, null, 2) + "\n");
  await writeFile(join(DIST_DIR, ".well-known", "agents.json"), JSON.stringify(agentIndex, null, 2) + "\n");

  await writeFile(join(DIST_DIR, "agent", "index.json"), JSON.stringify({ pages: agentManifest }, null, 2) + "\n");

  await writeFile(join(DIST_DIR, ".nojekyll"), "");

  console.log(`Built ${pages.length} pages → ${DIST_DIR} (base: ${normalizedBase})`);
}

await buildSite();

function purposeForPage(slug: string): string {
  switch (slug) {
    case "overview":
    case "quick-start":
      return "Outcome: product promise, supported users, non-goals, and success criteria.";
    case "native-ios":
      return "Experience and implementation contract for iOS app, keyboard, file, history, and release work.";
    case "architecture":
    case "protocol":
    case "payloads":
    case "security":
      return "Architecture: modules, data boundaries, relay contracts, metadata limits, and security invariants.";
    case "development":
    case "agent-handbook":
      return "Implementation and quality: agent rules, verification commands, release gates, and footguns.";
    default:
      return "Reference page for Pasta operators and implementation agents.";
  }
}
