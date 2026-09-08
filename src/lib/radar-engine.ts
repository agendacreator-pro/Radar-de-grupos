import { createServerFn } from "@tanstack/react-start";
import type { RadarGroup } from "@/lib/radar";

// ============================================================
// Radar de Grupos — mecanismo de descoberta (roda no Worker).
// Egresso: Cloudflare Workers (as fontes bloqueiam o Supabase).
// Fontes: DuckDuckGo (html + lite, com fallback/retry) e,
// opcionalmente, Tavily (TAVILY_API_KEY) ou Brave (BRAVE_API_KEY) quando
// configurados (Tavily tem precedência: é a fonte mais limpa para LLMs).
// Contagem de membros: extraída de snippets públicos dos buscadores
// (nunca inventada); quando indisponível, permanece "não confirmado".
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAX_TERMS = 10;
const MAX_QUERIES = 42; // subrequests to search engines (Cloudflare free: ~50)
const WALL_BUDGET_MS = 30_000;
const DELAY_BETWEEN_QUERIES_MS = 950;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s: string): string {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

function b64decode(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return "";
  }
}

function decodeBingRedirect(h: string): string {
  const m = h.match(/u=a1([^&]+)/);
  if (!m) return h;
  const decoded = b64decode(m[1] ?? "");
  return decoded || h;
}

