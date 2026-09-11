/* eslint-disable @typescript-eslint/no-explicit-any -- tabelas insta_radar_* ainda não tipadas no Database (supabase types); mesmo padrão de radar-engine.ts */
import { createServerFn } from "@tanstack/react-start";
import {
  cleanTitle,
  decodeEntities,
  getAdmin,
  seededShuffle,
  sleep,
  verifyUser,
} from "@/lib/radar-engine";
import {
  INSTA_DEFAULT_KEYWORDS,
  INSTA_GANCHOS,
  type InstaAlert,
  type InstaAudio,
  type InstaAudioPost,
  type InstaAudioSnapshot,
  type InstaAudioStatus,
  type InstaCategoria,
  type InstaCiclo,
  type InstaConfig,
  type InstaContent,
  type InstaDashboard,
  type InstaHistory,
  type InstaPlan,
  type InstaTrend,
} from "@/lib/instagram-radar";

// ============================================================
// Radar do Algoritmo — Instagram (mecanismo, roda no Worker)
// Descoberta = busca web pública (Tavily → Brave → DDG → Bing),
// pois o acesso direto à API do Instagram/Meta bloqueia o Worker.
// Nenhum número de views/engajamento é inventado: os sinais são
// extraídos de títulos/snippets reais; score/ciclo são ESTIMATIVA
// derivada desses sinais (rotulada no banco e na UI).
// ============================================================

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const QUERY_BUDGET = 8;
const WALL_BUDGET_MS = 35_000;
const DELAY_BETWEEN_QUERIES_MS = 900;
const MIN_RUN_INTERVAL_MS = 15 * 60 * 1000;
const TREND_CAP = 60;
const AUDIO_CAP = 25;

type Observation = {
  title: string;
  snippet: string;
  url: string | null;
  provider: string;
  published: string | null;
};

type Signals = {
  viral: number;
  growth: number;
  saturation: number;
  engagement: number;
  novelty: number;
  recency: number;
};

function countWords(text: string, words: string[]): number {
  return words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
}

