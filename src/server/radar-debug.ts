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

async function probe(name: string, url: string, opts: { text?: boolean } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: opts.text ? "text/html" : "text/html" },
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
  const q3 = encodeURIComponent('"facebook.com/groups" papelaria');

  const bingRes = await probe("bing_plain", `https://www.bing.com/search?q=${q2}&setlang=pt-br&count=50`);
  let bingDecoded: string[] = [];
  if (typeof bingRes.status === "number") {
    const text = await fetch(`https://www.bing.com/search?q=${q2}&setlang=pt-br&count=50`, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR" },
    }).then((r) => r.text()).catch(() => "");
    const hrefs = [...text.matchAll(/<h2[^>]*><a[^>]+href="([^"]+)"/gi)].map((m) => m[1] ?? "");
    bingDecoded = hrefs.map(decodeBingUrl).filter((u) => u && !u.startsWith("https://www.bing.com"));
  }

  return {
    ddg_html: await probe("ddg_html", `https://html.duckduckgo.com/html/?q=${q1}`),
    ddg_lite: await probe("ddg_lite", `https://lite.duckduckgo.com/lite/?q=${q1}`),
    bing_res: bingRes,
    bing_decoded_first: bingDecoded.slice(0, 12),
    bing_fb_groups: bingDecoded.filter((u) => /facebook\.com\/groups\//i.test(u)).slice(0, 12),
    fb_group_page: await probe(
      "fb_group_page",
      "https://www.facebook.com/groups/papelariacriativa",
    ),
  };
});

export type ProbeEgress = Awaited<ReturnType<typeof probeEgress>>;