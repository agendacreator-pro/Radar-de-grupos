const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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
      bytes: text.length,
      ddg_links: (text.match(/class="result__a"/gi) || []).length,
      fb_groups: (text.match(/facebook\.com\/groups\//gi) || []).length,
      bing_algo: (text.match(/class="b_algo"/gi) || []).length,
      head: text.replace(/\s+/g, " ").slice(0, 140),
    };
  } catch (e) {
    return { name, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export default defineEventHandler(async (event) => {
  if (event.node.req.method === "OPTIONS") {
    setHeaders(event, { "Access-Control-Allow-Origin": "*" });
    return "ok";
  }
  const q1 = encodeURIComponent('site:facebook.com/groups "papelaria personalizada"');
  const q2 = encodeURIComponent("papelaria personalizada facebook grupos");
  const out = {
    ddg: await probe("ddg_html", `https://html.duckduckgo.com/html/?q=${q1}`),
    ddg2: await probe("ddg_plain", `https://html.duckduckgo.com/html/?q=${q2}`),
    bing: await probe("bing", `https://www.bing.com/search?q=${q2}&setlang=pt-brcount=50`),
    ddg_lite: await probe("ddg_lite", `https://lite.duckduckgo.com/lite/?q=${q1}`),
  };
  return out;
});