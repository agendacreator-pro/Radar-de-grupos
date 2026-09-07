import { createServerFn } from "@tanstack/react-start";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function b64decode(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return "";
  }
}

function decodeBingUrl(h: string): string {
  const m = h.match(/u=a1([^&]+)/);
  if (!m) return h;
  return b64decode(m[1] ?? "");
}

async function probe(name: string, url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "text/html" },
    });
    const text = await res.text();
    return {
      name,
      status: res.status,
      url,
      bytes: text.length,
      ddg_links: (text.match(/class="result__a"/gi) || []).length,
      fb_groups: (text.match(/facebook\.com\/groups\//gi) || []).length,
      bing_algo: (text.match(/<li class="b_algo"/gi) || []).length,
      og_title: text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? null,
      head: text.replace(/\s+/g, " ").slice(0, 140),
    };
  } catch (e) {
    return { name, url, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export const probeEgress = createServerFn({ method: "GET" }).handler(async () => {
  const q1 = encodeURIComponent('site:facebook.com/groups "papelaria personalizada"');
  const q2 = encodeURIComponent("papelaria personalizada facebook grupos");

  let bingDecoded: string[] = [];
  try {
    const text = await fetch(`https://www.bing.com/search?q=${q2}&setlang=pt-br&count=50`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR" },
    }).then((r) => r.text());
    const hrefs = [...text.matchAll(/<h2[^>]*><a[^>]+href="([^"]+)"/gi)].map((m) => m[1] ?? "");
    bingDecoded = hrefs.map(decodeBingUrl).filter((u) => u && !u.startsWith("https://www.bing.com"));
  } catch (e) {
    bingDecoded = [`bing error: ${e instanceof Error ? e.message : String(e)}`];
  }

  // extract real group URLs from DDG html (like the engine will)
  let ddgGroupUrls: string[] = [];
  let realSlug: string | null = null;
  try {
    const html = await fetch(`https://html.duckduckgo.com/html/?q=${q1}`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR" },
    }).then((r) => r.text());
    const hrefs = [...html.matchAll(/href="([^"]*uddg=[^"]+)"/g)].map((m) => m[1] ?? "");
    const seen = new Set<string>();
    for (const h of hrefs) {
      const m = h.match(/uddg=([^&]+)/);
      let u: string | null = null;
      if (m) {
        try {
          u = decodeURIComponent(m[1] ?? "");
        } catch {}
      }
      u = u ?? h;
      const g = u.match(/facebook\.com\/groups\/([^/?#&\s]+)/i);
      const slug = g?.[1] ?? "";
      if (slug && !seen.has(slug)) {
        seen.add(slug);
        ddgGroupUrls.push(u);
        if (!realSlug) realSlug = slug;
      }
    }
  } catch (e) {
    ddgGroupUrls = [`ddg extract error: ${e instanceof Error ? e.message : String(e)}`];
  }

  return {
    ddg_html: await probe("ddg_html", `https://html.duckduckgo.com/html/?q=${q1}`),
    ddg_lite: await probe("ddg_lite", `https://lite.duckduckgo.com/lite/?q=${q1}`),
    real_ddg_group_urls: ddgGroupUrls.slice(0, 10),
    fb_group_page: realSlug
      ? await probe("fb_group_page_real", `https://www.facebook.com/groups/${realSlug}`)
      : { name: "fb_group_page_real", error: "no slug" },
    mbasic: realSlug
      ? await probe("mbasic", `https://mbasic.facebook.com/groups/${realSlug}`)
      : { name: "mbasic", error: "no slug" },
  };
});

export const ddgSnippetStructure = createServerFn({ method: "GET" }).handler(async () => {
  const q1 = encodeURIComponent('site:facebook.com/groups "papelaria personalizada"');
  const html = await fetch(`https://lite.duckduckgo.com/lite/?q=${q1}`, {
    headers: { "User-Agent": UA, "Accept-Language": "pt-BR" },
  }).then((r) => r.text());
  return {
    status: true,
    len: html.length,
    tail: html.slice(Math.max(0, html.length - 15000)),
  };
});