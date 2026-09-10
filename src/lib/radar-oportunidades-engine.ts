import { createServerFn } from "@tanstack/react-start";
import {
  cleanTitle,
  decodeEntities,
  expandTerms,
  getAdmin,
  rotateWindow,
  seededShuffle,
  sleep,
  verifyUser,
} from "@/lib/radar-engine";
import { classifyIntention, type OportunidadeTipo } from "@/lib/radar-intent";

// ============================================================
// Radar de Oportunidades de Venda — mecanismo de descoberta.
// Roda no Worker. Busca publicações em grupos do Facebook onde o autor está
// PROCURANDO produtos do nicho (buyer). Extração conservadora: só entram
// URLs de publicações reais (groups/.../posts/{id} ou permalink/{id}), com
// deduplicação por post_id + grupo, e classificação semântica da intenção.
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAX_QUERIES = 40;
const WALL_BUDGET_MS = 30_000;
const DELAY_BETWEEN_QUERIES_MS = 950;

type FetchedPage = { ok: boolean; status: number; html: string; blocked: boolean };
type RawRow = { href: string; title: string; snippet: string; published?: string | null };
type PostRef = { slug: string; slugKey: string; postId: string };

const MAX_TARGET_GROUPS = 10;
const MAX_TARGET_TERMS = 6;
const MAX_GENERIC_TERMS = 10;
const MAX_GENERIC_INTENTS = 4;
const MAX_PERSISTED = 200;

// Frases típicas de quem está COMPRANDO — usadas para construir as consultas.
// A cada busca uma janela rotativa diferente dessas frases é usada, para que
// uma nova pesquisa descubra publicações novas (não repetir os mesmos top-20).
const INTENT_PHRASES = [
  "procuro",
  "estou procurando",
  "quem indica",
  "quem vende",
  "preciso de fornecedor",
  "quanto custa",
  "quem faz",
  "onde compro",
  "alguém vende",
  "procurando fornecedor",
  "compro",
  "preciso comprar",
] as const;

