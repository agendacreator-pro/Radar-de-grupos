import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const RADAR_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function verifyUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");
}

// Extract facebook.com/groups/<id> from a DuckDuckGo / search / arbitrary string.
export function extractGroupSlug(href: string): string | null {
  const m = href.match(/facebook\.com\/groups\/([^\/?#&\s]+)/i);
  if (!m) return null;
  const slug = m[1].replace(/[^a-zA-Z0-9_-]/g, "");
  if (!slug) return null;
  return slug;
}

// Given a numeric group id, return the canonical public URL.
export function groupUrlFromSlug(slug: string): string {
  return `https://www.facebook.com/groups/${slug}`;
}

// Normalizes a member-count string ("1,2 mil", "52k", "10.500", "1 milhão") → number | null
export function parseMemberCountRaw(raw: string): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  // "X mil" / "Xk" / "X milhões" / "Xm"
  const mil = s.match(/([\d.,]+)\s*(mil|k)\b/);
  if (mil) {
    return Math.round(parseFloat(mil[1].replace(",", ".")) * 1000);
  }
  const milhao = s.match(/([\d.,]+)\s*(milh[aã]o|milh[aã]oes|m)\b/);
  if (milhao) {
    return Math.round(parseFloat(milhao[1].replace(",", ".")) * 1000000);
  }
  const plain = s.match(/(\d[\d.,]*)/);
  if (plain) {
    return Math.round(parseFloat(plain[1].replace(/\./g, "").replace(",", ".")));
  }
  return null;
}

// Find embedded numeric member count in Facebook page HTML (various shapes).
export function findMemberCountInHtml(html: string): { count: number; raw: string } | null {
  const patterns = [
    /"member_count"\s*:\s*(\d+)/i,
    /"MemberCount"\s*:\s*(\d+)/i,
    /member_count["']?\s*[:=]\s*["']?(\d+)/i,
    /(\d[\d.,]*(?:\s*(?:mil|milh[aã]o|milh[aã]oes|k|m))?)\s*(?:membros|members|member)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const raw = m[0];
      const count = parseMemberCountRaw(m[1]);
      if (count && count > 0) return { count, raw };
    }
  }
  return null;
}

// Detect public/private hint from page title / og:description.
export function detectVisibility(html: string): boolean | null {
  const src = html.toLowerCase();
  if (/(grupo público|public group|public)/.test(src)) return true;
  if (/(grupo privado|private group|privado)/.test(src)) return false;
  return null;
}

// Clean Facebook group title ("Papelaria Criativa | Facebook" → "Papelaria Criativa").
export function cleanGroupTitle(title: string): string {
  if (!title) return "";
  return title
    .replace(/\s*\|\s*Facebook\s*$/i, "")
    .replace(/facebook\s*$/i, "")
    .trim();
}

// Fetch a public group page and extract metadata. Never throws for network failures.
export async function fetchGroupMetadata(
  slugOrUrl: string,
): Promise<{
  name: string | null;
  description: string | null;
  member_count: number | null;
  member_raw: string | null;
  is_public: boolean | null;
  reached: boolean;
}> {
  const slug = slugOrUrl.includes("facebook.com") ? extractGroupSlug(slugOrUrl) : slugOrUrl;
  const out = {
    name: null as string | null,
    description: null as string | null,
    member_count: null as number | null,
    member_raw: null as string | null,
    is_public: null as boolean | null,
    reached: false,
  };
  if (!slug) return out;
  const url = groupUrlFromSlug(slug);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": RADAR_USER_AGENT,
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return out;
    const html = await res.text();
    out.reached = true;

    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const ogDesc = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i);
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);

    const descContent = ogDesc ? decodeEntities(ogDesc[1]) : "";
    out.description = descContent || null;

    const title = ogTitle ? decodeEntities(ogTitle[1]) : titleTag ? decodeEntities(titleTag[1]) : "";
    out.name = cleanGroupTitle(title) || null;

    const member = findMemberCountInHtml(html);
    if (member) {
      out.member_count = member.count;
      out.member_raw = member.raw;
    } else if (descContent) {
      // Fallback: parse from og:description ("Grupo público · 1,2 mil membros")
      const c = parseMemberCountRaw(descContent);
      if (c && c > 0) {
        out.member_count = c;
        out.member_raw = c.toLocaleString("pt-BR") + " membros";
      }
    }

    out.is_public = detectVisibility(descContent || title);
  } catch {
    // Network blocked / timeout — group still saved, count stays "Não confirmado".
  } finally {
    clearTimeout(timer);
  }
  return out;
}

// DuckDuckGo HTML search — returns list of group slugs with result title/snippet.
export async function duckDuckGoSearch(
  query: string,
  maxResults = 60,
): Promise<Array<{ slug: string; title: string; snippet: string }>> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": RADAR_USER_AGENT,
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        Accept: "text/html",
      },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: Array<{ slug: string; title: string; snippet: string }> = [];
    // DuckDuckGo wraps links in //duckduckgo.com/l/?uddg=<encoded>&rut=...
    const linkRe = /href="([^"]+)"[^>]*class="result__a"[^>]*>(.*?)<\/a>/gi;
    const snippetRe = /class="result__snippet"[^>]*>(.*?)<\/[^>]+>/gi;
    const titles: string[] = [];
    const snippets: string[] = [];
    let m: RegExpExecArray | null;
    const results: Array<{ href: string; label: string }> = [];
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1].replace(/&amp;/g, "&");
      const label = m[2].replace(/<[^>]+>/g, "").trim();
      results.push({ href, label });
    }
    while ((m = snippetRe.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
    }
    results.forEach((r, i) => {
      titles.push(decodeEntities(r.label));
    });
    const seen = new Set<string>();
    for (let i = 0; i < results.length; i++) {
      const target = results[i].href.match(/uddg=([^&]+)/);
      const realUrl = target ? decodeURIComponent(target[1]) : results[i].href;
      const slug = extractGroupSlug(realUrl);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, title: titles[i] ?? "", snippet: snippets[i] ?? "" });
      if (out.length >= maxResults) break;
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Promise pool with concurrency limit.
export async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < items.length) {
      const item = items[i++];
      if (item === undefined) return;
      try {
        await fn(item);
      } catch {
        // one failed fetch should not halt the whole search
      }
    }
  });
  await Promise.all(workers);
}