function extractSlug(url: string): string | null {
  const m = url.match(/facebook\.com\/groups\/([^/?#&\s]+)/i);
  if (!m) return null;
  const slug = (m[1] ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  return slug || null;
}

function cleanUrl(slug: string): string {
  return `https://www.facebook.com/groups/${slug}`;
}

function cleanTitle(title: string): string {
  return decodeEntities(title)
    .replace(/\s*\|\s*Facebook\s*$/i, "")
    .replace(/facebook\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const COUNTRY_MAP: Record<string, string> = {
  br: "BR", brasil: "BR", brazil: "BR", brazilian: "BR",
  pt: "PT", portugal: "PT", portuguese: "PT",
  ao: "AO", angola: "AO", angolan: "AO",
  mz: "MZ", mocambique: "MZ", mozambique: "MZ", "moçambique": "MZ",
  cv: "CV", "cabo verde": "CV", "cape verde": "CV",
  tl: "TL", timor: "TL", "timor leste": "TL",
  gw: "GW", "guine bissau": "GW", "guiné bissau": "GW",
  st: "ST", "sao tome": "ST", "são tomé": "ST",
  gq: "GQ", "guine equatorial": "GQ", "guiné equatorial": "GQ",
};

function detectCountry(url: string, snippet: string, title: string): string {
  const localeM = url.match(/[?&]locale=([a-z]{2})_(?:[A-Z]{2})?/i);
  if (localeM) {
    const code = COUNTRY_MAP[(localeM[1] ?? "").toLowerCase()];
    if (code) return code;
  }
  const text = `${title} ${snippet}`.toLowerCase();
  for (const [key, code] of Object.entries(COUNTRY_MAP)) {
    if (text.includes(key) && key.length > 2) return code;
  }
  return "BR";
}

// ---- member-count parsing (snippets / titles, never fabricated) ----
function parseNum(raw: string): number {
  let s = raw.trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(/,/g, ".");
  return parseFloat(s);
}

function parseMemberCountText(text: string): { count: number; raw: string } | null {
  if (!text) return null;
  const src = decodeEntities(text).replace(/\s+/g, " ").trim();
  // Exige palavra de membro logo após o valor (evita falso positivo de preço: "R$ 89 mil")
  const combo: Array<[number, RegExp]> = [
    [1_000_000, /(\d[\d.,]{0,9})\s*milh(?:[ãa]o|[oõ]es?)\s*(?:de\s+)?(?:membros?|members|integrantes|pessoas|participantes)/i],
    [1000, /(\d[\d.,]{0,9})\s*mil\s*(?:de\s+)?(?:membros?|members|integrantes|pessoas|participantes)/i],
    [1000, /(\d[\d.,]{0,9})\s*([kK])\s*(?:de\s+)?(?:membros?|members|integrantes|pessoas|participantes)/i],
    [1_000_000, /(\d[\d.,]{0,9})\s*([mM])\s*(?:de\s+)?(?:membros?|members)/i],
    [1, /(\d[\d.,]{0,11})\s*(?:membros?|members|integrantes|pessoas|participantes)/i],
  ];
  for (const [unit, re] of combo) {
    const m = re.exec(src);
    if (!m) continue;
    const n = parseNum(m[1] ?? "");
    if (!(n > 0)) continue;
    const count = Math.round(n * unit);
    if (count < 100) continue;
    return { count, raw: m[0] };
  }
  return null;
}

function detectPublic(text: string): boolean | null {
  const s = (text ?? "").toLowerCase();
  if (/grupo públic|public group|grupo publico/i.test(s)) return true;
  if (/grupo privado|private group|privado/i.test(s)) return false;
  return null;
}

// ============================================================
// Providers
// ============================================================

type SerpRow = { slug: string; url: string; title: string; snippet: string };

type FetchedPage = { ok: boolean; status: number; html: string; blocked: boolean };

async function fetchSerp(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9", Accept: "text/html" },
    });
    const html = await res.text();
    const blocked = res.status === 202 || res.status === 429 || /anomaly|captcha|unusual/i.test(
      html.slice(0, 4000),
    );
    return { ok: res.ok || res.status === 200, status: res.status, html, blocked };
  } catch {
    return { ok: false, status: 0, html: "", blocked: true };
  } finally {
    clearTimeout(timer);
  }
}

function parseDdgHtml(html: string): SerpRow[] {
  const out: SerpRow[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<div class="?result"?>/i).slice(1);
  for (const b of blocks.slice(0, 30)) {
    const a = b.match(/<a[^>]+class="?result__a"?[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/i);
    const snip = b.match(/<a[^>]+class="?result__snippet"?[^>]*>(.*?)<\/a>/i) ||
      b.match(/class="?result__snippet"?[^>]*>(.*?)<\/[^>]+>/i);
    if (!a) continue;
    const href = (a[1] ?? "").replace(/&amp;/g, "&");
    const m = href.match(/uddg=([^&]+)/);
    let url = href;
    if (m) {
      try {
        url = decodeURIComponent(m[1] ?? "");
      } catch {}
    }
    const slug = extractSlug(url);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug,
      url: cleanUrl(slug),
      title: cleanTitle(a[2] ?? ""),
      snippet: snip ? cleanTitle(snip[1] ?? "") : "",
    });
    if (out.length >= 20) break;
  }
  return out;
}

function parseDdgLite(html: string): SerpRow[] {
  const out: SerpRow[] = [];
  const seen = new Set<string>();
  // Link rows + snippet rows both carry class 'result-link' / 'result-snippet'
  const links = [
    ...html.matchAll(
      /class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>(.*?)<\/a>/gi,
    ),
  ];
  const snippets = [
    ...html.matchAll(/class=['"]result-snippet['"][^>]*>(.*?)<\/[^>]+>/gis),
  ];
  links.forEach((m, i) => {
    const href = (m[1] ?? "").replace(/&amp;/g, "&");
    const m2 = href.match(/uddg=([^&]+)/);
    let url = href;
    if (m2) {
      try {
        url = decodeURIComponent(m2[1] ?? "");
      } catch {}
    }
    const slug = extractSlug(url);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    out.push({
      slug,
      url: cleanUrl(slug),
      title: cleanTitle(m[2] ?? ""),
      snippet: cleanTitle(snippets[i]?.[1] ?? ""),
    });
  });
  return out;
}

function parseBing(html: string): SerpRow[] {
  const out: SerpRow[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<li class="b_algo".*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>.*?<\/li>/gis)) {
    const url = decodeBingRedirect((m[1] ?? "").replace(/&amp;/g, "&"));
    const slug = extractSlug(url);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, url: cleanUrl(slug), title: cleanTitle(m[2] ?? ""), snippet: "" });
  }
  return out;
}

async function tavilySearch(q: string, key: string): Promise<SerpRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: q,
        search_depth: "basic",
        max_results: 20,
        include_domains: ["facebook.com"],
      }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { results?: Array<{ url: string; title?: string; content?: string }> };
    const out: SerpRow[] = [];
    const seen = new Set<string>();
    for (const r of j.results ?? []) {
      const slug = extractSlug(r.url);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({
        slug,
        url: cleanUrl(slug),
        title: r.title ?? slug,
        // Tavily content cost be token-heavy; truncate to be safe.
        snippet: (r.content ?? "").slice(0, 1200),
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function braveSearch(q: string, key: string): Promise<SerpRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=20&country=br`, {
      signal: controller.signal,
      headers: { "X-Subscription-Token": key, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { web?: { results?: Array<{ url: string; title: string; description?: string }> } };
    const out: SerpRow[] = [];
    const seen = new Set<string>();
    for (const r of j.web?.results ?? []) {
      const slug = extractSlug(r.url);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      out.push({ slug, url: cleanUrl(slug), title: r.title, snippet: r.description ?? "" });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Searches a single query across providers with retry/fallback
// ============================================================

async function searchQuery(
  query: string,
  budget: { queries: number },
  tavilyKey: string | null,
  braveKey: string | null,
): Promise<{ rows: SerpRow[]; ok: boolean; failures: string[] }> {
  if (budget.queries <= 0) return { rows: [], ok: true, failures: ["budget"] };
  const enc = encodeURIComponent(query);

  // Tavily first if configured (cleanest for LLMs, avoids DDG 202s)
  if (tavilyKey) {
    budget.queries--;
    const rows = await tavilySearch(query, tavilyKey);
    return { rows, ok: true, failures: [] };
  }

  // Brave next if configured (clean data)
  if (braveKey) {
    budget.queries--;
    const rows = await braveSearch(query, braveKey);
    return { rows, ok: true, failures: [] };
  }

  // DDG html → fallback lite → bing, with retry
  const attempts: Array<() => Promise<FetchedPage>> = [
    () => fetchSerp(`https://html.duckduckgo.com/html/?q=${enc}&ia=web`),
    () => fetchSerp(`https://lite.duckduckgo.com/lite/?q=${enc}`),
    () => fetchSerp(`https://html.duckduckgo.com/html/?q=${enc}&kl=br-pt`),
  ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    if (budget.queries <= 0) break;
    budget.queries--;
    const page = await attempt();
    if (page.blocked || page.status === 202) {
      failures.push(`ddg ${page.status}`);
      // Backoff mais longo reduz a cascata de desafios (202) do DDG.
      await sleep(2400 + Math.random() * 1400);
      continue;
    }
    if (!page.ok) {
      failures.push(`ddg status ${page.status}`);
      continue;
    }
    let rows = parseDdgHtml(page.html);
    if (rows.length === 0) rows = parseDdgLite(page.html);
    if (rows.length > 0) return { rows, ok: true, failures };
    failures.push("ddg sem resultados");
  }

  // Last resort: Bing (rarely returns fb groups, but costs nothing)
  if (budget.queries > 0) {
    budget.queries--;
    const page = await fetchSerp(`https://www.bing.com/search?q=${enc}&setlang=pt-br&count=20&mkt=pt-BR`);
    if (page.ok && !page.blocked) {
      const rows = parseBing(page.html);
      if (rows.length > 0) return { rows, ok: true, failures };
    }
    failures.push("bing falhou");
  }

  return { rows: [], ok: false, failures };
}

// ============================================================
// Term expansion
// ============================================================

const NICHE_SYNONYMS: Record<string, string[]> = {
  papelaria: ["encadernação", "agendas personalizadas", "planners", "kits digitais", "papelaria criativa", "caderno personalizado", "scrapbooking", "lembrancinhas", "convites personalizados", "adesivos personalizados", "carimbos personalizados", "canecas personalizadas", "cartões personalizados"],
  "papelaria personalizada": ["papelaria criativa", "encadernação", "agendas personalizadas", "planners", "kits digitais", "caderno personalizado", "convites personalizados", "lembrancinhas personalizadas", "adesivos personalizados", "carimbos personalizados", "canecas personalizadas", "cartões personalizados"],
  encadernação: ["encadernação artesanal", "caderno artesanal", "agendas artesanais", "papelaria artesanal", "livreto artesanal"],
  "agendas personalizadas": ["agendas", "planners", "agendinhas", "caderno personalizado", "diário personalizado"],
  planners: ["planners", "planejamento", "menina organizada", "bullet journal"],
  "kits digitais": ["kits digitais", "arquivos digitais", "cliparts", "sublimação", "papel digital"],
  artesanato: ["artesanato", "manualidades", "artesanato em eva", "artesanato e personalizados", "fazer e vender"],
  sublimação: ["sublimação", "canecas personalizadas", "estampas", "copo mágico", "termotransferência", "personalizados"],
  "papelaria criativa": ["papelaria personalizada", "encadernação", "kits digitais", "agendas personalizadas"],
};

function expandTerms(raw: string[]): string[] {
  const out = new Set<string>();
  for (const t of raw) {
    const key = t.toLowerCase().trim();
    const syns = NICHE_SYNONYMS[key];
    if (syns) for (const s of syns) out.add(s);
    for (const base of Object.values(NICHE_SYNONYMS)) {
      if (base.some((s) => s.toLowerCase().includes(key) && t.trim().length > 2)) {
        for (const s of base.slice(0, 4)) out.add(s);
      }
    }
  }
  // always keep user terms on top
  const ordered = [...raw, ...[...out].filter((t) => !raw.includes(t))];
  return ordered.slice(0, MAX_TERMS);
}

function queryTemplates(term: string): string[] {
  const t = term.trim();
  return [
    `site:facebook.com/groups "${t}"`,
    `"${t}" facebook grupo membros`,
    `"${t}" mil membros facebook grupo`,
  ];
}

// ---- relevance filter (keeps only groups tied to the niche) ----
// Um grupo descoberto só entra na lista se o nome ou a descrição dele contém
// o nicho digitado pelo usuário ou um dos sinônimos do nicho. Isso derruba
// grupos aleatórios que um buscador retorna junto, mas que não têm a ver com
// a busca ("Vendas geral", comunidades de outros temas, etc.).
// Quando o usuário digita uma frase composta ("papelaria personalizada"),
// exige-se correspondência com uma chave multipalavra (mais específica) —
// derruba lojas/assuntos parecidos, mas de outro nicho.
function buildRelevanceKeys(
  rawTerms: string[],
  expanded: string[],
): { pool: string[]; strictOnly: boolean } {
  const pool = new Set<string>();
  for (const t of [...rawTerms, ...expanded]) {
    const k = t.toLowerCase().trim();
    if (k.length < 3) continue;
    pool.add(k);
  }
  const strictOnly = rawTerms.some((t) => {
    const k = t.toLowerCase().trim();
    return k.includes(" ") && k.length >= 3;
  });
  return { pool: [...pool], strictOnly };
}

function isRelevantToNiche(
  g: { name: string; description: string | null },
  keys: { pool: string[]; strictOnly: boolean },
): boolean {
  const hay = `${g.name} ${g.description ?? ""}`.toLowerCase();
  if (keys.strictOnly) {
    const strictKeys = keys.pool.filter((k) => k.includes(" "));
    return strictKeys.some((k) => hay.includes(k));
  }
  return keys.pool.some((k) => hay.includes(k));
}

// ============================================================
// Persistence (defensive; failures are logged and reported)
// ============================================================

async function getAdmin() {
  const mod = await import("@/integrations/supabase/client.server");
  return mod.supabaseAdmin;
}

type Discovered = {
  slug: string;
  url: string;
  name: string;
  description: string | null;
  member_count: number | null;
  member_raw: string | null;
  is_public: boolean | null;
  source: string;
  term: string;
  country: string;
};

type PersistResult = { groupIds: string[]; inserted: number; rows: any[] | null };

// Batch upsert via RPC: insert + merge + attach + load em UM subrequest
// (limite de ~50 subrequests por invocação no Worker era estourado com a
// via avulsa: 30 queries Tavily + select + insert + N merges + attach + load).
async function persistGroups(
  userId: string,
  groups: Discovered[],
  terms: string[],
): Promise<PersistResult> {
  if (groups.length === 0) return { groupIds: [], inserted: 0, rows: [] };
  const admin = await getAdmin();
  try {
    const { data, error } = await admin.rpc("radar_upsert_groups", {
      p_user: userId,
      p_terms: terms,
      p_groups: groups.map((g) => ({
        slug: g.slug,
        url: g.url,
        name: g.name,
        description: g.description,
        term: g.term,
        member_count: g.member_count,
        member_raw: g.member_raw,
        is_public: g.is_public,
        source: g.source,
        country: g.country,
      })),
    });
    if (!error && data) {
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      const rows: any[] = Array.isArray(parsed?.groups) ? parsed.groups : [];
      return {
        groupIds: rows.map((r: any) => r.id),
        inserted: typeof parsed?.inserted === "number" ? parsed.inserted : rows.length,
        rows,
      };
    }
    if (error) console.error("[radar] batch rpc:", error.message);
  } catch (err) {
    console.error("[radar] batch rpc threw:", err);
  }
  // Fallback legado (via avulsa do TS) caso a função RPC ainda não exista no
  // banco — funcional, porém mais lento e sujeito ao limite de subrequests.
  return persistGroupsLegacy(userId, groups, terms);
}

async function persistGroupsLegacy(
  userId: string,
  groups: Discovered[],
  terms: string[],
): Promise<PersistResult> {
  const admin = await getAdmin();
  const io = new Date().toISOString();
  const urls = [...new Set(groups.map((g) => g.url))];
  const { data: existing } = await admin
    .from("radar_grupos")
    .select("id,url,fb_id,name,member_count,member_raw,fontes,derivado_de")
    .in("url", urls);
  const byUrl = new Map<string, any>((existing ?? []).map((r: any) => [r.url, r]));
  const groupIds: string[] = [];
  let inserted = 0;

  const toInsert: Discovered[] = [];
  const toMerge: Array<{ cur: any; g: Discovered }> = [];
  for (const g of groups) {
    const cur = byUrl.get(g.url);
    if (!cur) toInsert.push(g);
    else toMerge.push({ cur, g });
  }

  // Bulk insert (1 request) — evita "Too many subrequests" com dezenas de grupos.
  if (toInsert.length > 0) {
    const rows = toInsert.map((g) => {
      const fbId = /^\d+$/.test(g.slug) ? g.slug : null;
      return {
        fb_id: fbId,
        url: g.url,
        name: g.name || g.slug,
        description: g.description,
        categoria: terms[0] && g.term !== "importado" ? g.term : null,
        member_count: g.member_count,
        member_raw: g.member_raw,
        member_checked_at: g.member_count != null ? io : null,
        is_public: g.is_public,
        country: g.country ?? "BR",
        fontes: [g.source],
        derivado_de: [...new Set([g.term, ...terms].filter(Boolean))],
      };
    });
    const { data: insData, error: insErr } = await admin
      .from("radar_grupos")
      .insert(rows)
      .select("id,url,name,description,categoria,member_count,member_raw,is_public,fontes,derivado_de,member_checked_at,created_at,updated_at");
    if (insErr) {
      console.error("[radar] bulk insert:", insErr.message);
    } else {
      for (const r of insData ?? []) {
        groupIds.push((r as any).id);
        inserted++;
      }
    }
  }

  // Merges puntuais (raros após a primeira população) — 1 request apenas quando algo muda.
  for (const { cur, g } of toMerge) {
    const patch: Record<string, unknown> = { updated_at: io };
    const fonts = new Set<string>([...((cur.fontes ?? []) as string[]), g.source]);
    const tAll = new Set<string>([...((cur.derivado_de ?? []) as string[]), ...terms.filter(Boolean)]);
    let changed = false;
    if (JSON.stringify(cur.fontes ?? []) !== JSON.stringify([...fonts])) {
      patch["fontes"] = [...fonts];
      changed = true;
    }
    if (JSON.stringify(cur.derivado_de ?? []) !== JSON.stringify([...tAll])) {
      patch["derivado_de"] = [...tAll];
      changed = true;
    }
    if (!cur.name && g.name) {
      (patch as any).name = g.name;
      changed = true;
    }
    if (g.member_count != null && (cur.member_count == null || !cur.member_raw)) {
      patch["member_count"] = g.member_count;
      patch["member_raw"] = g.member_raw;
      patch["member_checked_at"] = io;
      changed = true;
    }
    if (g.description && !cur.name) (patch as any).description = g.description;
    if (changed) {
      await admin.from("radar_grupos").update(patch as any).eq("id", cur.id).then(({ error }) => {
        if (error) console.error("[radar] update:", error.message);
      });
    }
    groupIds.push(cur.id);
  }

  // attach user rows (bulk)
  const uniq = [...new Set(groupIds)];
  const { data: mine } = await admin
    .from("radar_grupo_usuario")
    .select("grupo_id")
    .eq("user_id", userId)
    .in("grupo_id", uniq);
  const have = new Set((mine ?? []).map((r: any) => r.grupo_id));
  const toIns = uniq.filter((g) => !have.has(g));
  if (toIns.length > 0) {
    await admin
      .from("radar_grupo_usuario")
      .insert(toIns.map((grupo_id) => ({ user_id: userId, grupo_id })))
      .then(({ error }) => {
        if (error) console.error("[radar] attach:", error.message);
      });
  }
  return { groupIds: uniq, inserted, rows: null };
}

async function loadGroupsByIds(userId: string, ids: string[]): Promise<any[]> {
  if (ids.length === 0) return [];
  const admin = await getAdmin();
  const { data, error } = await admin
    .from("radar_grupos")
    .select("*, radar_grupo_usuario!inner(*)")
    .eq("radar_grupo_usuario.user_id", userId)
    .in("id", ids)
    .order("member_count", { ascending: false, nullsFirst: false });
  if (error) {
    console.error("[radar] loadGroupsByIds error:", error.message, { ids: ids.length });
    return [];
  }
  return (data ?? []).map((r: any) => ({
    ...r,
    status: r.radar_grupo_usuario?.[0]?.status ?? "salvo",
    favorito: r.radar_grupo_usuario?.[0]?.favorito ?? false,
    notas: r.radar_grupo_usuario?.[0]?.notas ?? null,
    tags: r.radar_grupo_usuario?.[0]?.tags ?? [],
    permite_divulgacao: r.radar_grupo_usuario?.[0]?.permite_divulgacao ?? false,
    radar_grupo_usuario: undefined,
  }));
}

async function verifyUser(token: string): Promise<string | null> {
  if (!token) return null;
  const admin = await getAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// ============================================================
// Server Functions
// ============================================================

export type RadarSearchInput = { q: string; terms: string[]; token: string };

export const radarSearch = createServerFn({ method: "POST" })
  .validator((d: RadarSearchInput) => d)
  .handler(async ({ data }) => {
    const t0 = Date.now();
    let userId: string | null;
    try {
      userId = await verifyUser(data.token);
    } catch (err) {
      console.error("[radar] radarSearch verifyUser:", err);
      return { success: false, error: "Erro de configuração do servidor. Tente novamente em instantes." };
    }
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };

    const rawTerms = [...new Set([data.q, ...(data.terms ?? [])].map((t) => String(t??"").trim()).filter(Boolean))];
    if (rawTerms.length === 0) {
      return { success: false, error: "Informe um termo ou pelo menos uma referência." };
    }
    const terms = expandTerms(rawTerms);
    const tavilyKey = (process.env["TAVILY_API_KEY"] as string | undefined) || null;
    const braveKey = (process.env["BRAVE_API_KEY"] as string | undefined) || null;
    const sourceName = tavilyKey ? "tavily" : braveKey ? "brave" : "duckduckgo";

    const budget = { queries: MAX_QUERIES };
    const discovered = new Map<string, Discovered>();
    const sourceFailures: string[] = [];
    let sourcesOk = 0;
    let budgetHit = false;

    // Todos os pares (termo, consulta) — templates focados em grupos/membros,
    // inclusive os grandes (snippets com "X mil/milhões de membros").
    const tasks: Array<{ term: string; q: string }> = [];
    for (const term of terms) {
      for (const q of queryTemplates(term)) tasks.push({ term, q });
    }
    const wallDeadline = t0 + WALL_BUDGET_MS;

    async function runTask(task: { term: string; q: string }) {
      if (budget.queries <= 0 || Date.now() > wallDeadline) return;
      const { rows, ok, failures } = await searchQuery(task.q, budget, tavilyKey, braveKey);
      if (ok && rows.length > 0) sourcesOk++;
      else if (failures.length) sourceFailures.push(...failures);
      for (const r of rows) {
        const cur = discovered.get(r.slug);
        const mc = parseMemberCountText(r.snippet || r.title);
        const pub = detectPublic(r.snippet || r.title);
        const country = detectCountry(r.url, r.snippet || "", r.title);
        if (!cur) {
          discovered.set(r.slug, {
            slug: r.slug,
            url: r.url,
            name: cleanTitle(r.title) || r.slug,
            description: r.snippet || null,
            member_count: mc?.count ?? null,
            member_raw: mc?.raw ?? null,
            is_public: pub,
            source: sourceName,
            term: task.term,
            country,
          });
        } else {
          if (mc && cur.member_count == null) {
            cur.member_count = mc.count;
            cur.member_raw = mc.raw;
          }
          if (pub != null && cur.is_public == null) cur.is_public = pub;
          if (!cur.name || cur.name === cur.slug) cur.name = cleanTitle(r.title) || cur.name;
          if (!cur.description && r.snippet) cur.description = r.snippet;
          if (cur.country === "BR" && country !== "BR") cur.country = country;
        }
      }
    }

    if (tavilyKey) {
      // Tavily estável e sem rate-limit: 3 consultas simultâneas respeitando o
      // orçamento de subrequests (~42 < limite de 50).
      let idx = 0;
      const worker = async () => {
        while (idx < tasks.length) {
          if (budget.queries <= 0 || Date.now() > wallDeadline) {
            budgetHit = true;
            break;
          }
          const task = tasks[idx++];
          if (!task) break;
          await runTask(task);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } else {
      for (const task of tasks) {
        if (budget.queries <= 0 || Date.now() > wallDeadline) {
          budgetHit = true;
          break;
        }
        await runTask(task);
        // Reset slashes between queries to lower anomaly risk (só DDG)
        if (budget.queries > 0 && !braveKey) await sleep(DELAY_BETWEEN_QUERIES_MS);
      }
    }

    const all = [...discovered.values()];
    const relevanceKeys = buildRelevanceKeys(rawTerms, terms);
    const allCount = all.length;
    const relevant = all.filter((g) => isRelevantToNiche(g, relevanceKeys));
    if (relevant.length < allCount) {
      console.log(
        `[radar] relevância: ${relevant.length}/${allCount} grupos mantidos (${allCount - relevant.length} fora do nicho descartados)`,
        { terms: rawTerms.slice(0, 5) },
      );
    }
    let groupIds: string[] = [];
    let inserted = 0;
    let groups: RadarGroup[] = [];
    try {
      const persisted = await persistGroups(userId, relevant, terms);
      groupIds = persisted.groupIds;
      inserted = persisted.inserted;
      if (persisted.rows && persisted.rows.length > 0) {
        // Via RPC o banco já devolve as linhas prontas (sem subrequest extra).
        groups = persisted.rows as unknown as RadarGroup[];
      }
    } catch (err) {
      console.error("[radar] radarSearch persist:", err);
      return { success: false, error: "Não foi possível salvar os grupos encontrados. Tente novamente." };
    }
    // Se havia grupos relevantes descobertos e nenhum foi salvo, algo falhou
    // no banco — não mascarar como "0 grupos".
    if (relevant.length > 0 && groupIds.length === 0) {
      console.error(
        "[radar] radarSearch: groups discovered but none persisted",
        { discovered: relevant.length, source_failures: sourceFailures.slice(0, 8) },
      );
      return { success: false, error: "Os grupos foram encontrados, mas não foi possível salvá-los agora. Tente novamente." };
    }
    // Se o filtro de relevância descartou tudo, informar com clareza —
    // incluindo quantos foram encontrados porém fora do nicho.
    if (relevant.length === 0 && allCount > 0) {
      console.log(
        "[radar] radarSearch: filtro de relevância zerou os resultados",
        { discovered: allCount, terms: rawTerms.slice(0, 5) },
      );
    }

    // history
    try {
      const admin = await getAdmin();
      await admin.from("radar_buscas").insert({
        user_id: userId,
        termo: terms[0] ?? "",
        termos: terms,
        total_resultados: all.length,
        total_grupos: groupIds.length,
      });
    } catch (err) {
      console.error("[radar] radarSearch history:", err);
    }

    // Fallback legado: sem rows do RPC, recarrega do banco (1 request).
    if (groups.length === 0 && groupIds.length > 0) {
      try {
        groups = (await loadGroupsByIds(userId, groupIds)) as RadarGroup[];
      } catch (err) {
        console.error("[radar] radarSearch load:", err);
        return { success: false, error: "Não foi possível carregar os resultados salvos. Tente novamente." };
      }
      if (groups.length === 0) {
        console.error(
          "[radar] radarSearch: groups persisted but none reloaded",
          { group_ids: groupIds.length, discovered: all.length },
        );
        return { success: false, error: "Não foi possível carregar os resultados salvos. Tente novamente." };
      }
    }
    const confirmed = groups.filter((g) => g.member_count != null).length;

    return {
      success: true,
      total_unique: groupIds.length,
      total_cache_new: inserted,
      confirmed_count: confirmed,
      unconfirmed_count: groups.length - confirmed,
      filtered_dropped: allCount - relevant.length,
      groups,
      terms_used: terms,
      sources_ok: sourcesOk,
      source_failures: [...new Set(sourceFailures)].slice(0, 8),
      budget_hit: budgetHit,
      elapsed_ms: Date.now() - t0,
    };
  });

export type RadarImportInput = { urls: string[]; token: string };

export const radarImport = createServerFn({ method: "POST" })
  .validator((d: RadarImportInput) => d)
  .handler(async ({ data }) => {
    let userId: string | null;
    try {
      userId = await verifyUser(data.token);
    } catch (err) {
      console.error("[radar] radarImport verifyUser:", err);
      return { success: false, error: "Erro de configuração do servidor. Tente novamente em instantes." };
    }
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    const urls = (data.urls ?? []).map((u) => String(u ?? "").trim()).filter(Boolean);
    if (urls.length === 0) return { success: false, error: "Cole pelo menos um link." };

    const seen = new Set<string>();
    const groups: Discovered[] = [];
    for (const u of urls) {
      const slug = extractSlug(u);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      groups.push({
        slug,
        url: cleanUrl(slug),
        name: slug,
        description: null,
        member_count: null,
        member_raw: null,
        is_public: null,
        source: "importado",
        term: "importado",
        country: detectCountry(cleanUrl(slug), "", slug),
      });
    }
    let groupIds: string[] = [];
    let inserted = 0;
    let list: any[] = [];
    try {
      const persisted = await persistGroups(userId, groups, ["importado"]);
      groupIds = persisted.groupIds;
      inserted = persisted.inserted;
      if (persisted.rows && persisted.rows.length > 0) list = persisted.rows;
    } catch (err) {
      console.error("[radar] radarImport persist:", err);
      return { success: false, error: "Não foi possível importar os grupos agora. Tente novamente." };
    }
    if (groups.length > 0 && groupIds.length === 0) {
      console.error("[radar] radarImport: urls given but none persisted", { urls: groups.length });
      return { success: false, error: "Não foi possível salvar os links importados agora. Tente novamente." };
    }
    if (list.length === 0 && groupIds.length > 0) {
      try {
        list = await loadGroupsByIds(userId, groupIds);
      } catch (err) {
        console.error("[radar] radarImport load:", err);
        return { success: false, error: "Não foi possível carregar os grupos importados. Tente novamente." };
      }
    }
    const confirmed = list.filter((g) => g.member_count != null).length;
    return {
      success: true,
      total_unique: groupIds.length,
      total_cache_new: inserted,
      confirmed_count: confirmed,
      unconfirmed_count: list.length - confirmed,
      groups: list,
    };
  });

export type RadarRecheckInput = { url: string; token: string };

export const radarRecheck = createServerFn({ method: "POST" })
  .validator((d: RadarRecheckInput) => d)
  .handler(async ({ data }) => {
    let userId: string | null;
    try {
      userId = await verifyUser(data.token);
    } catch (err) {
      console.error("[radar] radarRecheck verifyUser:", err);
      return { success: false, error: "Erro de configuração do servidor. Tente novamente em instantes." };
    }
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    const slug = extractSlug(String(data.url ?? ""));
    if (!slug) return { success: false, error: "Link de grupo inválido." };

    // Attempt snippet-based re-confirmation for this single group.
    let mc: { count: number; raw: string } | null = null;
    let title = slug;
    let isPublic: boolean | null = null;
    const enc = encodeURIComponent(`site:facebook.com/groups "${slug}"`);
    const page = await fetchSerp(`https://html.duckduckgo.com/html/?q=${enc}`);
    if (page.ok && !page.blocked) {
      const rows = [...parseDdgHtml(page.html), ...parseDdgLite(page.html)];
      for (const r of rows) {
        if (r.slug !== slug) continue;
        title = r.title;
        mc = parseMemberCountText(r.snippet || r.title);
        isPublic = detectPublic(r.snippet || r.title);
        if (r.snippet) title = r.title;
        break;
      }
    }

    const admin = await getAdmin();
    const url = cleanUrl(slug);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (mc) {
      patch["member_count"] = mc.count;
      patch["member_raw"] = mc.raw;
      patch["member_checked_at"] = new Date().toISOString();
    }
    if (title !== slug) patch["name"] = title;
    if (isPublic != null) patch["is_public"] = isPublic;

    const { data: existing } = await admin
      .from("radar_grupos")
      .select("id")
      .eq("url", url)
      .maybeSingle();
    if (existing) {
      await admin.from("radar_grupos").update(patch as any).eq("id", existing.id);
    } else {
      await admin.from("radar_grupos").insert({
        url,
        fb_id: /^\d+$/.test(slug) ? slug : null,
        name: title,
        member_count: mc?.count ?? null,
        member_raw: mc?.raw ?? null,
        member_checked_at: mc ? new Date().toISOString() : null,
        is_public: isPublic,
        fontes: ["recheck"],
        derivado_de: ["recheck"],
      }).select("id").single().then(async (r) => {
        if (r.data && !r.error) {
          const { data: mine } = await admin
            .from("radar_grupo_usuario")
            .select("grupo_id")
            .eq("user_id", userId)
            .eq("grupo_id", r.data.id);
          if (!mine || mine.length === 0) {
            await admin.from("radar_grupo_usuario").insert({ user_id: userId, grupo_id: r.data.id });
          }
        }
      });
    }

    const list = await loadGroupsByIds(userId, [existing?.id ?? "", cleanUrl(slug) ? "" : ""].filter(Boolean));
    // fallback: load by url
    let group: any = list[0] ?? null;
    if (!group) {
      const { data } = await admin
        .from("radar_grupos")
        .select("*, radar_grupo_usuario!inner(*)")
        .eq("radar_grupo_usuario.user_id", userId)
        .eq("url", url)
        .maybeSingle();
      if (data) {
        const r: any = data;
        group = {
          ...r,
          status: r.radar_grupo_usuario?.[0]?.status ?? "salvo",
          favorito: r.radar_grupo_usuario?.[0]?.favorito ?? false,
          notas: r.radar_grupo_usuario?.[0]?.notas ?? null,
          tags: r.radar_grupo_usuario?.[0]?.tags ?? [],
          permite_divulgacao: r.radar_grupo_usuario?.[0]?.permite_divulgacao ?? false,
          radar_grupo_usuario: undefined,
        };
      }
    }
    return { success: true, group, snippet_checked: mc != null };
  });