function decodeEntitiesCustom(s: string): string {
  return decodeEntities(s)
    .replace(/&#\d+;/g, (m) => {
      const n = Number(m.replace(/\D/g, ""));
      if (!Number.isFinite(n)) return m;
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    })
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Fabricação de URLs de publicação (nunca inventamos post_id) ----
function extractPostInfo(rawUrl: string): PostRef | null {
  const u = (rawUrl ?? "").trim();
  if (!/facebook\.com/i.test(u)) return null;
  const direct = u.match(/facebook\.com\/groups\/([^/?#&]+)\/(?:posts|permalink)\/(\d+)/i);
  if (direct) {
    const slug = (direct[1] ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!slug || !direct[2]) return null;
    return { slug, slugKey: slug.toLowerCase(), postId: direct[2] };
  }
  const viaQuery = u.match(/[?&](?:post_id|story_fbid)=(\d+)/);
  if (viaQuery) {
    const slugM = u.match(/facebook\.com\/groups\/([^/?#&]+)/i);
    if (!slugM) return null;
    const slug = (slugM[1] ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!slug) return null;
    return { slug, slugKey: slug.toLowerCase(), postId: viaQuery[1] ?? "" };
  }
  return null;
}

function postDedupeKey(ref: PostRef): string {
  return `${ref.postId}@${ref.slugKey}`;
}

function normalizePostUrl(ref: PostRef): string {
  return `https://www.facebook.com/groups/${ref.slug}/posts/${ref.postId}`;
}

// ---- Buscadores (preservando URLs originais de posts) ----
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
    const blocked =
      res.status === 202 ||
      res.status === 429 ||
      /anomaly|captcha|unusual/i.test(html.slice(0, 4000));
    return { ok: res.ok || res.status === 200, status: res.status, html, blocked };
  } catch {
    return { ok: false, status: 0, html: "", blocked: true };
  } finally {
    clearTimeout(timer);
  }
}

function resolveDdgHref(href: string): string {
  const clean = href.replace(/&amp;/g, "&");
  const m = clean.match(/uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1] ?? "");
    } catch {
      return clean;
    }
  }
  return clean;
}

function parseDdgHtmlPosts(html: string): RawRow[] {
  const out: RawRow[] = [];
  const blocks = html.split(/<div class="?result"?>/i).slice(1);
  for (const b of blocks.slice(0, 30)) {
    const a = b.match(/<a[^>]+class="?result__a"?[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/i);
    const snip =
      b.match(/<a[^>]+class="?result__snippet"?[^>]*>(.*?)<\/a>/i) ||
      b.match(/class="?result__snippet"?[^>]*>(.*?)<\/[^>]+>/i);
    if (!a) continue;
    const href = a[1] ?? "";
    if (!extractPostInfo(resolveDdgHref(href))) continue;
    out.push({
      href: resolveDdgHref(href),
      title: cleanTitle(a[2] ?? ""),
      snippet: snip ? cleanTitle(snip[1] ?? "") : "",
    });
    if (out.length >= 20) break;
  }
  return out;
}

function parseDdgLitePosts(html: string): RawRow[] {
  const out: RawRow[] = [];
  const links = [
    ...html.matchAll(/class=['"]result-link['"][^>]*href=['"]([^'"]+)['"][^>]*>(.*?)<\/a>/gi),
  ];
  const snippets = [...html.matchAll(/class=['"]result-snippet['"][^>]*>(.*?)<\/[^>]+>/gis)];
  links.forEach((m, i) => {
    const href = resolveDdgHref(m[1] ?? "");
    if (!extractPostInfo(href)) return;
    out.push({
      href,
      title: cleanTitle(m[2] ?? ""),
      snippet: cleanTitle(snippets[i]?.[1] ?? ""),
    });
  });
  return out;
}

function b64decode(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return "";
  }
}

function parseBingPosts(html: string): RawRow[] {
  const out: RawRow[] = [];
  for (const m of html.matchAll(
    /<li class="b_algo".*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>.*?<\/li>/gis,
  )) {
    let href = (m[1] ?? "").replace(/&amp;/g, "&");
    const redir = href.match(/u=a1([^&]+)/);
    if (redir) href = b64decode(redir[1] ?? "") || href;
    if (!extractPostInfo(href)) continue;
    out.push({ href, title: cleanTitle(m[2] ?? ""), snippet: "" });
  }
  return out;
}

async function tavilyPosts(q: string, key: string, days?: number): Promise<RawRow[]> {
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
        search_depth: "advanced",
        max_results: 25,
        include_domains: ["facebook.com"],
        ...(days ? { days, sort_by: "recency" } : {}),
      }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      results?: Array<{ url: string; title?: string; content?: string; published_date?: string }>;
    };
    const out: RawRow[] = [];
    for (const r of j.results ?? []) {
      if (!extractPostInfo(r.url)) continue;
      let published: string | null = null;
      if (r.published_date) {
        const d = new Date(r.published_date);
        if (isFinite(+d) && d.getTime() <= Date.now() + 36e5 && d.getTime() >= Date.now() - 4 * 365 * 864e5) {
          published = d.toISOString();
        }
      }
      out.push({
        href: r.url,
        title: cleanTitle(r.title ?? ""),
        snippet: (r.content ?? "").slice(0, 1200),
        published,
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function bravePosts(q: string, key: string, freshness?: string): Promise<RawRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=25&country=br${freshness ? `&search_freshness=${freshness}` : ""}`,
      {
        signal: controller.signal,
        headers: { "X-Subscription-Token": key, Accept: "application/json" },
      },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      web?: { results?: Array<{ url: string; title: string; description?: string; age?: string }> };
    };
    const out: RawRow[] = [];
    for (const r of j.web?.results ?? []) {
      if (!extractPostInfo(r.url)) continue;
      out.push({
        href: r.url,
        title: cleanTitle(r.title),
        snippet: r.description ?? "",
        published: providerAgeToIso(r.age),
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchPostQuery(
  query: string,
  budget: { queries: number },
  tavilyKey: string | null,
  braveKey: string | null,
  freshness: Freshness | null,
): Promise<{ rows: RawRow[]; ok: boolean; failures: string[] }> {
  if (budget.queries <= 0) return { rows: [], ok: true, failures: ["budget"] };
  const enc = encodeURIComponent(query);
  const df = freshness ? `&df=${freshness.df}` : "";

  if (tavilyKey) {
    budget.queries--;
    return {
      rows: await tavilyPosts(query, tavilyKey, freshness?.tavilyDays),
      ok: true,
      failures: [],
    };
  }
  if (braveKey) {
    budget.queries--;
    return {
      rows: await bravePosts(query, braveKey, freshness?.brave),
      ok: true,
      failures: [],
    };
  }

  const attempts: Array<() => Promise<FetchedPage>> = [
    () => fetchSerp(`https://html.duckduckgo.com/html/?q=${enc}&ia=web${df}`),
    () => fetchSerp(`https://lite.duckduckgo.com/lite/?q=${enc}`),
    () => fetchSerp(`https://html.duckduckgo.com/html/?q=${enc}&kl=br-pt${df}`),
  ];
  const failures: string[] = [];
  for (const attempt of attempts) {
    if (budget.queries <= 0) break;
    budget.queries--;
    const page = await attempt();
    if (page.blocked || page.status === 202) {
      failures.push(`ddg ${page.status}`);
      await sleep(2400 + Math.random() * 1400);
      continue;
    }
    if (!page.ok) {
      failures.push(`ddg status ${page.status}`);
      continue;
    }
    let rows = parseDdgHtmlPosts(page.html);
    if (rows.length === 0) rows = parseDdgLitePosts(page.html);
    if (rows.length > 0) return { rows, ok: true, failures };
    failures.push("ddg sem resultados");
  }

  if (budget.queries > 0) {
    budget.queries--;
    const page = await fetchSerp(
      `https://www.bing.com/search?q=${enc}&setlang=pt-br&count=20&mkt=pt-BR`,
    );
    if (page.ok && !page.blocked) {
      const rows = parseBingPosts(page.html);
      if (rows.length > 0) return { rows, ok: true, failures };
    }
    failures.push("bing falhou");
  }

  return { rows: [], ok: false, failures };
}

// ---- Frescor da publicação ----
type Freshness = { df: string; brave: string; tavilyDays: number };

function buildFreshness(recentDays: number): Freshness | null {
  if (!recentDays || recentDays <= 0) return null;
  const df = recentDays <= 7 ? "w" : recentDays <= 31 ? "m" : "y";
  const brave = recentDays <= 1 ? "fpd" : recentDays <= 7 ? "fpw" : recentDays <= 31 ? "fpm" : "fpq";
  const tavilyDays = Math.min(30, Math.max(7, recentDays));
  return { df, brave, tavilyDays };
}

/** Bruto "age" do Brave ("4d", "1w", "3 months ago"...)→ data ISO real (idade de rastreio, não data de publicação). */
function providerAgeToIso(age: string | undefined | null): string | null {
  if (!age) return null;
  const now = Date.now();
  const t = new Date(now);
  const m = age.match(
    /(\d+[.,]?\d*)\s*(minutes?|hrs?|hours?|h|days?|d|weeks?|w|months?|mon|years?|y)\b/i,
  );
  if (m) {
    const n = Number(m[1]);
    const u = (m[2] ?? "").toLowerCase();
    if (/^min/.test(u)) t.setMinutes(t.getMinutes() - n);
    else if (/^h/.test(u)) t.setHours(t.getHours() - n);
    else if (/^(d|days?)$/.test(u)) t.setDate(t.getDate() - n);
    else if (/^(w|weeks?)$/.test(u)) t.setDate(t.getDate() - n * 7);
    else if (/^(months?|mon|mos)$/.test(u)) t.setMonth(t.getMonth() - n);
    else t.setFullYear(t.getFullYear() - n);
    if (t.getTime() <= now + 36e5 && t.getTime() >= now - 4 * 365 * 864e5) return t.toISOString();
  }
  return null;
}

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MONTHS_PT_ABBR = [
  "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez",
];
const MONTHS_EN = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTHS_EN_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
];

function pluckMonth(name: string, table: string[], abbr: string[]): number | null {
  const n = name.toLowerCase().replace(/[.,]/g, "").slice(0, 4);
  const i = table.indexOf(name.toLowerCase()) >= 0 ? table.indexOf(name.toLowerCase()) : abbr.indexOf(n);
  return i >= 0 ? i : null;
}

function sameMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Extrai data de publicação de título/snippet (PT/EN + relativos + marcadores de comentário). */
function parsePostDate(title: string, snippet: string): string | null {
  const text = `${title} ${snippet}`.slice(0, 1400);
  const now = new Date();

  const validRecent = (d: Date | null | undefined): d is Date =>
    !!d && isFinite(+d) && d.getTime() <= now.getTime() + 36e5 && d.getTime() >= now.getTime() - 4 * 365 * 864e5;

  // 1) dd/mm/aaaa ou aaaa-mm-dd
  let m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (validRecent(d)) return d.toISOString();
  }
  m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (validRecent(d)) return d.toISOString();
  }

  // 2) "N de mês de AAAA" / "N de mês"
  m = text.match(/\b(\d{1,2})\s+de\s+([a-zç]+)\s+(?:de\s+)?(\d{4})?\b/i);
  if (m && m[1]) {
    const mi = pluckMonth(m[2] ?? "", MONTHS_PT, MONTHS_PT_ABBR);
    const day = Number(m[1]);
    const year = m[3] ? Number(m[3]) : now.getUTCFullYear();
    if (mi !== null && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, mi, day));
      if (validRecent(d)) return d.toISOString();
    }
  }

  // 3) Relativos em português (formato que o próprio Facebook usa para exibir tempos)
  const ptUnits: Array<[RegExp, number]> = [
    [/\b(?:há|faz)\s+(\d+)[.,]?(\d*)\s*(min(?:utos?)?|h|hora(?:s)?)\b/i, 0],
    [/\b(?:há|faz)\s+(\d+)(\.\d+)?\s+dias?\b/i, 1],
    [/\b(?:há|faz)\s+(\d+)(\.\d+)?\s+semanas?\b/i, 2],
    [/\b(?:há|faz)\s+(\d+)(\.\d+)?\s+(mes(?:es)?|mês)\b/i, 3],
    [/\b(?:há|faz)\s+(\d+)(\.\d+)?\s+anos?\b/i, 4],
    [/\b(?:há|faz)\s+(um|uma)\s+(minuto|hora|dia|semana|mês|meses|ano)\b/i, 5],
    [/\bontem\b/i, 6],
    [/\bhoje\b/i, 7],
  ];
  for (const [re, kind] of ptUnits) {
    const mm = text.match(re);
    if (!mm) continue;
    const t = new Date(now.getTime());
    if (kind === 0) t.setMinutes(t.getMinutes() - (Number(mm[1]) + Number(parseFloat(mm[2] ?? "0") || 0) / 10));
    else if (kind === 1) t.setDate(t.getDate() - Number(mm[1]));
    else if (kind === 2) t.setDate(t.getDate() - Number(mm[1]) * 7);
    else if (kind === 3) t.setMonth(t.getMonth() - Number(mm[1]));
    else if (kind === 4) t.setFullYear(t.getFullYear() - Number(mm[1]));
    else if (kind === 5) {
      const u = mm[2] ?? "";
      if (/minuto/.test(u)) t.setMinutes(t.getMinutes() - 1);
      else if (/hora/.test(u)) t.setHours(t.getHours() - 1);
      else if (/dia/.test(u)) t.setDate(t.getDate() - 1);
      else if (/semana/.test(u)) t.setDate(t.getDate() - 7);
      else if (/mês|meses/.test(u)) t.setMonth(t.getMonth() - 1);
      else t.setFullYear(t.getFullYear() - 1);
    } else if (kind === 6) t.setDate(t.getDate() - 1);
    if (validRecent(t)) return t.toISOString();
  }

  // 5) Relativos em inglês
  const enUnits: Array<[RegExp, number]> = [
    [/\b(\d+)\s+(minutes?|hours?)\s+ago\b/i, 0],
    [/\b(\d+[.,]?\d*)\s+(days?)\s+ago\b/i, 1],
    [/\b(\d+[.,]?\d*)\s+(weeks?)\s+ago\b/i, 2],
    [/\b(\d+[.,]?\d*)\s+(months?)\s+ago\b/i, 3],
    [/\b(\d+[.,]?\d*)\s+(years?)\s+ago\b/i, 4],
    [/\b(a\s+minute|an?\s+hour|a\s+day|a\s+week|a\s+month|a\s+year)\s+ago\b/i, 5],
    [/\byesterday\b/i, 6],
  ];
  for (const [re, kind] of enUnits) {
    const mm = text.match(re);
    if (!mm) continue;
    const t = new Date(now.getTime());
    if (kind === 0) t.setMinutes(t.getMinutes() - Number(mm[1]));
    else if (kind === 1) t.setDate(t.getDate() - Number(mm[1]));
    else if (kind === 2) t.setDate(t.getDate() - Number(mm[1]) * 7);
    else if (kind === 3) t.setMonth(t.getMonth() - Number(mm[1]));
    else if (kind === 4) t.setFullYear(t.getFullYear() - Number(mm[1]));
    else if (kind === 5) {
      const en = mm[1] ?? "";
      if (/minute/.test(en)) t.setMinutes(t.getMinutes() - 1);
      else if (/hour/.test(en)) t.setHours(t.getHours() - 1);
      else if (/day/.test(en)) t.setDate(t.getDate() - 1);
      else if (/week/.test(en)) t.setDate(t.getDate() - 7);
      else if (/month/.test(en)) t.setMonth(t.getMonth() - 1);
      else t.setFullYear(t.getFullYear() - 1);
    } else if (kind === 6) t.setDate(t.getDate() - 1);
    if (validRecent(t)) return t.toISOString();
  }

  return null;
}

/** Busca artigo:published_time/meta na página do post (best effort, curtíssimo). */
async function fetchPostDateMeta(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 200) return null;
    const caps: Array<[RegExp, number]> = [
      [/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i, 1],
      [/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i, 1],
      [/"created_time"\s*:\s*"([^"]+)"/, 1],
      [/<time[^>]+datetime=["']([^"']+)["']/i, 1],
    ];
    for (const [re, g] of caps) {
      const mm = html.match(re);
      if (!mm) continue;
      const ts = Date.parse(mm[g] ?? "");
      if (isFinite(ts)) {
        const d = new Date(ts);
        if (d.getTime() <= Date.now() + 36e5 && d.getTime() >= Date.now() - 4 * 365 * 864e5) {
          return d.toISOString();
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Construção da publicação candidata ----
type Candidate = {
  post_url: string;
  post_id: string;
  grupo_url: string;
  grupo_nome: string | null;
  trecho: string;
  nicho: string;
  termos_relacionados: string[];
  tipo_intencao: OportunidadeTipo;
  score: number;
  justificativa: string | null;
  fonte: string;
  titulo: string;
  data_publicacao: string | null;
  publicacao_confirmada: boolean;
  key: string;
};

function buildCandidate(
  row: RawRow,
  context: {
    term: string;
    terms: string[];
    source: string;
    targeted?: { url: string; name: string | null };
  },
): Candidate | null {
  const ref = extractPostInfo(row.href);
  if (!ref) return null;
  const trecho = (row.snippet || `${row.title} ${row.snippet}`)?.trim()
    ? decodeEntitiesCustom(row.snippet)
    : decodeEntitiesCustom(row.title);
  const titleText = decodeEntitiesCustom(row.title);
  const text = `${titleText} ${trecho}`.trim();
  let result;
  try {
    result = classifyIntention(titleText, trecho, text.slice(-900));
  } catch {
    result = { tipo: "potencial" as OportunidadeTipo, score: 50, justificativa: "" };
  }
  const score = Math.min(100, result.score + (text.includes(context.term) ? 4 : 0));
  const grupoUrl = normalizePostUrl(ref);
  let data = parsePostDate(row.title, row.snippet);
  let confirmada = false;
  if (row.published) {
    data = row.published;
    confirmada = true;
  }
  return {
    post_url: grupoUrl,
    post_id: ref.postId,
    grupo_url: `https://www.facebook.com/groups/${ref.slug}`,
    grupo_nome: context.targeted?.name ?? null,
    trecho: trecho.slice(0, 600),
    nicho: context.term,
    termos_relacionados: context.terms,
    tipo_intencao: result.tipo,
    score,
    justificativa: result.justificativa || null,
    fonte: context.targeted ? `${context.source}/grupos-salvos` : context.source,
    titulo: titleText.slice(0, 200),
    data_publicacao: data,
    publicacao_confirmada: confirmada,
    key: postDedupeKey(ref),
  };
}

// ============================================================
// Server Function
// ============================================================

export type OportunidadeInput = {
  q: string;
  terms: string[];
  token: string;
  groups: Array<{ url: string; name?: string }>;
  recentDays?: number;
};

export const oportunidadesSearch = createServerFn({ method: "POST" })
  .validator((d: OportunidadeInput) => d)
  .handler(async ({ data }) => {
    const t0 = Date.now();
    let userId: string | null;
    try {
      userId = await verifyUser(data.token);
    } catch (err) {
      console.error("[oportunidades] verifyUser:", err);
      return {
        success: false,
        error: "Erro de configuração do servidor. Tente novamente em instantes.",
      };
    }
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };

    const rawTerms = [
      ...new Set(
        [data.q, ...(data.terms ?? [])].map((t) => String(t ?? "").trim()).filter(Boolean),
      ),
    ];
    if (rawTerms.length === 0) {
      return { success: false, error: "Informe um nicho ou pelo menos um termo." };
    }
    const terms = expandTerms(rawTerms);
    const tavilyKey = (process.env["TAVILY_API_KEY"] as string | undefined) || null;
    const braveKey = (process.env["BRAVE_API_KEY"] as string | undefined) || null;
    const sourceName = tavilyKey ? "tavily" : braveKey ? "brave" : "duckduckgo";
    const freshness = buildFreshness(data.recentDays ?? 0);
    const recentCutoff = freshness ? Date.now() - data.recentDays! * 864e5 : 0;

    const budget = { queries: MAX_QUERIES };
    const wallDeadline = t0 + WALL_BUDGET_MS;

    const targeted = (data.groups ?? [])
      .map((g) => ({
        pre: g.url,
        slug:
          g.url.match(/facebook\.com\/groups\/([^/?#&]+)/i)?.[1]?.replace(/[^a-zA-Z0-9_-]/g, "") ??
          "",
        url: g.url,
        name: (g.name ?? "").trim() || null,
      }))
      .filter((g) => g.slug.length > 0)
      .slice(0, MAX_TARGET_GROUPS);

    // Consultas: dentro dos grupos salvos (alvo certo) ou em todo o Facebook.
    // Janela rotativa de intenções + shuffle por busca → resultados novos.
    const runSeed = Math.floor(Date.now() / 1000) * 4801 + terms.length * 7;
    const tasks: Array<{
      q: string;
      term: string;
      targeted?: { url: string; name: string | null };
    }> = [];
    if (targeted.length > 0) {
      const tTerms = terms.slice(0, MAX_TARGET_TERMS);
      for (const term of tTerms) {
        for (let gi = 0; gi < targeted.length; gi++) {
          const g = targeted[gi]!;
          const intent = INTENT_PHRASES[(gi + tTerms.indexOf(term) + runSeed) % INTENT_PHRASES.length];
          tasks.push({
            q: `site:facebook.com/groups/${g.slug} "${intent}" "${term}"`,
            term,
            targeted: { url: g.url, name: g.name },
          });
        }
      }
    } else {
      const tTerms = terms.slice(0, MAX_GENERIC_TERMS);
      const intents = rotateWindow(INTENT_PHRASES, MAX_GENERIC_INTENTS, runSeed);
      for (const term of tTerms) {
        for (const intent of intents) {
          tasks.push({ q: `site:facebook.com/groups "${intent}" "${term}"`, term });
        }
      }
    }
    seededShuffle(tasks, runSeed);
    if (tasks.length === 0) {
      return { success: false, error: "Não há o que buscar. Escolha um nicho ou grupos salvos." };
    }

    const discovered = new Map<string, Candidate>();
    const sourceFailures: string[] = [];
    let sourcesOk = 0;
    let budgetHit = false;

    async function runTask(task: (typeof tasks)[number]) {
      if (budget.queries <= 0 || Date.now() > wallDeadline) return;
      const { rows, ok, failures } = await searchPostQuery(task.q, budget, tavilyKey, braveKey, freshness);
      if (ok && rows.length > 0) sourcesOk++;
      else if (failures.length) sourceFailures.push(...failures);
      for (const r of rows) {
        const cand = buildCandidate(r, {
          term: task.term,
          terms,
          source: sourceName,
          ...(task.targeted
            ? { targeted: { url: task.targeted.url, name: task.targeted.name ?? null } }
            : {}),
        });
        if (!cand) continue;
        const cur = discovered.get(cand.key);
        if (!cur) {
          discovered.set(cand.key, cand);
        } else if (cand.score > cur.score) {
          // Mantém a versão mais bem classificada da mesma publicação.
          discovered.set(cand.key, { ...cur, ...cand, key: cur.key });
        }
      }
    }

    if (tavilyKey) {
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
        if (budget.queries > 0 && !braveKey) await sleep(DELAY_BETWEEN_QUERIES_MS);
      }
    }

    const all = [...discovered.values()];
    // Separa vendedores (ficam só como metadados da busca, não são salvos).
    let oportunidades = all
      .filter((c) => c.tipo_intencao !== "anuncio_vendedor")
      .sort((a, b) => b.score - a.score);
    const anuncios = all.filter((c) => c.tipo_intencao === "anuncio_vendedor");

    // Data de publicação: confirma (via página do post) só os melhores quando sobram subrequests.
    if (oportunidades.length > 0 && budget.queries >= 12) {
      const top = oportunidades.slice(0, 6);
      await Promise.all(
        top.map(async (o) => {
          const meta = await fetchPostDateMeta(o.post_url);
          if (meta) {
            o.data_publicacao = meta;
            o.publicacao_confirmada = true;
          }
        }),
      );
      // Reordena com base na data confirmada por página (heurística segue como tiebreak).
      if (top.some((o) => o.publicacao_confirmada)) {
        oportunidades = oportunidades.sort((a, b) => {
          const da = a.publicacao_confirmada ? Date.parse(a.data_publicacao ?? "") : 0;
          const db = b.publicacao_confirmada ? Date.parse(b.data_publicacao ?? "") : 0;
          return db - da;
        });
      }
    }

    let antigasIgnoradas = 0;
    if (freshness) {
      const antes = oportunidades.length;
      // Só filtra datas REAIS (confirmadas por provedor/página); estimativas não descartadas.
      oportunidades = oportunidades.filter((o) => {
        if (!o.publicacao_confirmada || !o.data_publicacao) return true;
        return Date.parse(o.data_publicacao) >= recentCutoff;
      });
      antigasIgnoradas = antes - oportunidades.length;
      // Desempate final: mais recentes primeiro.
      oportunidades = oportunidades.sort((a, b) => {
        const da = a.data_publicacao ? Date.parse(a.data_publicacao) : 0;
        const db = b.data_publicacao ? Date.parse(b.data_publicacao) : 0;
        return db - da || b.score - a.score;
      });
    }

    // Persistência (owner) — via service role.
    let inserted = 0;
    type PersistedCandidate = Candidate & { status: string };
    let rows: PersistedCandidate[] = [];
    try {
      if (oportunidades.length > 0) {
        const admin = await getAdmin();
        const toSave = oportunidades.slice(0, MAX_PERSISTED);
        // 1) Consulta das URLs já vistas (para dedupe e status atual).
        const { data: existing } = await admin
          .from("radar_oportunidades")
          .select("id, post_url, status")
          .eq("user_id", userId)
          .in(
            "post_url",
            toSave.map((o) => o.post_url),
          );
        const existMap = new Map<string, { id: string; status: string }>(
          (existing ?? []).map((r) => [r.post_url, { id: r.id, status: r.status }]),
        );
        const novelos = toSave.filter((o) => !existMap.has(o.post_url));
        // 2) Insere apenas as novas.
        for (let i = 0; i < novelos.length; i += 30) {
          const chunk = novelos.slice(i, i + 30);
          const { error: insErr } = await admin.from("radar_oportunidades").upsert(
            chunk.map((o) => ({
              user_id: userId,
              post_url: o.post_url,
              post_id: o.post_id,
              grupo_url: o.grupo_url,
              grupo_nome: o.grupo_nome,
              trecho: o.trecho,
              nicho: o.nicho,
              termos_relacionados: o.termos_relacionados,
              tipo_intencao: o.tipo_intencao,
              score: o.score,
              justificativa: o.justificativa,
              fonte: o.fonte,
              data_publicacao: o.data_publicacao,
              verificado: o.publicacao_confirmada,
              ultima_verificacao: new Date().toISOString(),
            })),
            { onConflict: "user_id,post_url", ignoreDuplicates: true },
          );
          if (insErr) console.error("[oportunidades] insert chunk:", insErr.message);
        }
        inserted = novelos.length;
        // 2b) Já conhecidas: reforça metadados quando confirmados na página do post.
        const refreshables = toSave.filter(
          (o) => o.publicacao_confirmada && existMap.has(o.post_url),
        );
        if (refreshables.length > 0) {
          const { error: updErr } = await admin
            .from("radar_oportunidades")
            .update({ verificado: true, ultima_verificacao: new Date().toISOString() })
            .eq("user_id", userId)
            .in(
              "post_url",
              refreshables.map((o) => o.post_url),
            );
          if (updErr) console.error("[oportunidades] refresh metadados:", updErr.message);
        }
        // 3) Recarrega com status (uma única query).
        const { data: saved } = await admin
          .from("radar_oportunidades")
          .select("*")
          .eq("user_id", userId)
          .in(
            "post_url",
            toSave.map((o) => o.post_url),
          );
        const statusMap = new Map<string, string>(
          (saved ?? []).map((r) => [r.post_url, r.status ?? "nova"]),
        );
        rows = toSave.map((o) => ({ ...o, status: statusMap.get(o.post_url) ?? "nova" }));
      }
    } catch (err) {
      console.error("[oportunidades] persist:", err);
      return {
        success: false,
        error: "Não foi possível salvar as oportunidades encontradas. Tente novamente.",
      };
    }

    if (oportunidades.length > 0 && rows.length === 0) {
      console.error("[oportunidades] candidates but none persisted", {
        candidatos: oportunidades.length,
        source_failures: sourceFailures.slice(0, 8),
      });
      return {
        success: false,
        error: "As publicações foram encontradas, mas não foi possível salvá-las agora.",
      };
    }

    const porTipo: Record<string, number> = {};
    for (const o of oportunidades) {
      porTipo[o.tipo_intencao] = (porTipo[o.tipo_intencao] ?? 0) + 1;
    }

    return {
      success: true,
      total_encontradas: all.length,
      novas: inserted,
      total_salvas: rows.length,
      por_tipo: porTipo,
      anuncios_ignorados: anuncios.length,
      antigas_ignoradas: antigasIgnoradas,
      recent_mode: !!freshness,
      confirmadas: oportunidades.filter((o) => o.publicacao_confirmada).length,
      oportunidades: rows,
      sources_ok: sourcesOk,
      source_failures: [...new Set(sourceFailures)].slice(0, 8),
      budget_hit: budgetHit,
      target_mode: targeted.length > 0,
      elapsed_ms: Date.now() - t0,
      terms_used: terms,
    };
  });

export type OportunidadeWipeInput = { token: string };

// Zera a carteira de oportunidades do usuário para começar do zero.
export const oportunidadesWipe = createServerFn({ method: "POST" })
  .validator((d: OportunidadeWipeInput) => d)
  .handler(async ({ data }) => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    try {
      const admin = await getAdmin();
      const { data: mine } = await admin
        .from("radar_oportunidades")
        .select("id")
        .eq("user_id", userId);
      const count = (mine ?? []).length;
      await admin.from("radar_oportunidades").delete().eq("user_id", userId);
      return { success: true, deleted: count };
    } catch (err) {
      console.error("[oportunidades] wipe:", err);
      return {
        success: false,
        error: "Não foi possível limpar as oportunidades agora. Tente novamente em instantes.",
      };
    }
  });
