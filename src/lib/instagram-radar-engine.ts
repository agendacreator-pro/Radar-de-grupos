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
  };
}

// ============================================================
// Análise principal
// ============================================================

type RunResult = {
  trends: InstaTrend[];
  audios: InstaAudio[];
  alerts: InstaAlert[];
  resumo: InstaHistory["resumo"];
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
    .select("nome")
    .eq("user_id", userId);
  const prevAudioSet = new Set<string>(
    (prevAudios ?? []).map((r: any) => String(r.nome).toLowerCase()),
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
      const nome = extractAudioName(obs.title, obs.snippet);
      if (!nome) continue;
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
        artista: extractAudioArtist(obs.title, obs.snippet),
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

  // Converge audios → tendência correspondente quando o nome não for só "áudio"
  for (const a of audiosByNome.values()) {
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
  };

  return { trends, audios, alerts, resumo };
}

function alertRow(tipo: InstaAlert["tipo"], titulo: string, descricao: string | null): InstaAlert {
  return { id: "", tipo, titulo, descricao, lido: false, criado_em: new Date().toISOString() };
}

function extractAudioName(titulo: string, snippet: string): string | null {
  const candidates = [titulo, snippet];
  const re =
    /\b(?:áudio|trend de áudio|som(?: \d+)?)\s*[:\-–]?\s*["“”']?([A-Za-zÀ-ú0-9][^.;:!?"]{2,60}?)\b/i;
  for (const c of candidates) {
    const m = re.exec(c.trim());
    if (m && m[1]) return titutoLimpo(m[1]).slice(0, 60);
  }
  if (snippet.includes("áudio"))
    return titutoLimpo(snippet.split("áudio")[1]?.split(/[,.;]/)[0] ?? "").slice(0, 60) || null;
  return null;
}

function extractAudioArtist(titulo: string, snippet: string): string | null {
  const m = `${titulo} ${snippet}`.match(
    /[dD]e\s+([A-ZÀ-ú][^,.;(?:]{2,40})\s*(?:\b(?:em alta|trend|viral|boom)\b|$)/,
  );
  if (!m) return null;
  const name = (m[1] ?? "").trim();
  return name.length > 2 && name.length <= 40 ? name : null;
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
// Server Functions
// ============================================================

export type InstaTokenInput = { token: string };
export type InstaKeywordsInput = { token: string; keywords: string[] };
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
              alertas_nao_lidos: alerts.filter((a) => !a.lido).length,
              oport_hoje: trends.filter(
                (t) => t.score >= 65 && t.compat >= 40 && t.ciclo !== "caindo",
              ).length,
            },
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