function analyzeSignals(obs: Observation, compat: number): Signals {
  const t = ` ${obs.title} ${obs.snippet} `.toLowerCase();
  const viral = countWords(t, [
    "viral",
    "explodiu",
    "bombando",
    "trending",
    "viralizou",
    "bombar",
    "febre",
    "boom",
    "explosão",
  ]);
  const growth =
    countWords(t, [
      "crescendo",
      "aumentando",
      "subindo",
      "em alta",
      "ganhando",
      "momento",
      "janela",
      "alta",
    ]) * 2;
  const declinio =
    countWords(t, ["perdendo", "caindo", "caiu", "não tá mais", "morrer", "esfriando", "acabou"]) *
    2;
  const saturation =
    countWords(t, [
      "saturado",
      "saturada",
      "repetido",
      "demais",
      "massacrado",
      "todo mundo posta",
      "esgotado",
    ]) * 3;
  const engagement = countWords(t, [
    "engajamento",
    "comentários",
    "compartilhamentos",
    "salvamentos",
    "curtidas",
    "alcance",
  ]);
  const novelty =
    countWords(t, [
      "novo",
      "nova",
      "surgindo",
      "começando",
      "primeiras",
      "citado",
      "recém",
      "estreia",
      "nova trend",
    ]) * 2;
  let recency = 1;
  if (obs.published) {
    const days = (Date.now() - new Date(obs.published).getTime()) / 86_400_000;
    if (days <= 2) recency = 3;
    else if (days <= 7) recency = 2;
    else if (days <= 30) recency = 1;
  }
  return {
    viral,
    growth: growth - declinio,
    saturation,
    engagement,
    novelty,
    recency: recency * (compat >= 50 ? 1 : 1), // recência pesa igual; compat entra via score
  };
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function deriveCiclo(s: Signals, compat: number, texto: string): InstaCiclo {
  const t = texto.toLowerCase();
  if (s.saturation >= 6 || /saturad|esgotado|perdendo força|todo mundo já postou/.test(t))
    return "saturando";
  if (s.growth < 0 || /caiu|perdendo|morreu|esfriando/.test(t)) return "caindo";
  if (s.viral >= 3 && s.growth >= 8 && s.recency >= 2) return "auge";
  if (s.novelty >= 4 && s.recency >= 2) return "surgindo";
  if (s.viral >= 1 || s.growth >= 4) return "crescendo";
  if (compat >= 60) return "crescendo";
  return "surgindo";
}

function deriveCategoria(texto: string, ciclo: InstaCiclo): InstaCategoria {
  const t = texto.toLowerCase();
  if (ciclo === "saturando" || ciclo === "caindo") return "saturada";
  if (countWords(t, ["áudio", "som", "música", "musica", "áudios"]) > 0) return "audio";
  if (t.includes("carrossel")) return "formato";
  if (t.includes("stories")) return "formato";
  if (t.includes("colab")) return "formato";
  if (t.includes("reels")) return "reels";
  if (countWords(t, ["gancho", "hook", "abertura"]) > 0) return "gancho";
  if (countWords(t, ["viral", "explodiu", "bombando"]) > 0) return "viral";
  if (
    countWords(t, [
      "vender",
      "vendas",
      "clientes",
      "faturamento",
      "comprar",
      "promoção",
      "converter",
    ]) > 0
  )
    return "vendas";
  return "tema";
}

function inferFormat(texto: string, categoria: InstaCategoria): string | null {
  const t = texto.toLowerCase();
  if (t.includes("carrossel")) return "Carrossel";
  if (t.includes("stories")) return "Stories";
  if (t.includes("colab")) return "Colab";
  if (categoria === "audio" || t.includes("áudio")) return "Reels (áudio)";
  if (t.includes("reels") || categoria === "reels") return "Reels";
  if (t.includes("troca de foto")) return "Feed + Reels";
  return null;
}

function computeCompat(titulo: string, snippet: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const hay = ` ${titulo.toLowerCase()} ${snippet.toLowerCase()} `;
  const hits = keywords.filter((k) => k && hay.includes(k.toLowerCase()));
  return Math.min(100, Math.round((hits.length / keywords.length) * 100));
}

function shortenNome(titulo: string, max = 64): string {
  const t = titutoLimpo(titulo);
  return t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, "")}…` : t;
}

function titutoLimpo(titulo: string): string {
  return cleanTitle(titulo)
    .replace(/\s*\|.*$/i, "")
    .trim();
}

function buildMotivo(
  titulo: string,
  s: Signals,
  compat: number,
  fonte: string,
  published: string | null,
): string {
  const parts: string[] = [];
  parts.push(
    `Sinais: viral ${s.viral}, crescimento ${s.growth}, engajamento ${s.engagement}, novidade ${s.novelty}, saturação ${s.saturation}.`,
  );
  parts.push(`Compat com nicho: ${compat}%.`);
  if (published) parts.push(`Publicado: ${new Date(published).toLocaleDateString("pt-BR")}.`);
  parts.push(`Origem ${fonte} (busca pública).`);
  return parts.join(" ");
}

function deriveAdaptacao(
  nome: string,
  ciclo: InstaCiclo,
  compat: number,
  keywords: string[],
): string {
  const tema = keywords.slice(0, 2).join(" + ") || "seu nicho";
  if (ciclo === "saturando" || ciclo === "caindo")
    return `Adapte ${nome} ao ${tema}: dê um ângulo próprio para não soar como cópia da trend saturada.`;
  return `Aproveite ${nome} aplicado ao ${tema} com bônus exclusivo — publicado em momento de alta costuma render mais.`;
}

// ============================================================
// Providers — buscas públicas genéricas (sem restrição de domínio)
// ============================================================

async function fetchInstaHtml(
  url: string,
): Promise<{ ok: boolean; status: number; html: string; blocked: boolean }> {
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

async function instaTavily(q: string, key: string): Promise<Observation[]> {
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
        max_results: 12,
      }),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as {
      results?: Array<{ url: string; title?: string; content?: string; published_date?: string }>;
    };
    const out: Observation[] = [];
    for (const r of j.results ?? []) {
      const title = titutoLimpo(r.title ?? "");
      if (!title) continue;
      let published: string | null = null;
      if (r.published_date) {
        const d = new Date(r.published_date);
        if (!isNaN(d.getTime())) published = d.toISOString();
      }
      out.push({
        title,
        snippet: (r.content ?? "").slice(0, 900),
        url: r.url,
        provider: "tavily",
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

async function instaBrave(q: string, key: string): Promise<Observation[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=15&country=br`,
      {
        signal: controller.signal,
        headers: { "X-Subscription-Token": key, Accept: "application/json" },
      },
    );
    if (!res.ok) return [];
    const j = (await res.json()) as {
      web?: { results?: Array<{ url: string; title: string; description?: string; age?: string }> };
    };
    const out: Observation[] = [];
    for (const r of j.web?.results ?? []) {
      const title = titutoLimpo(r.title);
      if (!title) continue;
      let published: string | null = null;
      const age = (r.age ?? "").match(/(\d+)\s*(minute|hour|day|week|month)/i);
      if (age) {
        const unit = (age[2] ?? "").toLowerCase();
        const n = parseInt(age[1] ?? "1", 10);
        const ms = unit.startsWith("minute")
          ? n * 60_000
          : unit.startsWith("hour")
            ? n * 3_600_000
            : unit.startsWith("day")
              ? n * 86_400_000
              : unit.startsWith("week")
                ? n * 604_800_000
                : n * 2_592_000_000;
        published = new Date(Date.now() - ms).toISOString();
      }
      out.push({
        title,
        snippet: (r.description ?? "").slice(0, 900),
        url: r.url,
        provider: "brave",
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

function parseDdgInsta(html: string): Observation[] {
  const out: Observation[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<div class="?result"?>/i).slice(1);
  for (const b of blocks.slice(0, 30)) {
    const a = b.match(/<a[^>]+class="?result__a"?[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/i);
    const snip =
      b.match(/<a[^>]+class="?result__snippet"?[^>]*>(.*?)<\/a>/i) ||
      b.match(/class="?result__snippet"?[^>]*>(.*?)<\/[^>]+>/i);
    if (!a) continue;
    const href = (a[1] ?? "").replace(/&amp;/g, "&");
    const m = href.match(/uddg=([^&]+)/);
    let url = href;
    if (m) {
      try {
        url = decodeURIComponent(m[1] ?? "");
      } catch {
        // mantém a URL bruta quando o redirect não é decodificável
      }
    }
    const title = titutoLimpo(a[2] ?? "");
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({
      title,
      snippet: snip ? titutoLimpo(snip[1] ?? "") : "",
      url: url && /^https?:\/\//.test(url) ? url : null,
      provider: "duckduckgo",
      published: null,
    });
    if (out.length >= 20) break;
  }
  return out;
}

function parseBingInsta(html: string): Observation[] {
  const out: Observation[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<li class="b_algo"/i).slice(1);
  for (const b of blocks.slice(0, 20)) {
    const a = b.match(/<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/i);
    const p = b.match(/<p[^>]*>(.*?)<\/p>/i);
    if (!a) continue;
    const title = decodeEntities(a[2] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({
      title: titutoLimpo(title),
      snippet: p
        ? decodeEntities(p[1] ?? "")
            .replace(/<[^>]+>/g, "")
            .slice(0, 900)
        : "",
      url: (a[1] ?? "").replace(/&amp;/g, ""),
      provider: "bing",
      published: null,
    });
    if (out.length >= 15) break;
  }
  return out;
}

async function searchInstaQuery(
  query: string,
  budget: { queries: number },
  tavilyKey: string | null,
  braveKey: string | null,
): Promise<{ rows: Observation[]; ok: boolean }> {
  const enc = encodeURIComponent(query);
  if (tavilyKey) {
    budget.queries--;
    const rows = await instaTavily(query, tavilyKey);
    return { rows, ok: rows.length > 0 };
  }
  if (braveKey) {
    budget.queries--;
    const rows = await instaBrave(query, braveKey);
    return { rows, ok: rows.length > 0 };
  }
  const attempts: Array<
    () => Promise<{ ok: boolean; status: number; html: string; blocked: boolean }>
  > = [
    () => fetchInstaHtml(`https://html.duckduckgo.com/html/?q=${enc}&ia=web`),
    () => fetchInstaHtml(`https://html.duckduckgo.com/html/?q=${enc}&kl=br-pt`),
  ];
  for (const attempt of attempts) {
    if (budget.queries <= 0) break;
    budget.queries--;
    const page = await attempt();
    if (page.blocked || page.status === 202) {
      await sleep(1000 + Math.random() * 900);
      continue;
    }
    if (!page.ok) continue;
    const rows = parseDdgInsta(page.html);
    if (rows.length > 0) return { rows, ok: true };
    break;
  }
  if (budget.queries > 0) {
    budget.queries--;
    const page = await fetchInstaHtml(
      `https://www.bing.com/search?q=${enc}&setlang=pt-br&count=15&mkt=pt-BR`,
    );
    if (page.ok && !page.blocked) {
      const rows = parseBingInsta(page.html);
      if (rows.length > 0) return { rows, ok: true };
    }
  }
  return { rows: [], ok: false };
}

// ============================================================
// Construção de queries a partir do nicho
// ============================================================

function buildQueries(keywords: string[]): string[] {
  const base = [
    "trends instagram esta semana",
    "tendências reels esta semana",
    "trend viral no instagram",
    "áudio em alta no reels agora",
    "áudios que estão bombando no instagram",
    "reels de sucesso com áudio novo",
    "carrossel que mais engaja no instagram",
    "formatos que mais engajam no instagram",
    "ganchos para vídeos no instagram",
    "trend saturada no instagram",
    "conteúdo que virou viral desta semana instagram",
  ];
  const kw = keywords
    .slice(0, 4)
    .flatMap((k) => [
      `${k} trend instagram esta semana`,
      `${k} reels viral`,
      `${k} áudio em alta`,
      `${k} engajamento instagram`,
    ]);
  return [...base, ...kw].slice(0, QUERY_BUDGET);
}

// ============================================================
// Persistência (service role)
// ============================================================

async function loadConfig(userId: string): Promise<InstaConfig> {
  const admin: any = await getAdmin();
  const { data } = await admin
    .from("insta_radar_config")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) {
    return {
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      disabled: !!data.disabled,
      status: data.status ?? "aguardando",
      last_error: data.last_error ?? null,
      last_run_at: data.last_run_at ?? null,
      next_run_at: data.next_run_at ?? null,
      alert_count: data.alert_count ?? 0,
      auto_update: data.auto_update ?? true,
    };
  }
  return {
    keywords: [...INSTA_DEFAULT_KEYWORDS],
    disabled: false,
    status: "aguardando",
    last_error: null,
    last_run_at: null,
    next_run_at: null,
    alert_count: 0,
    auto_update: true,
  };
}

function toTrendRow(t: InstaTrend): Record<string, unknown> {
  return {
    nome: t.nome,
    categoria: t.categoria,
    ciclo: t.ciclo,
    score: t.score,
    compat: t.compat,
    crescimento: t.crescimento,
    motivo: t.motivo,
    adaptacao: t.adaptacao,
    formato: t.formato,
    fonte: t.fonte,
    fonte_detalhe: t.fonte_detalhe,
    url: t.url,
    coletado_em: t.coletado_em,
  };
}

function toAudioRow(a: InstaAudio): Record<string, unknown> {
  return {
    nome: a.nome,
    artista: a.artista,
    usos: a.usos,
    crescimento: a.crescimento,
    motivo: a.motivo,
    ciclo: a.ciclo,
    score: a.score,
    compat: a.compat,
    fonte: a.fonte,
    fonte_detalhe: a.fonte_detalhe,
    url: a.url,
    coletado_em: a.coletado_em,
    preview_url: a.preview_url ?? null,
    artwork_url: a.artwork_url ?? null,
    itunes_url: a.itunes_url ?? null,
    track_url: a.track_url ?? null,
    track_name: a.track_name ?? null,
    artist_name: a.artist_name ?? null,
    album: a.album ?? null,
    provider_id: a.provider_id ?? null,
    enrich_attempted_at: a.enrich_attempted_at ?? null,
    provider: a.provider ?? null,
    trend_status: a.trend_status ?? null,
    rank: a.rank ?? null,
    previous_rank: a.previous_rank ?? null,
    rank_change: a.rank_change ?? null,
    score_delta: a.score_delta ?? null,
    growth_rate: a.growth_rate ?? null,
    first_seen_at: a.first_seen_at ?? null,
    last_seen_at: a.last_seen_at ?? null,
    seen_count: a.seen_count ?? null,
  };
}

// ============================================================
// Prévia real da música (iTunes Search — preview oficial de 30s)
// Não inventa nada: busca a faixa por nome/artista extraídos dos
// sinais públicos e guarda o vínculo real p/ reproduzir no painel.
// ============================================================

type ItunesMatch = {
  trackName: string | null;
  artistName: string | null;
  album: string | null;
  previewUrl: string | null;
  artworkUrl: string | null;
  itunesUrl: string | null;
  providerId: string | null;
  provider: "itunes" | "deezer";
};

function normStr(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractQuotedTitle(raw: string): string | null {
  const m = String(raw ?? "").match(/["“”'`«]([^"“”'`»]{2,60})["”'`»]/);
  return m ? cleanAudioPart(m[1] ?? "") : null;
}

function searchTermVariants(nome: string, artista?: string | null): string[] {
  const raw = String(nome ?? "");
  const quoted = extractQuotedTitle(raw);
  const base = titutoLimpo(raw)
    .replace(/^(?:[\s:;,.\-–—"“”'‘`«»]+|🎵|🎶)+/, "")
    .replace(/(?:["“”'`«»]|🎵|🎶)+/g, " ");
  const firstClause =
    base.split(/(?:\s+(?:de|do|da|cantado por)\s+[A-ZÀ-Ú]|,|;|\||\(|-)/i)[0]?.trim() ?? "";
  const cleanArt = artista ? cleanAudioPart(artista) : null;
  const out: string[] = [];
  const push = (s: string | null) => {
    const c = (s ?? "").trim().replace(/\s+/g, " ");
    if (c.length >= 2 && c.length <= 100 && c.toLowerCase() !== "em alta") out.push(c);
  };
  if (quoted) {
    push(`${quoted}${cleanArt ? ` ${cleanArt}` : ""}`);
    push(quoted);
  }
  push(`${base}${cleanArt ? ` ${cleanArt}` : ""}`);
  push(base);
  push(firstClause);
  if (cleanArt && cleanArt.length >= 3) push(cleanArt);
  return Array.from(new Set(out));
}

const ITUNES_TIMEOUT_MS = 7000;

async function itunesSearch(query: string): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ITUNES_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=8&country=br`,
      { headers: { Accept: "application/json" }, signal: ctrl.signal },
    );
    if (!res.ok) return [];
    const json: any = await res.json();
    return Array.isArray(json?.results) ? json.results : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toItunesMatch(pick: any): ItunesMatch {
  return {
    trackName: String(pick?.trackName ?? "").trim() || null,
    artistName: String(pick?.artistName ?? "").trim() || null,
    album: String(pick?.collectionName ?? "").trim() || null,
    previewUrl: pick?.previewUrl ? String(pick.previewUrl) : null,
    artworkUrl: pick?.artworkUrl100
      ? String(pick.artworkUrl100).replace("100x100bb", "300x300bb")
      : null,
    itunesUrl: pick?.trackViewUrl ? String(pick.trackViewUrl) : null,
    providerId: pick?.trackId != null ? String(pick.trackId) : null,
    provider: "itunes",
  };
}

async function deezerSearch(query: string): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ITUNES_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=8`,
      { headers: { Accept: "application/json" }, signal: ctrl.signal },
    );
    if (!res.ok) return [];
    const json: any = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function toDeezerMatch(pick: any): ItunesMatch {
  return {
    trackName: String(pick?.title ?? "").trim() || null,
    artistName: String(pick?.artist?.name ?? "").trim() || null,
    album: String(pick?.album?.title ?? "").trim() || null,
    previewUrl: pick?.preview ? String(pick.preview) : null,
    artworkUrl: pick?.album?.cover_xl
      ? String(pick.album.cover_xl)
      : pick?.album?.cover_medium
        ? String(pick.album.cover_medium)
        : null,
    itunesUrl: pick?.link ? String(pick.link) : null,
    providerId: pick?.id != null ? String(pick.id) : null,
    provider: "deezer",
  };
}

// ============================================================
// Paradas oficiais de música em alta — fonte REAL de áudios.
// O Instagram/Meta bloqueia acesso a "áudios em alta" do app;
// a única fonte confiável e honesta é a parada oficial de música
// (iTunes/Apple Music Brasil, fallback Deezer), que tem a faixa,
// o artista e a prévia oficial de 30s. Nada é inventado.
// ============================================================

type ChartEntry = {
  pos: number;
  trackName: string;
  artistName: string;
  album: string | null;
  artworkUrl: string | null;
  trackViewUrl: string | null;
  previewUrl: string | null;
  providerId: string | null;
};

const CHART_LIMIT = 25;

async function fetchItunesTopSongs(country = "br"): Promise<ChartEntry[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ITUNES_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://itunes.apple.com/${country}/rss/topsongs/limit=${CHART_LIMIT}/json`,
      { headers: { Accept: "application/json" }, signal: ctrl.signal },
    );
    if (!res.ok) return [];
    const json: any = await res.json();
    const entries: any[] = Array.isArray(json?.feed?.entry) ? json.feed.entry : [];
    if (entries.length === 0) return [];
    const ids = entries
      .map((e: any) => String(e?.id?.label ?? ""))
      .filter((s: string) => s.length > 0);
    const lookupMap = new Map<string, any>();
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      try {
        const lres = await fetch(
          `https://itunes.apple.com/lookup?id=${chunk.join(",")}&entity=song&limit=200`,
          { headers: { Accept: "application/json" }, signal: ctrl.signal },
        );
        if (lres.ok) {
          const lj: any = await lres.json();
          for (const r of Array.isArray(lj?.results) ? lj.results : []) {
            if (r?.trackId != null) lookupMap.set(String(r.trackId), r);
          }
        }
      } catch {
        // lookup é best-effort; sem preview o item só não tem prévia
      }
    }
    return entries
      .map((e: any, i: number): ChartEntry => {
        const trackId = String(e?.id?.label ?? "");
        const lu = lookupMap.get(trackId);
        const im: any[] = Array.isArray(e?.["im:image"]) ? e["im:image"] : [];
        const artwork = lu?.artworkUrl100
          ? String(lu.artworkUrl100).replace("100x100bb", "300x300bb")
          : (im?.[2]?.label ?? im?.[1]?.label ?? null);
        return {
          pos: i + 1,
          trackName:
            String(e?.["im:name"]?.label ?? lu?.trackName ?? "").trim() ||
            String(lu?.trackName ?? "").trim(),
          artistName:
            String(e?.["im:artist"]?.label ?? lu?.artistName ?? "").trim() ||
            String(lu?.artistName ?? "").trim(),
          album:
            String(e?.["im:collection"]?.["im:name"]?.label ?? lu?.collectionName ?? "").trim() ||
            null,
          artworkUrl: artwork ? String(artwork) : null,
          trackViewUrl:
            String(lu?.trackViewUrl ?? e?.link?.[0]?.attributes?.href ?? "").trim() || null,
          previewUrl: lu?.previewUrl ? String(lu.previewUrl) : null,
          providerId: trackId || null,
        };
      })
      .filter((e) => e.trackName.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDeezerChart(): Promise<ChartEntry[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ITUNES_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.deezer.com/chart/0/tracks?limit=${CHART_LIMIT}`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : [];
    return data
      .map((t: any, i: number): ChartEntry => ({
        pos: i + 1,
        trackName: String(t?.title ?? "").trim(),
        artistName: String(t?.artist?.name ?? "").trim(),
        album: String(t?.album?.title ?? "").trim() || null,
        artworkUrl: t?.album?.cover_xl
          ? String(t.album.cover_xl)
          : t?.album?.cover_medium
            ? String(t.album.cover_medium)
            : null,
        trackViewUrl: t?.link ? String(t.link) : null,
        previewUrl: t?.preview ? String(t.preview) : null,
        providerId: t?.id != null ? String(t.id) : null,
      }))
      .filter((e) => e.trackName.length > 0);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Monta os registros de áudio a partir da parada oficial (fonte real).
async function buildChartAudios(): Promise<{ audios: InstaAudio[]; used: boolean }> {
  let entries = await fetchItunesTopSongs();
  let source: "itunes" | "deezer" = "itunes";
  if (entries.length === 0) {
    entries = await fetchDeezerChart();
    source = "deezer";
  }
  if (entries.length === 0) return { audios: [], used: false };
  const now = new Date().toISOString();
  if (source === "itunes") {
    // Se faltou prévia, tenta resolver o artist+track no Deezer/Search no
    // browser depois; o campo fica null até lá (honesto).
  }
  const audios: InstaAudio[] = entries.map((e) => {
    const nome = `${e.artistName} - ${e.trackName}`;
    return {
      id: "",
      nome,
      artista: e.artistName || null,
      usos: null,
      crescimento: 0,
      ciclo: "surgindo",
      score: clampScore(Math.round(100 - (e.pos - 1) * 2.6)),
      compat: 0,
      motivo: `#${e.pos}º na parada oficial ${source === "itunes" ? "Apple Music Brasil" : "Deezer"} agora.`,
      fonte: "oficial",
      fonte_detalhe: `Chart oficial (${source === "itunes" ? "iTunes/Apple Music Brasil" : "Deezer"}). Posição ${e.pos}º em alta no momento — ${e.previewUrl ? "prévia oficial de 30s." : "sem prévia disponível na fonte."}`,
      url: null,
      coletado_em: now,
      preview_url: e.previewUrl,
      artwork_url: e.artworkUrl,
      itunes_url: e.trackViewUrl,
      track_url: e.trackViewUrl,
      track_name: e.trackName || null,
      artist_name: e.artistName || null,
      album: e.album ?? null,
      provider_id: e.providerId,
      provider: source,
      enrich_attempted_at: e.previewUrl ? now : null,
    };
  });
  return { audios, used: true };
}

async function pickDeezer(variants: string[], q: string): Promise<ItunesMatch | null> {
  const all: any[] = [];
  const seen = new Set<number>();
  for (const v of variants) {
    for (const r of await deezerSearch(v)) {
      if (r.id != null && seen.has(r.id)) continue;
      if (r.id != null) seen.add(r.id);
      all.push(r);
    }
  }
  if (all.length === 0) return null;
  const scored = all.map((r: any) => {
    let s = 0;
    const t = normStr(r.title);
    const a = normStr(r.artist?.name);
    if (t && q.includes(t)) s += 4;
    else if (t && t.includes(q)) s += 2;
    if (a && q.includes(a)) s += 2;
    if (r.preview) s += 2;
    if (r.position != null && r.position <= 3) s += 1;
    return { r, s };
  });
  scored.sort((x: any, y: any) => y.s - x.s);
  let best = scored[0]?.r;
  if (best && !best.preview) {
    const p = all.find((r) => r.preview);
    if (p) best = p;
  }
  if (!best?.preview) return null;
  return toDeezerMatch(best);
}

async function pickItunesPicker(variants: string[], q: string): Promise<ItunesMatch | null> {
  const all: any[] = [];
  const seen = new Set<number>();
  let i = 0;
  for (const v of variants) {
    const weight = 6 - i;
    for (const r of await itunesSearch(v)) {
      if (r.trackId != null && seen.has(r.trackId)) continue;
      if (r.trackId != null) seen.add(r.trackId);
      r.__instaWeight = weight;
      all.push(r);
    }
    i++;
  }
  if (all.length === 0) return null;
  const scored = all.map((r: any) => {
    let s = (r.__instaWeight ?? 0) * 10;
    const t = normStr(r.trackName);
    const a = normStr(r.artistName);
    if (t && q.includes(t)) s += 4;
    else if (t && t.includes(q)) s += 2;
    if (a && q.includes(a)) s += 2;
    if (r.previewUrl) s += 1.5;
    return { r, s };
  });
  scored.sort((x, y) => y.s - x.s || (x.r.previewUrl ? 1 : 0) - (y.r.previewUrl ? 1 : 0));
  let best = scored[0]?.r;
  if (best && !best.previewUrl) {
    const p = all.find((r) => r.previewUrl);
    if (p) best = p;
  }
  if (!best?.previewUrl) return null;
  return toItunesMatch(best);
}

// Cadeia de fallback: fonte 1 (iTunes/variantes) → fonte 2 (Deezer).
// Registra em log Qual fonte resolveu, sem inventar nada quando nenhuma vingar.
async function resolveAudioChain(
  nome: string,
  artista?: string | null,
): Promise<ItunesMatch | null> {
  const variants = searchTermVariants(nome, artista);
  if (variants.length === 0) return null;
  const qRef =
    extractQuotedTitle(nome) ??
    (searchTermVariants(nome, null)[0] || titutoLimpo(nome)).slice(0, 60);
  const q = normStr(qRef.replace(/\([^)]*\)/g, ""));
  try {
    const it = await pickItunesPicker(variants, q);
    if (it?.previewUrl) {
      console.log(
        `[insta-radar] audio-resolve OK: "${nome}"${artista ? ` / ${artista}` : ""} → itunes #${it.providerId} ${it.trackName} - ${it.artistName} (preview ${it.previewUrl ? "sim" : "não"})`,
      );
      return it;
    }
    const dz = await pickDeezer(variants, q);
    if (dz?.previewUrl) {
      console.log(
        `[insta-radar] audio-resolve OK (deezer): "${nome}"${artista ? ` / ${artista}` : ""} → deezer #${dz.providerId} ${dz.trackName} - ${dz.artistName}`,
      );
      return dz;
    }
    console.log(
      `[insta-radar] audio-resolve FALHOU: "${nome}"${artista ? ` / ${artista}` : ""} (nenhuma fonte com preview nas variantes ${JSON.stringify(variants)})`,
    );
    return it ?? null;
  } catch (err) {
    console.error(`[insta-radar] audio-resolve erro "${nome}":`, err);
    return null;
  }
}

async function resolveItunesAudio(
  nome: string,
  artista?: string | null,
): Promise<ItunesMatch | null> {
  return resolveAudioChain(nome, artista);
}

// Busca no navegador (ou worker): usa variantes + iTunes (CORS liberado) e Deezer.
export async function clientResolveAudio(
  nome: string,
  artista?: string | null,
): Promise<ItunesMatch | null> {
  return resolveAudioChain(nome, artista);
}

function applyMatch(a: InstaAudio, m: ItunesMatch): InstaAudio {
  a.preview_url = m.previewUrl;
  a.artwork_url = m.artworkUrl;
  a.itunes_url = m.itunesUrl;
  a.track_url = m.itunesUrl ?? a.itunes_url;
  a.track_name = m.trackName;
  a.artist_name = m.artistName;
  a.album = m.album;
  a.provider_id = m.providerId;
  a.provider = m.provider;
  if (m.artistName && !a.artista) a.artista = m.artistName;
  return a;
}

// ============================================================
// Análise principal
// ============================================================

type RunResult = {
  trends: InstaTrend[];
  audios: InstaAudio[];
  alerts: InstaAlert[];
  resumo: InstaHistory["resumo"];
  chart_used: boolean;
};

async function runAnalysis(
  userId: string,
  keywords: string[],
  tavilyKey: string | null,
  braveKey: string | null,
): Promise<RunResult> {
  const admin: any = await getAdmin();
  const t0 = Date.now();
  const queries = seededShuffle(buildQueries(keywords), t0);
  const budget = { queries: QUERY_BUDGET };
  const useFast = !!(tavilyKey || braveKey);
  const all: Observation[] = [];

  for (const q of queries) {
    if (Date.now() - t0 > WALL_BUDGET_MS || budget.queries <= 0) break;
    const { rows } = await searchInstaQuery(q, budget, tavilyKey, braveKey);
    all.push(...rows);
    if (!useFast) await sleep(DELAY_BETWEEN_QUERIES_MS);
  }

  // Nomes já conhecidos (para diferenciar "nova" de "já vista" e gerar alertas)
  const { data: prevTrends } = await admin
    .from("insta_radar_trends")
    .select("nome,ciclo")
    .eq("user_id", userId);
  const prevByName = new Map<string, InstaCiclo>(
    (prevTrends ?? []).map((r: any) => [String(r.nome).toLowerCase(), r.ciclo as InstaCiclo]),
  );
  const { data: prevAudios } = await admin
    .from("insta_radar_audios")
    .select("nome,score,usos,rank,seen_count,first_seen_at,rank_change")
    .eq("user_id", userId);
  const prevAudioSet = new Set<string>(
    (prevAudios ?? []).map((r: any) => String(r.nome).toLowerCase()),
  );
  const prevAudioRowMap = new Map<string, any>(
    (prevAudios ?? []).map((r: any) => [String(r.nome).toLowerCase(), r]),
  );
  // Snapshot anterior (ranking da última execução) para calcular variação.
  const { data: prevHistRes } = await admin
    .from("insta_radar_history")
    .select("resumo")
    .eq("user_id", userId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevSnapshotArr: InstaAudioSnapshot[] | undefined =
    (prevHistRes as any)?.resumo?.audios ?? undefined;
  const prevSnapshotMap = new Map<string, InstaAudioSnapshot & { idx: number }>();
  (prevSnapshotArr ?? []).forEach((s: any, i: number) =>
    prevSnapshotMap.set(String(s.key).toLowerCase(), { ...s, idx: i }),
  );

  const trendsByNome = new Map<string, InstaTrend>();
  const audiosByNome = new Map<string, InstaAudio>();
  const now = new Date().toISOString();

  for (const obs of all) {
    const texto = `${obs.title} ${obs.snippet}`;
    const audioHit =
      countWords(texto.toLowerCase(), [
        "áudio",
        "som",
        "música",
        "musica",
        "áudios",
        "trilha sonora",
        "trend de áudio",
      ]) > 0;
    const field = audioHit ? "audio" : "trend";

    if (field === "trend") {
      const nome = shortenNome(obs.title || obs.snippet);
      if (trendsByNome.has(nome)) continue;
      const compat = computeCompat(obs.title, obs.snippet, keywords);
      const s = analyzeSignals(obs, compat);
      const ciclo = deriveCiclo(s, compat, texto);
      const categoria = deriveCategoria(texto, ciclo);
      const score = clampScore(
        28 +
          s.viral * 4 +
          s.growth * 3 +
          s.engagement * 2 +
          s.novelty * 2.5 +
          s.recency * 12 -
          s.saturation * 4 +
          compat * 0.3,
      );
      const crescimento = clampScore(s.viral * 14 + Math.max(0, s.growth) * 7 + s.novelty * 5);
      const fonte = obs.url ? "observado" : "estimativa";
      const wasKnown = prevByName.has(nome.toLowerCase());
      trendsByNome.set(nome, {
        id: "",
        nome,
        categoria,
        ciclo,
        score,
        compat,
        crescimento,
        motivo: buildMotivo(obs.title, s, compat, obs.provider, obs.published),
        adaptacao: deriveAdaptacao(nome, ciclo, compat, keywords),
        formato: inferFormat(texto, categoria),
        fonte,
        fonte_detalhe: obs.url
          ? `Página observada (${obs.provider}). ${wasKnown ? "Já constava em radar anterior." : "Nova no radar."}`
          : "Sem URL confiável — estimativa a partir do trecho encontrado.",
        url: obs.url,
        coletado_em: obs.published ?? now,
      });
    } else {
      // Áudio
      const meta = extractAudioMeta(obs.title, obs.snippet);
      if (!meta) continue;
      const nome = meta.nome;
      const compat = computeCompat(obs.title, obs.snippet, keywords);
      const s = analyzeSignals(obs, compat);
      const ciclo = deriveCiclo(s, compat, texto);
      const score = clampScore(
        30 +
          s.viral * 4 +
          s.growth * 3 +
          s.novelty * 3 +
          s.recency * 12 -
          s.saturation * 4 +
          compat * 0.25,
      );
      const crescimento = clampScore(s.growth * 7 + s.novelty * 5 + s.viral * 10);
      const usos = parseAudioUsos(obs.snippet);
      const key = nome.toLowerCase();
      if (audiosByNome.has(key)) {
        const cur = audiosByNome.get(key)!;
        if (score > cur.score) {
          audiosByNome.set(key, {
            ...cur,
            score,
            crescimento,
            ciclo,
            usos: usos ?? cur.usos,
            fonte_detalhe: obs.url ? `Página observada (${obs.provider}).` : cur.fonte_detalhe,
          });
        }
        continue;
      }
      audiosByNome.set(key, {
        id: "",
        nome,
        artista: meta.artista,
        usos,
        crescimento,
        ciclo,
        score,
        compat,
        motivo: buildMotivo(obs.title, s, compat, obs.provider, obs.published),
        fonte: obs.url ? "observado" : "estimativa",
        fonte_detalhe: obs.url
          ? `Página observada (${obs.provider}). ${prevAudioSet.has(key) ? "Já constava anteriormente." : "Novo no radar de áudios."}`
          : "Sem URL confiável — estimativa.",
        url: obs.url,
        coletado_em: obs.published ?? now,
      });
    }
  }

  // Fonte real de áudios em alta: parada oficial de música (iTunes/Apple
  // Music Brasil, fallback Deezer). O Instagram/Meta não expõe "áudio em
  // alta" publicamente — charts são o dado honesto com faixa/artista/prévia.
  const chart = await buildChartAudios();
  const chartKeys = new Set<string>(chart.audios.map((a) => a.nome.toLowerCase()));
  for (const ca of chart.audios) {
    const key = ca.nome.toLowerCase();
    const existing = audiosByNome.get(key);
    if (existing && existing.preview_url && !ca.preview_url) {
      audiosByNome.set(key, { ...existing, score: Math.max(existing.score, ca.score) });
    } else if (existing && existing.score >= ca.score) {
      audiosByNome.set(key, { ...existing, score: existing.score });
    } else {
      audiosByNome.set(key, ca);
    }
  }

  // Converge áudios → tendência correspondente quando o nome não for só "áudio"
  // (itens da parada oficial NÃO viram tendências — só os observados na web).
  for (const a of audiosByNome.values()) {
    if (chartKeys.has(a.nome.toLowerCase())) continue;
    if (trendsByNome.has(a.nome)) continue;
    trendsByNome.set(a.nome, {
      id: "",
      nome: `🎵 ${a.nome}`,
      categoria: "audio",
      ciclo: a.ciclo,
      score: a.score,
      compat: a.compat,
      crescimento: a.crescimento,
      motivo: a.motivo,
      adaptacao: `Use o áudio ${a.nome}${a.artista ? ` (${a.artista})` : ""} num Reels do seu nicho nos próximos dias.`,
      formato: "Reels (áudio)",
      fonte: a.fonte,
      fonte_detalhe: a.fonte_detalhe,
      url: a.url,
      coletado_em: a.coletado_em,
    });
  }

  const trends = [...trendsByNome.values()]
    .sort((a, b) => b.score - a.score || b.compat - a.compat)
    .slice(0, TREND_CAP);
  const audios = [...audiosByNome.values()].sort((a, b) => b.score - a.score).slice(0, AUDIO_CAP);

  // Vínculo com a faixa real (iTunes/Deezer) nas mais quentes — best-effort,
  // limita subrequests e não trava a execução se der erro.
  await Promise.all(
    audios
      .slice(0, 15)
      .filter((a) => !a.preview_url)
      .map(async (a) => {
        try {
          const m = await resolveItunesAudio(a.nome, a.artista);
          if (m) applyMatch(a, m);
          a.enrich_attempted_at = new Date().toISOString();
        } catch {
          a.enrich_attempted_at = new Date().toISOString();
        }
      }),
  );

  // Ranqueamento (Trend Score) + histórico de posição a partir do snapshot anterior.
  const rankMap = new Map<string, number>();
  audios.forEach((a, i) => rankMap.set(a.nome.toLowerCase(), i + 1));
  for (const a of audios) {
    const key = a.nome.toLowerCase();
    const prevRow = prevAudioRowMap.get(key);
    const prevSnap = prevSnapshotMap.get(key);
    const rank = rankMap.get(key)!;
    const prevRank = prevSnap?.rank ?? null;
    a.rank = rank;
    a.previous_rank = prevRank ?? null;
    a.rank_change =
      prevRank != null && prevRank !== rank
        ? prevRank > rank
          ? rank - prevRank
          : rank - prevRank
        : null;
    a.score_delta = prevSnap?.score != null ? Math.round(a.score - prevSnap.score) : null;
    if (prevRow?.usos != null && a.usos != null && prevRow.usos > 0) {
      a.growth_rate = Math.round(((a.usos - prevRow.usos) / prevRow.usos) * 100);
    } else {
      a.growth_rate = null;
    }
    a.seen_count = prevRow?.seen_count != null ? Number(prevRow.seen_count) + 1 : 1;
    a.first_seen_at = prevRow?.first_seen_at ?? now;
    a.last_seen_at = now;
    a.trend_status = deriveAudioTrendStatus(a, prevRow);
    // Itens da parada oficial: ciclo/crescimento derivados da posição real.
    if (a.fonte === "oficial") {
      const change = a.rank_change ?? 0;
      if (change < 0) a.ciclo = a.score >= 80 ? "auge" : "crescendo";
      else if (change > 0 && a.previous_rank != null) a.ciclo = "caindo";
      else if (a.score >= 80) a.ciclo = "auge";
      else if (a.score >= 50) a.ciclo = "crescendo";
      else a.ciclo = "surgindo";
      a.crescimento = clampScore(
        Math.max(0, -change) * 8 + (a.score >= 80 ? 10 : 0) + (a.ciclo === "auge" ? 15 : 0),
      );
    }
  }

  // Alertas
  const alerts: InstaAlert[] = [];
  for (const t of trends) {
    const prev = prevByName.get(t.nome.toLowerCase());
    if (alerts.length >= 6) break;
    if (!prev) {
      if (t.categoria === "audio") {
        alerts.push(
          alertRow(
            "audio_alta",
            `🎵 Áudio em alta: ${t.nome.replace(/^🎵 /, "")}`,
            t.motivo ?? null,
          ),
        );
      } else if (t.score >= 70) {
        alerts.push(
          alertRow("nova_trend", `🆕 Nova tendência quente: ${t.nome}`, t.motivo ?? null),
        );
      } else if (t.score >= 50) {
        alerts.push(alertRow("nova_trend", `🆕 Nova tendência: ${t.nome}`, t.motivo ?? null));
      }
      if (t.compat >= 75 && alerts.length < 6) {
        alerts.push(
          alertRow(
            "nicho_alta",
            `🎯 Trend de alta compatibilidade: ${t.nome}`,
            `Compat ${t.compat}% com seu nicho.`,
          ),
        );
      }
    } else if (prev === "auge" && t.ciclo === "saturando") {
      alerts.push(
        alertRow(
          "saturacao",
          `⚠️ Saturação detectada: ${t.nome}`,
          "Estava no auge em radar anterior e agora mostra sinais de saturação.",
        ),
      );
    }
    if (alerts.length >= 6) break;
  }
  if (alerts.length < 6) {
    const topAudio = audios[0];
    if (topAudio && !prevAudioSet.has(topAudio.nome.toLowerCase()) && topAudio.score >= 60) {
      alerts.push(
        alertRow("audio_alta", `🎵 Áudio em alta: ${topAudio.nome}`, topAudio.motivo ?? null),
      );
    }
  }

  // Resumo do histórico
  const porCicloList = trends.reduce<Partial<Record<InstaCiclo, number>>>((acc, t) => {
    acc[t.ciclo] = (acc[t.ciclo] ?? 0) + 1;
    return acc;
  }, {});
  const resumo: InstaHistory["resumo"] = {
    total: trends.length,
    novo: trends.filter((t) => !prevByName.has(t.nome.toLowerCase())).length,
    audio_count: audios.length,
    alertas: alerts.length,
    por_ciclo: porCicloList,
    top: trends.slice(0, 5).map((t) => ({ nome: t.nome, score: t.score })),
    fonte: tavilyKey ? "tavily" : braveKey ? "brave" : "ddg/bing",
    duracao: Math.round((Date.now() - t0) / 1000),
    audios: audios.slice(0, 25).map((a) => ({
      key: a.nome.toLowerCase(),
      nome: a.nome,
      artista: a.artista ?? null,
      score: a.score,
      usos: a.usos ?? null,
      crescimento: a.crescimento,
      rank: a.rank ?? 0,
    })),
  };

  return { trends, audios, alerts, resumo, chart_used: chart.used };
}

function alertRow(tipo: InstaAlert["tipo"], titulo: string, descricao: string | null): InstaAlert {
  return { id: "", tipo, titulo, descricao, lido: false, criado_em: new Date().toISOString() };
}

// Classificação de tendência do áudio a partir do ranking vs. execução anterior.
function deriveAudioTrendStatus(a: InstaAudio, prevRow: any): InstaAudioStatus {
  const change = a.rank_change ?? 0;
  const rising = change < 0;
  const falling = change > 0;
  const newEntry = prevRow == null;
  if (newEntry) return a.score >= 70 ? "viral" : "nova";
  if (falling) return "perdendo";
  if (rising && Math.abs(change) >= 2 && a.score >= 55)
    return a.score >= 70 ? "viral" : "crescendo";
  if (rising) return "crescendo";
  if (a.score >= 60) return "consolidada";
  return "crescendo";
}

const AUDIO_GENERIC_WORDS = new Set([
  "em",
  "no",
  "na",
  "nas",
  "nos",
  "nao",
  "da",
  "do",
  "de",
  "dos",
  "das",
  "que",
  "os",
  "as",
  "um",
  "uma",
  "uns",
  "esta",
  "este",
  "estao",
  "dessa",
  "desse",
  "essa",
  "esse",
  "isso",
  "isto",
  "para",
  "com",
  "por",
  "sem",
  "quem",
  "alta",
  "bombando",
  "viral",
  "viralizou",
  "viralizar",
  "viralizando",
  "novo",
  "nova",
  "novos",
  "novas",
  "instagram",
  "reels",
  "reel",
  "tiktok",
  "semana",
  "agora",
  "hoje",
  "trend",
  "trends",
  "tendencia",
  "tendencias",
  "usos",
  "usadas",
  "usados",
  "usado",
  "mais",
  "menos",
  "veja",
  "confira",
  "descubra",
  "descubram",
  "ranking",
  "lista",
  "top",
  "hits",
  "hit",
  "muito",
  "muita",
  "efeito",
  "efeitos",
  "sonoro",
  "sonora",
  "audio",
  "audios",
  "musica",
  "musicas",
  "som",
  "sons",
  "esta",
  "ja",
  "vai",
  "pode",
  "completo",
  "aqui",
  "tem",
  "seu",
  "sua",
  "seus",
  "suas",
  "como",
  "cada",
  "nesta",
  "desta",
  "lugares",
  "generou",
  "geraram",
  "dominam",
  "mais",
  "usadas",
  "segue",
  "virou",
  "tomou",
  "conta",
  "vem",
]);

function isAudioGeneric(s: string): boolean {
  const words = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => AUDIO_GENERIC_WORDS.has(w));
}

function cleanAudioPart(s: string): string {
  let v = titutoLimpo(s)
    .replace(/^(?:[\s:;,.\-–—"“”'‘`«»]+|🎵|🎶)+/, "")
    .replace(/(?:[\s:;,.\-–—"”'`»]+|🎵|🎶)+$/, "");
  v = v.replace(/^(\bfeat\b\.?|\bpart\b\.?|com|de:)?\s*/i, "");
  return v.trim();
}

function cleanArtist(s: string | null): string | null {
  if (!s) return null;
  let v = cleanAudioPart(s);
  for (let i = 0; i < 3; i++) {
    const before = v;
    v = v
      .replace(
        /(?:\s+(?:da|do|de|e|com))?\s*(?:semana|instagram|reels|reel|tiktok|momento|agora|hoje|202\d)$/i,
        "",
      )
      .trim();
    if (v === before && !/\s+[A-ZÀ-Ú]/.test(v)) break;
  }
  v = v.replace(/^o artista\s+/i, "").replace(/^a artista\s+/i, "");
  v = v
    .replace(/^(centos?|cantoras?|grupo|banda|dupla|dj|mc|singer|rapper|produtor)\s+/i, "")
    .trim();
  if (v.length < 3 || v.length > 40) return null;
  if (isAudioGeneric(v)) return null;
  return v;
}

function extractAudioArtistNear(text: string, from: number): string | null {
  const after = text.slice(from);
  const m = after.match(
    /\b(?:de|do|da|por|cantad[oa]?s?\s+por|artista|com|feat\.?|part\.?)\s*(?:[:\-–])?\s*([A-ZÀ-Ú][\wÀ-ú.'&']+(?:\s+[A-ZÀ-Ú][\wÀ-ú.'&']+){0,4})/i,
  );
  if (!m) return null;
  return cleanArtist(m[1] ?? null);
}

function extractAudioArtistAnywhere(text: string): string | null {
  const re =
    /\b(?:de|do|da|por|cantad[oa]?s?\s+por)\s+(?:o|a|os|as)?\s*(?:cantor|cantora|grupo|banda|dupla|dj|mc|singer|rapper)?\s*([A-ZÀ-Ú][\wÀ-ú.'&']+(?:\s+[A-ZÀ-Ú][\wÀ-ú.'&']+){0,4})\b/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const got = cleanArtist(m[1] ?? null);
    if (got) last = got;
  }
  return last;
}

function extractAudioMeta(
  titulo: string,
  snippet: string,
): { nome: string; artista: string | null } | null {
  const text = `${titulo ?? ""} ${snippet ?? ""}`;
  if (
    !/áudio|áudios|música|musica|músicas|musicas|trilha sonora|trend de áudio|som(?: |s |,)|sfx/i.test(
      text,
    )
  )
    return null;

  const pick = (raw: string, from: number) => {
    const nome = cleanAudioPart(raw).slice(0, 60);
    if (!nome || isAudioGeneric(nome)) return null;
    const artista = extractAudioArtistNear(text, from) ?? extractAudioArtistAnywhere(text);
    return { nome, artista };
  };

  const quoted = text.match(/["“”'`«]([A-Za-zÀ-ú0-9][^"“”'`»]{2,60})["”'`»]/);
  if (quoted) {
    const idx = text.indexOf(quoted[0]);
    const got = pick(quoted[1] ?? "", idx + quoted[0].length);
    if (got) return got;
  }

  const labeled = text.match(
    /\b(?:áudio|áudios|música|musica|músicas|musicas|trilha sonora|trend de áudio)\s*(?:que está em alta|em alta|do momento|da semana|nova|novo)?\s*:\s*["“']?([A-Za-zÀ-ú0-9][^,.;:!?()"]{2,60}?)\s*["”']?(?=\s*[,.]|\s+de\s+[A-ZÀ-Ú]|\s+por\s+[A-ZÀ-Ú]|\s+em alta|\s*$|$)/i,
  );
  if (labeled) {
    const idx = (labeled.index ?? 0) + labeled[0].length;
    const got = pick(labeled[1] ?? "", idx);
    if (got) return got;
  }

  const adjacent = text.match(
    /\b(?:áudio|música|musica|som|áudios|músicas|musicas)\s+(?:da|do|de|dessa|desse|essa|esse|em alta|que está bombando)?\s*["“']?([A-Za-zÀ-ú0-9][A-Za-zÀ-ú0-9 .'&’’]{2,60}?)\s*["”']?(?=(?:\s+(?:de|do|da|por|cantad[oa])\s+[A-ZÀ-Ú])|\s*\b(?:em alta|no reels|no instagram|bombando|viral|tem|\()|\s*$)/i,
  );
  if (adjacent) {
    const idx = (adjacent.index ?? 0) + (adjacent[0] ?? "").length;
    const got = pick(adjacent[1] ?? "", idx);
    if (got) return got;
  }

  return null;
}

function parseAudioUsos(snippet: string): number | null {
  const m = snippet.match(/([\d.,]+\s*(?:milh[ãa]o|[mb]ilh[ãa]o|mil|k|m|b)?)\s*usos?\b/i);
  if (!m) return null;
  const raw = m[1] ?? "";
  const mult = raw.match(/milh/i)
    ? 1_000_000
    : raw.match(/bilh/i)
      ? 1_000_000_000
      : raw.match(/mil/i)
        ? 1000
        : raw.match(/[kK]$/)
          ? 1000
          : raw.match(/[mM]$/)
            ? 1_000_000
            : raw.match(/[bB]$/)
              ? 1_000_000_000
              : 1;
  const n =
    parseFloat(
      raw
        .replace(/[^0-9.,]/g, "")
        .replace(/\./g, "")
        .replace(",", "."),
    ) * mult;
  return n > 0 && isFinite(n) ? Math.round(n) : null;
}

// ============================================================
// Conteúdo (MEELL — inferência determinística por regras)
// ============================================================

function buildContent(
  trend: InstaTrend | undefined,
  audio: InstaAudio | undefined,
  keywords: string[],
): InstaContent {
  const tema = keywords.slice(0, 3).length ? keywords.slice(0, 3).join(", ") : "seu nicho";
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const gancho = INSTA_GANCHOS[daySeed % INSTA_GANCHOS.length] ?? INSTA_GANCHOS[0]!;
  const trendNome = trend?.nome ?? "uma trend em alta";
  const audioNome = audio?.nome ?? "";
  const audioArtist = audio?.artista ?? "";
  const formato =
    trend?.formato === "Carrossel"
      ? "Carrossel"
      : audioNome
        ? "Reels (áudio)"
        : trend?.formato
          ? `${trend.formato}`
          : "Reels";
  const withAudio = audioNome
    ? ` Use o áudio "${audioNome}"${audioArtist ? ` (${audioArtist})` : ""}.`
    : "";
  const objetivo =
    trend?.categoria === "vendas"
      ? "Conversão"
      : trend?.ciclo === "auge"
        ? "Alcance"
        : "Engajamento + Conexão";

  const ideia = `Crie um conteúdo sobre "${trendNome}" aplicado ao ${tema}: abra com ${gancho.nome.toLowerCase()}${withAudio}`;
  const textoTela = `"${trendNome}" — dá pra usar no ${tema}?`;
  const roteiro = [
    `Abertura: ${gancho.exemplo.replace("{tema}", tema)}, apontando para "${trendNome}".`,
    `Contexto: mostre por que ${trendNome} está em alta (sem inventar números — cite o fenômeno).`,
    `Núcleo: 3 formas de aplicar em ${tema}, com exemplos rápidos.${withAudio}`,
    `Fechamento: reforço do valor + chamada para salvar.`,
  ];
  const hashtags = [
    ...keywords.slice(0, 5).map((k) => `#${k.replace(/[^a-zA-Z0-9À-ú]+/g, "")}`),
    "#reels",
    "#instagram",
    "#tendencia",
    "#conteudo",
  ].filter((h) => h.length > 2);

  return {
    sugestao: "📡 O que postar hoje",
    trend: trendNome,
    trend_url: trend?.url ?? null,
    trend_ciclo: trend ? trend.ciclo : null,
    audio: audioNome || null,
    formato,
    gancho: gancho.nome,
    ideia,
    texto_tela: textoTela,
    roteiro,
    legenda: `Você reparou que "${trendNome}" está em alta? 📈 Dá para usar no seu nicho com um ângulo próprio. Confira o roteiro.`,
    cta: "Salve este post para montar o vídeo depois e siga para mais ideias.",
    hashtags,
    capa: `Texto de capa: "${trendNome} para ${tema}" sobre imagem do momento da trend.`,
    objetivo,
    score: trend?.score ?? 0,
    fonte: "inferencia",
    motivo:
      "Conteúdo gerado por regras (MEELL) a partir das tendências observadas — não usa números inventados de views/engajamento.",
  };
}

// ============================================================
// Post completo de áudio + horários de pico (estimativa honesta)
// ============================================================

const PEAK_POOL = [
  "06:30 – 08:00",
  "11:30 – 13:00",
  "17:00 – 19:00",
  "19:00 – 21:00",
  "21:00 – 22:30",
];

function buildHorarios(): string[] {
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  const start = Math.floor(Date.now() / 86_400_000) % PEAK_POOL.length;
  return [1, 2, 3].map((i, idx) => {
    const dia = dias[(new Date().getDay() + i) % 7] ?? "seg";
    return `${dia} · ${PEAK_POOL[(start + idx) % PEAK_POOL.length] ?? ""}`;
  });
}

function slugTag(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9À-ú]+/g, "")
    .slice(0, 28)
    .toLowerCase();
}

function buildAudioPost(audio: InstaAudio, keywords: string[]): InstaAudioPost {
  const tema = keywords.slice(0, 3).length ? keywords.slice(0, 3).join(", ") : "seu nicho";
  const nome = (audio.track_name && audio.track_name.trim()) || audio.nome;
  const artist = (audio.artist_name && audio.artist_name.trim()) || audio.artista;
  const nomeLimpo = nome.replace(/^[\s]+|^🎵/, "");
  const withArtist = artist ? ` — ${artist}` : "";
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const gancho = INSTA_GANCHOS[daySeed % INSTA_GANCHOS.length] ?? INSTA_GANCHOS[0]!;
  const objetivo = audio.ciclo === "auge" ? "Alcance" : "Engajamento + Conexão";

  const legenda =
    `O áudio "${nomeLimpo}"${withArtist} está subindo de verdade. 🎵 ` +
    `Mostrei 3 formas de usar no ${tema} — pausa no refrão, transição e chamada no final. ` +
    `Reproduza antes de gravar e marque o melhor momento da faixa.`;

  return {
    sugestao: `🎵 Post completo do áudio: ${nomeLimpo}`,
    nome,
    artista: artist,
    nome_reels: nomeLimpo,
    preview_url: audio.preview_url ?? null,
    artwork_url: audio.artwork_url ?? null,
    itunes_url: audio.itunes_url ?? null,
    score: audio.score,
    compat: audio.compat,
    ciclo: audio.ciclo,
    fonte: "inferencia",
    fonte_detalhe:
      "Post montado por regras (MEELL) a partir do áudio em alta observado — sem views/engajamento inventados.",
    content: {
      sugestao: `🎵 Post completo do áudio: ${nomeLimpo}`,
      trend: null,
      trend_url: null,
      trend_ciclo: audio.ciclo,
      audio: nomeLimpo,
      formato: "Reels (áudio)",
      gancho: gancho.nome,
      ideia: `Grave um Reels com o áudio "${nomeLimpo}"${withArtist} aplicado ao ${tema}: entre no refrão e entregue o valor rápido.`,
      texto_tela: `"${nomeLimpo}"${withArtist}`,
      roteiro: [
        `Abertura: comece JÁ no refrão de "${nomeLimpo}" (o momento que todo mundo espera) — não deixe passar mais de 1s.`,
        `Encaixe: use o áudio "${nomeLimpo}"${withArtist} no contexto de ${tema} com uma cena que prende nos primeiros 3 segundos.`,
        `Núcleo: 3 aplicações rápidas no ${tema} em sequência, com uma virada "antes → depois" para ritmo.`,
        `Fechamento: mostre o resultado e chame para salvar — música em alta gera replay.`,
      ],
      legenda,
      cta: "Salve este post para montar o vídeo e pesquisa o áudio pelo nome no editor de Reels.",
      hashtags: [
        ...keywords.slice(0, 5).map((k) => `#${k.replace(/[^a-zA-Z0-9À-ú]+/g, "")}`),
        `#${slugTag(nomeLimpo)}`,
        ...(artist ? [`#${slugTag(artist)}`] : []),
        "#reels",
        "#instagramreels",
        "#musicaemalta",
        "#tendencia",
      ].filter((h) => h.length > 2),
      capa: `Capa: nome da música "${nomeLimpo}"${withArtist} em destaque, no estilo das capas de Reels em alta (foto + texto grande).`,
      objetivo,
      score: audio.score,
      fonte: "inferencia",
      motivo:
        "Conteúdo gerado por regras (MEELL) a partir do áudio em alta observado — horários são estimativa de pico de engajamento (padrões gerais, não dado oficial).",
      horarios: buildHorarios(),
    },
  };
}

// ============================================================
// Server Functions
// ============================================================

export type InstaTokenInput = { token: string };
export type InstaKeywordsInput = { token: string; keywords: string[] };
export type InstaAutoUpdateInput = { token: string; enabled: boolean };
export type InstaPlanInput = {
  token: string;
  dia: string;
  formato: string;
  trend: string | null;
  audio: string | null;
  ideia: string;
  gancho: string | null;
  objetivo: string | null;
};
export type InstaPlanDeleteInput = { token: string; id: string };
export type InstaContentInput = { token: string; trend_id?: string | undefined };
export type InstaAlertsMarkInput = { token: string };
export type InstaAudioPreviewInput = { token: string; id: string };
export type InstaAudioPostInput = { token: string; id: string };

export const instaRadarDashboard = createServerFn({ method: "GET" })
  .validator((d: InstaTokenInput) => d)
  .handler(
    async ({ data }): Promise<{ success: boolean; error?: string; data?: InstaDashboard }> => {
      const userId = await verifyUser(data.token);
      if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
      try {
        const admin: any = await getAdmin();
        const config = await loadConfig(userId);
        const [trendsRes, audiosRes, alertsRes, plansRes, historyRes, conexaoRes] =
          await Promise.all([
            admin
              .from("insta_radar_trends")
              .select("*")
              .eq("user_id", userId)
              .order("score", { ascending: false })
              .limit(TREND_CAP),
            admin
              .from("insta_radar_audios")
              .select("*")
              .eq("user_id", userId)
              .order("score", { ascending: false })
              .limit(AUDIO_CAP),
            admin
              .from("insta_radar_alerts")
              .select("*")
              .eq("user_id", userId)
              .order("criado_em", { ascending: false })
              .limit(40),
            admin
              .from("insta_radar_plan")
              .select("*")
              .eq("user_id", userId)
              .order("criado_em", { ascending: true }),
            admin
              .from("insta_radar_history")
              .select("*")
              .eq("user_id", userId)
              .order("criado_em", { ascending: false })
              .limit(20),
            admin.from("insta_conexao").select("conectado,label,instrucao").eq("user_id", userId),
          ]);
        const trends = (trendsRes.data ?? []) as unknown as InstaTrend[];
        const audios = (audiosRes.data ?? []) as unknown as InstaAudio[];
        const alerts = (alertsRes.data ?? []) as unknown as InstaAlert[];
        const plans = (plansRes.data ?? []) as unknown as InstaPlan[];
        const history = (historyRes.data ?? []) as unknown as InstaHistory[];
        const conexao = (conexaoRes.data ?? []) as unknown as InstaDashboard["conexao"];
        return {
          success: true,
          data: {
            config,
            trends,
            audios,
            alerts,
            plans,
            history,
            conexao,
            stats: {
              total_trends: trends.length,
              na_auge: trends.filter((t) => t.ciclo === "auge" || t.ciclo === "crescendo").length,
              nicho_alta: trends.filter((t) => t.compat >= 70).length,
              audio_em_alta: audios.filter((a) => a.ciclo === "auge" || a.ciclo === "crescendo")
                .length,
              audio_subindo: audios.filter(
                (a) =>
                  a.trend_status === "viral" ||
                  a.trend_status === "crescendo" ||
                  a.trend_status === "nova",
              ).length,
              alertas_nao_lidos: alerts.filter((a) => !a.lido).length,
              oport_hoje: trends.filter(
                (t) => t.score >= 65 && t.compat >= 40 && t.ciclo !== "caindo",
              ).length,
            },
            auto_run_hint:
              config.auto_update && !config.last_run_at
                ? "Configure o nicho e rode o radar uma vez para começar. Depois ative a atualização automática."
                : config.auto_update
                  ? "Atualização automática ligada — o radar roda no intervalo configurado."
                  : "Atualização automática desligada. Ative para o radar rodar sozinho.",
          },
        };
      } catch (err) {
        console.error("[insta-radar] dashboard:", err);
        return { success: false, error: "Falha ao carregar o radar do Instagram." };
      }
    },
  );

export const instaRadarSaveKeywords = createServerFn({ method: "POST" })
  .validator((d: InstaKeywordsInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    const clean = [
      ...new Set((data.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean)),
    ].slice(0, 20);
    if (clean.length !== data.keywords.length)
      return { success: false, error: "Palavras-chave inválidas." };
    try {
      const admin: any = await getAdmin();
      const cfg = await loadConfig(userId);
      await admin.from("insta_radar_config").upsert({
        user_id: userId,
        keywords: clean,
        status: cfg.status,
        alert_count: cfg.alert_count,
        disabled: cfg.disabled,
        last_error: cfg.last_error,
        last_run_at: cfg.last_run_at,
        next_run_at: cfg.next_run_at,
        updated_at: new Date().toISOString(),
      });
      return { success: true };
    } catch {
      return { success: false, error: "Não foi possível salvar o nicho." };
    }
  });

export const instaRadarSaveAutoUpdate = createServerFn({ method: "POST" })
  .validator((d: InstaAutoUpdateInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    try {
      const admin: any = await getAdmin();
      await admin
        .from("insta_radar_config")
        .update({ auto_update: !!data.enabled })
        .eq("user_id", userId);
      return { success: true };
    } catch {
      return { success: false, error: "Não foi possível atualizar a atualização automática." };
    }
  });

export const instaRadarRun = createServerFn({ method: "POST" })
  .validator((d: InstaTokenInput) => d)
  .handler(
    async ({
      data,
    }): Promise<{ success: boolean; error?: string; tooSoon?: boolean; result?: RunResult }> => {
      const userId = await verifyUser(data.token);
      if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
      try {
        const admin: any = await getAdmin();
        const config = await loadConfig(userId);
        if (
          config.next_run_at &&
          Date.now() - new Date(config.next_run_at).getTime() < MIN_RUN_INTERVAL_MS
        ) {
          return {
            success: false,
            tooSoon: true,
            error: `Radar aguarda ${MIN_RUN_INTERVAL_MS / 60_000} min entre execuções. Volte em instantes.`,
          };
        }
        await admin
          .from("insta_radar_config")
          .update({ status: "rodando" })
          .eq("user_id", userId)
          .is("disabled", false);
        const tavilyKey = (process.env["TAVILY_API_KEY"] as string | undefined) || null;
        const braveKey = (process.env["BRAVE_API_KEY"] as string | undefined) || null;
        const result = await runAnalysis(userId, config.keywords, tavilyKey, braveKey);

        const now = new Date().toISOString();
        const next = new Date(Date.now() + MIN_RUN_INTERVAL_MS).toISOString();
        if (result.trends.length) {
          await admin.from("insta_radar_trends").upsert(
            result.trends.map((t) => ({ user_id: userId, ...toTrendRow(t), updated_at: now })),
            { onConflict: "user_id,nome" },
          );
        }
        if (result.audios.length) {
          await admin.from("insta_radar_audios").upsert(
            result.audios.map((a) => ({ user_id: userId, ...toAudioRow(a), updated_at: now })),
            { onConflict: "user_id,nome" },
          );
        }
        // Quando a parada oficial é a fonte, remove apenas os lixos restantes
        // (nomes truncados da web que perdem significado) — melhor sem eles do
        // que com um ranking de áudios quebrados.
        if (result.chart_used && result.audios.length) {
          const keep = result.audios.map((a) => a.nome.toLowerCase());
          try {
            await admin
              .from("insta_radar_audios")
              .delete()
              .eq("user_id", userId)
              .filter("nome", "not.in", keep);
          } catch {
            // limpeza é best-effort
          }
        }
        await admin.from("insta_radar_history").insert({ user_id: userId, resumo: result.resumo });
        if (result.alerts.length) {
          await admin.from("insta_radar_alerts").insert(
            result.alerts.map((a) => ({
              user_id: userId,
              tipo: a.tipo,
              titulo: a.titulo,
              descricao: a.descricao,
              criado_em: a.criado_em,
            })),
          );
        }
        await admin.from("insta_radar_config").upsert({
          user_id: userId,
          keywords: config.keywords,
          status: "ok",
          last_run_at: now,
          next_run_at: next,
          alert_count: config.alert_count + result.alerts.length,
          disabled: false,
          last_error: null,
          updated_at: now,
        });
        return { success: true, result };
      } catch (err) {
        console.error("[insta-radar] run:", err);
        try {
          const admin: any = await getAdmin();
          await admin
            .from("insta_radar_config")
            .update({ status: "erro", last_error: String(err).slice(0, 300) })
            .eq("user_id", userId);
        } catch {
          // atualização do status de erro é best-effort
        }
        return { success: false, error: "Falha na execução do radar do Instagram." };
      }
    },
  );

export const instaRadarContent = createServerFn({ method: "POST" })
  .validator((d: InstaContentInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; error?: string; data?: InstaContent }> => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    try {
      const admin: any = await getAdmin();
      const config = await loadConfig(userId);
      const { data: trendsRows } = await admin
        .from("insta_radar_trends")
        .select("*")
        .eq("user_id", userId)
        .order("score", { ascending: false });
      const { data: audioRows } = await admin
        .from("insta_radar_audios")
        .select("*")
        .eq("user_id", userId)
        .order("score", { ascending: false });
      const trends = (trendsRows ?? []) as unknown as InstaTrend[];
      const audios = (audioRows ?? []) as unknown as InstaAudio[];
      let trend: InstaTrend | undefined;
      if (data.trend_id) trend = trends.find((t) => t.id === data.trend_id);
      if (!trend && !data.trend_id) {
        trend =
          trends.find((t) => t.score >= 55 && t.compat >= 40 && t.ciclo !== "caindo") ?? trends[0];
      }
      const audio = audios.find((a) => a.ciclo !== "caindo") ?? audios[0];
      return { success: true, data: buildContent(trend, audio, config.keywords) };
    } catch (err) {
      console.error("[insta-radar] content:", err);
      return { success: false, error: "Falha ao gerar conteúdo." };
    }
  });

export const instaRadarPlanSave = createServerFn({ method: "POST" })
  .validator((d: InstaPlanInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    if (!["seg", "ter", "qua", "qui", "sex", "sab", "dom"].includes(data.dia))
      return { success: false, error: "Dia inválido." };
    if (!data.ideia.trim()) return { success: false, error: "Adicione a ideia do conteúdo." };
    try {
      const admin: any = await getAdmin();
      await admin.from("insta_radar_plan").insert({
        user_id: userId,
        dia: data.dia,
        formato: data.formato || "Reels",
        trend: data.trend || null,
        audio: data.audio || null,
        ideia: data.ideia.trim(),
        gancho: data.gancho || null,
        objetivo: data.objetivo || "Engajamento",
      });
      return { success: true };
    } catch {
      return { success: false, error: "Não foi possível salvar no planejamento." };
    }
  });

export const instaRadarPlanDelete = createServerFn({ method: "POST" })
  .validator((d: InstaPlanDeleteInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    try {
      const admin: any = await getAdmin();
      await admin.from("insta_radar_plan").delete().eq("id", data.id).eq("user_id", userId);
      return { success: true };
    } catch {
      return { success: false, error: "Falha ao remover do planejamento." };
    }
  });

export const instaRadarAlertsMark = createServerFn({ method: "POST" })
  .validator((d: InstaAlertsMarkInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    try {
      const admin: any = await getAdmin();
      await admin
        .from("insta_radar_alerts")
        .update({ lido: true })
        .eq("user_id", userId)
        .eq("lido", false);
      return { success: true };
    } catch {
      return { success: false, error: "Falha ao marcar alertas." };
    }
  });

export const instaRadarAudioPost = createServerFn({ method: "POST" })
  .validator((d: InstaAudioPostInput) => d)
  .handler(
    async ({ data }): Promise<{ success: boolean; error?: string; data?: InstaAudioPost }> => {
      const userId = await verifyUser(data.token);
      if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
      try {
        const admin: any = await getAdmin();
        const [audioRes, config] = await Promise.all([
          admin
            .from("insta_radar_audios")
            .select("*")
            .eq("id", data.id)
            .eq("user_id", userId)
            .single(),
          loadConfig(userId),
        ]);
        const r: any = audioRes?.data;
        if (!r) return { success: false, error: "Áudio não encontrado." };
        const audio: InstaAudio = {
          id: r.id,
          nome: String(r.nome),
          artista: r.artista ?? null,
          usos: r.usos ?? null,
          crescimento: r.crescimento ?? 0,
          ciclo: r.ciclo ?? "crescendo",
          score: r.score ?? 0,
          compat: r.compat ?? 0,
          motivo: r.motivo ?? null,
          fonte: r.fonte ?? "observado",
          fonte_detalhe: r.fonte_detalhe ?? null,
          url: r.url ?? null,
          coletado_em: r.coletado_em ?? null,
          preview_url: r.preview_url ?? null,
          artwork_url: r.artwork_url ?? null,
          itunes_url: r.itunes_url ?? null,
          track_url: r.track_url ?? r.itunes_url ?? null,
          track_name: r.track_name ?? null,
          artist_name: r.artist_name ?? null,
          album: r.album ?? null,
          provider_id: r.provider_id ?? null,
          enrich_attempted_at: r.enrich_attempted_at ?? null,
          provider: r.provider ?? null,
          trend_status: r.trend_status ?? null,
          rank: r.rank ?? null,
          previous_rank: r.previous_rank ?? null,
          rank_change: r.rank_change ?? null,
          score_delta: r.score_delta ?? null,
          growth_rate: r.growth_rate ?? null,
          first_seen_at: r.first_seen_at ?? null,
          last_seen_at: r.last_seen_at ?? null,
          seen_count: r.seen_count ?? null,
        };
        return { success: true, data: buildAudioPost(audio, config.keywords) };
      } catch (err) {
        console.error("[insta-radar] audio post:", err);
        return { success: false, error: "Falha ao montar o post do áudio." };
      }
    },
  );

export const instaRadarAudioPreview = createServerFn({ method: "POST" })
  .validator((d: InstaAudioPreviewInput) => d)
  .handler(
    async ({
      data,
    }): Promise<{
      success: boolean;
      error?: string;
      found: boolean;
      audio?: InstaAudio | null;
    }> => {
      const userId = await verifyUser(data.token);
      if (!userId)
        return { success: false, error: "Sessão expirada. Entre novamente.", found: false };
      try {
        const admin: any = await getAdmin();
        const { data: row } = await admin
          .from("insta_radar_audios")
          .select("*")
          .eq("id", data.id)
          .eq("user_id", userId)
          .single();
        if (!row) return { success: false, error: "Áudio não encontrado.", found: false };
        const r: any = row;
        if (r.preview_url) return { success: true, found: true, audio: r as InstaAudio };
        const m = await resolveItunesAudio(String(r.nome), r.artista);
        const upd: Record<string, unknown> = { enrich_attempted_at: new Date().toISOString() };
        if (m) {
          upd["preview_url"] = m.previewUrl;
          upd["artwork_url"] = m.artworkUrl;
          upd["itunes_url"] = m.itunesUrl;
          upd["track_url"] = m.itunesUrl ?? null;
          upd["track_name"] = m.trackName;
          upd["artist_name"] = m.artistName;
          upd["album"] = m.album ?? null;
          upd["provider_id"] = m.providerId ?? null;
          upd["provider"] = m.provider;
        }
        await admin.from("insta_radar_audios").update(upd).eq("id", data.id).eq("user_id", userId);
        return {
          success: true,
          found: !!m?.previewUrl,
          audio: { ...(r as InstaAudio), ...upd },
        };
      } catch (err) {
        console.error("[insta-radar] audio preview:", err);
        return { success: false, error: "Falha ao buscar a prévia da música.", found: false };
      }
    },
  );

export const instaRadarAudioResolve = createServerFn({ method: "POST" })
  .validator((d: { token: string; id: string; term?: string; artista?: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{
      success: boolean;
      error?: string;
      audio?: InstaAudio | null;
    }> => {
      const userId = await verifyUser(data.token);
      if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
      try {
        const admin: any = await getAdmin();
        const { data: row } = await admin
          .from("insta_radar_audios")
          .select("*")
          .eq("id", data.id)
          .eq("user_id", userId)
          .single();
        if (!row) return { success: false, error: "Áudio não encontrado." };
        const r: any = row;
        const term = (data.term ?? "").trim() || String(r.nome);
        const artista = (data.artista ?? "").trim() || r.artista || undefined;
        const m = await resolveItunesAudio(term, artista);
        const upd: Record<string, unknown> = { enrich_attempted_at: new Date().toISOString() };
        if (m?.previewUrl) {
          upd["preview_url"] = m.previewUrl;
          upd["artwork_url"] = m.artworkUrl;
          upd["itunes_url"] = m.itunesUrl;
          upd["track_url"] = m.itunesUrl ?? null;
          upd["track_name"] = m.trackName;
          upd["artist_name"] = m.artistName;
          upd["album"] = m.album ?? null;
          upd["provider_id"] = m.providerId ?? null;
          upd["provider"] = m.provider;
          upd["nome"] = term;
          if (artista) upd["artista"] = artista;
        }
        await admin.from("insta_radar_audios").update(upd).eq("id", data.id).eq("user_id", userId);
        return { success: true, audio: { ...(r as InstaAudio), ...upd } };
      } catch (err) {
        console.error("[insta-radar] audio resolve:", err);
        return { success: false, error: "Falha ao buscar a faixa agora. Tente em instantes." };
      }
    },
  );

export const instaRadarAudioClientResolve = createServerFn({ method: "POST" })
  .validator(
    (d: {
      token: string;
      id: string;
      term?: string;
      artista?: string;
      preview_url?: string | null;
      artwork_url?: string | null;
      itunes_url?: string | null;
      track_url?: string | null;
      track_name?: string | null;
      artist_name?: string | null;
      album?: string | null;
      provider_id?: string | null;
      provider?: string | null;
    }) => d,
  )
  .handler(
    async ({ data }): Promise<{ success: boolean; error?: string; audio?: InstaAudio | null }> => {
      const userId = await verifyUser(data.token);
      if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
      try {
        const admin: any = await getAdmin();
        const { data: row } = await admin
          .from("insta_radar_audios")
          .select("*")
          .eq("id", data.id)
          .eq("user_id", userId)
          .single();
        if (!row) return { success: false, error: "Áudio não encontrado." };
        const upd: Record<string, unknown> = { enrich_attempted_at: new Date().toISOString() };
        if (data.term !== undefined && data.term !== null && String(data.term).trim()) {
          upd["preview_url"] = data.preview_url ?? null;
          upd["artwork_url"] = data.artwork_url ?? null;
          upd["itunes_url"] = data.itunes_url ?? null;
          upd["track_url"] = data.track_url ?? null;
          upd["track_name"] = data.track_name ?? null;
          upd["artist_name"] = data.artist_name ?? null;
          upd["album"] = data.album ?? null;
          upd["provider_id"] = data.provider_id ?? null;
          upd["provider"] = (data.provider ?? null) as string | null;
          upd["nome"] = String(data.term).trim();
          if (data.artista !== undefined && String(data.artista).trim()) {
            upd["artista"] = String(data.artista).trim();
          }
        }
        await admin.from("insta_radar_audios").update(upd).eq("id", data.id).eq("user_id", userId);
        return { success: true, audio: { ...(row as InstaAudio), ...upd } };
      } catch (err) {
        console.error("[insta-radar] audio client resolve:", err);
        return { success: false, error: "Falha ao vincular a prévia. Tente em instantes." };
      }
    },
  );

export const instaRadarWipe = createServerFn({ method: "POST" })
  .validator((d: InstaTokenInput) => d)
  .handler(async ({ data }): Promise<{ success: boolean; error?: string }> => {
    const userId = await verifyUser(data.token);
    if (!userId) return { success: false, error: "Sessão expirada. Entre novamente." };
    try {
      const admin: any = await getAdmin();
      for (const table of [
        "insta_radar_trends",
        "insta_radar_audios",
        "insta_radar_history",
        "insta_radar_alerts",
        "insta_radar_plan",
        "insta_radar_config",
        "insta_conexao",
      ]) {
        await admin
          .from(table as "insta_radar_config")
          .delete()
          .eq("user_id", userId);
      }
      return { success: true };
    } catch {
      return { success: false, error: "Falha ao limpar o radar." };
    }
  });
