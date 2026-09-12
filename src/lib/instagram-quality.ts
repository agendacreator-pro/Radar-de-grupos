// ============================================================
// Radar do Algoritmo — Instagram — QUALIDADE DA BASE
//
// Camada pura (sem I/O, sem React) de normalização e resolução
// honesta dos sinais que o Radar já coleta. Nada aqui inventa
// dado: normaliza o que existe, resolve nicho usando SOMENTE
// texto observado (nunca `adaptacao`, que é texto gerado pelo
// engine e repete keywords automaticamente) e qualifica a
// quantidade de evidência real disponível.
//
// Funções públicas usadas por:
//   - engine (coleta): normaliza formato, resolve nicho, mede
//     qualidade do sinal e origem, e monta o snapshot da base.
//   - instagram-formatos.ts (análise "Formatos em Alta").
// ============================================================

import {
  INSTA_FORMATS,
  type InstaFonte,
  type InstaFormatoNormalizado,
  type InstaNicheConfidence,
  type InstaSignalQuality,
  type InstaTrend,
  type InstaTrendSnapshot,
  type InstaTrendSource,
} from "@/lib/instagram-radar";

// ------------------------------------------------------------
// Normalização de texto (pesquisa case/accent/pontuação-insensitive)
// ------------------------------------------------------------

/**
 * Normaliza um texto para comparação: minúsculo, sem acentos, sem sinais
 * de pontuação (viram espaço). Ex.: "Automação!" → " automacao ".
 */
export function normPhrase(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s{2,}/g, " ");
}

/**
 * true quando `term` (normalizado) está presente em `phrase` (normalizado)
 * como palavra inteira. "ia" NÃO casa dentro de "simpatia".
 */
export function phraseHas(phrase: string, term: string): boolean {
  const p = ` ${normPhrase(phrase)} `;
  const t = normPhrase(term);
  if (!t) return false;
  return p.includes(` ${t} `);
}

// ------------------------------------------------------------
// Formatos: base canônica × subformato
// ------------------------------------------------------------

const FORMAT_ALIASES: Record<string, string> = {
  reels: "Reels",
  reel: "Reels",
  carrossel: "Carrossel",
  carrousel: "Carrossel",
  stories: "Stories",
  story: "Stories",
  colab: "Colab",
  colaboracao: "Colab",
  "feed + reels": "Feed + Reels",
  "feed e reels": "Feed + Reels",
};

const SUBFORMAT_ALIASES: Record<string, string> = {
  audio: "Áudio",
  video: "Vídeo",
  foto: "Fotos",
  fotos: "Fotos",
  imagem: "Fotos",
  imagens: "Fotos",
  carrossel: "Carrossel",
  tutorial: "Tutorial",
  dica: "Lista",
  lista: "Lista",
  checklist: "Lista",
  "antes e depois": "Antes e depois",
  "antes/depois": "Antes e depois",
  transicao: "Transição",
  bastidor: "Bastidores",
  bastidores: "Bastidores",
};

/**
 * Normaliza o nome de um formato já inferido (ex.: "Reels (áudio)") em
 * base canônica + variação. "Reels (áudio)" → { formato: "Reels",
 * subformato: "Áudio" } — assim uma tendência de áudio fica DENTRO do
 * grupo "Reels", em vez de criar um grupo separado.
 *
 * Base que não bate com o vocabulário conhecido é mantida como está
 * (nunca é renomeada/inventada).
 */
export function normalizeTrendFormat(raw: string | null | undefined): InstaFormatoNormalizado {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s{2,}/g, " ");
  if (!s) return { formato: null, subformato: null, raw: raw ?? null };
  const paren = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const baseRaw = (paren?.[1] ?? s).trim();
  const subRaw = (paren?.[2] ?? "").trim() || null;

  const key = normPhrase(baseRaw);
  let formato: string | null;
  if (!key) {
    formato = null;
  } else {
    const canonica = INSTA_FORMATS.find((f) => normPhrase(f) === key);
    formato = canonica ?? FORMAT_ALIASES[key] ?? baseRaw;
  }

  const subKey = subRaw ? normPhrase(subRaw) : "";
  const subformato = subRaw
    ? (SUBFORMAT_ALIASES[subKey] ?? `${subRaw.charAt(0).toUpperCase()}${subRaw.slice(1)}`)
    : null;

  return { formato, subformato, raw: s };
}

// ------------------------------------------------------------
// Nicho: resolução confiável (com confiança)
// ------------------------------------------------------------

export type InstaNicheInput = {
  nome: string;
  /** `motivo` do Radar (sinais + compat — texto derivado, evidência média). */
  motivo?: string | null;
  /** Texto bruto observado na coleta (título + snippet — evidência média). */
  extra?: string | null;
  /** Nicho explicitamente gravado (evidência forte). */
  explicit?: string | null;
};

export type InstaNicheResolution = {
  niche: string | null;
  confidence: InstaNicheConfidence;
};

const CONFIDENCE_WEIGHT: Record<InstaNicheConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

/**
 * Descobre a keyword do nicho que melhor explica uma tendência, usando
 * SOMENTE o que foi observado (nunca `adaptacao`):
 *
 *   - keyword inteira no TÍTULO               → confidence high
 *   - keyword inteira no snippet/motivo       → confidence medium
 *   - só 1 palavra de keyword composta achada → confidence low (parcial)
 *   - nada                                   → niche null / confidence unknown
 *
 * Empate: keyword mais específica (mais palavras/mais longa) vence;
 * depois a ordem da lista do usuário. Nunca inventa nicho.
 */
export function resolveTrendNiche(
  input: InstaNicheInput,
  keywords: string[],
): InstaNicheResolution {
  const explicit = String(input.explicit ?? "").trim();
  if (explicit) return { niche: explicit, confidence: "high" };

  const kw = (keywords ?? []).filter((k) => normPhrase(k));
  if (kw.length === 0) return { niche: null, confidence: "unknown" };

  const nome = normPhrase(input.nome);
  const motivo = normPhrase(input.motivo ?? "");
  const extra = normPhrase(input.extra ?? "");

  let best: { niche: string; confidence: InstaNicheConfidence } | null = null;

  for (const k of kw) {
    const key = normPhrase(k);
    if (!key) continue;

    if (phraseHas(nome, key)) {
      // title = evidência mais forte
      if (
        !best ||
        CONFIDENCE_WEIGHT.high > CONFIDENCE_WEIGHT[best.confidence] ||
        (best.confidence === "high" && key.length > best.niche.length)
      )
        best = { niche: k.trim(), confidence: "high" };
      continue;
    }

    if (phraseHas(motivo, key) || phraseHas(extra, key)) {
      if (
        !best ||
        CONFIDENCE_WEIGHT.medium > CONFIDENCE_WEIGHT[best.confidence] ||
        (best.confidence === "medium" && key.length > best.niche.length)
      )
        best = { niche: k.trim(), confidence: "medium" };
      continue;
    }

    // keyword composta: só uma das palavras apareceu → parcial (low)
    const words = key.split(" ").filter((w) => w.length >= 2);
    if (
      words.length >= 2 &&
      words.some((w) => phraseHas(nome, w) || phraseHas(motivo, w) || phraseHas(extra, w))
    ) {
      if (
        !best ||
        CONFIDENCE_WEIGHT.low > CONFIDENCE_WEIGHT[best.confidence] ||
        (best.confidence === "low" && key.length > best.niche.length)
      )
        best = { niche: k.trim(), confidence: "low" };
    }
  }

  return best ?? { niche: null, confidence: "unknown" };
}

// ------------------------------------------------------------
// Origem da coleta
// ------------------------------------------------------------

export type InstaSourceInput = {
  url?: string | null;
  provider?: string | null;
  /** true quando o dado foi adicionado à mão (nunca usado hoje). */
  manual?: boolean;
};

/**
 * Classifica ONDE o dado foi obtido. Como o Radar só descobre via busca
 * pública, uma observação com URL/provider é "web_search"; sem URL, cai
 * em "engine" (derivado pelas regras internas). Nunca diz "oficial".
 */
export function deriveTrendSource(input: InstaSourceInput): InstaTrendSource {
  if (input.manual) return "manual";
  if (input.url || input.provider) return "web_search";
  return "engine";
}

// ------------------------------------------------------------
// Qualidade dos sinais disponíveis
// ------------------------------------------------------------

export type InstaSignalInput = {
  url?: string | null;
  published?: string | null;
  provider?: string | null;
  /** Texto observado (título + snippet) na coleta. */
  text?: string | null;
  fonte?: InstaFonte | string | null;
  source?: InstaTrendSource | null;
};

/**
 * Conta quantos sinais REAIS existem para a tendência (link observado,
 * data de publicação observada, provedor identificável, texto longo o
 * bastante para extrair sinais) e devolve a qualidade:
 *
 *   0 sinais                 → insuficiente
 *   1–2 sinais               → baixa
 *   3 sinais                 → media
 *   4 sinais                 → alta
 *   fonte oficial            → sobe baixa/insuficiente para media
 */
export function calculateSignalQuality(input: InstaSignalInput): InstaSignalQuality {
  let count = 0;
  if (String(input.url ?? "").trim()) count++;
  if (input.published) {
    const d = new Date(input.published);
    if (!Number.isNaN(d.getTime())) count++;
  }
  if (String(input.provider ?? "").trim()) count++;
  if (String(input.text ?? "").trim().length >= 120) count++;

  let quality: InstaSignalQuality =
    count <= 0 ? "insuficiente" : count <= 2 ? "baixa" : count >= 4 ? "alta" : "media";

  if (input.fonte === "oficial" && (quality === "baixa" || quality === "insuficiente"))
    quality = "media";

  return quality;
}

// ------------------------------------------------------------
// Snapshot histórico de uma tendência
// ------------------------------------------------------------

/**
 * Constrói o snapshot de uma tendência para o histórico (resumo.trends).
 * Prefere os valores JÁ resolvidos na coleta (formato normalizado, nicho,
 * confiança, origem, qualidade, timestamps); para linhas antigas sem esses
 * campos, re-deriva com as mesmas regras (nunca inventa).
 */
export function buildTrendSnapshot(t: InstaTrend, keywords: string[]): InstaTrendSnapshot {
  const norm = normalizeTrendFormat(t.formato);
  const resolved =
    t.niche && t.niche_confidence
      ? { niche: t.niche, confidence: t.niche_confidence }
      : resolveTrendNiche({ nome: t.nome, motivo: t.motivo }, keywords);
  const source = t.source ?? deriveTrendSource({ url: t.url });
  const signalQuality =
    t.signal_quality ??
    calculateSignalQuality({ url: t.url, fonte: t.fonte, text: `${t.nome} ${t.motivo ?? ""}` });

  return {
    key: t.nome.toLowerCase(),
    nome: t.nome,
    categoria: t.categoria,
    ciclo: t.ciclo,
    score: t.score,
    compat: t.compat,
    crescimento: t.crescimento,
    formato: norm.formato ?? t.formato,
    subformato: norm.subformato ?? t.subformato ?? null,
    nicho: resolved.niche,
    nichoConfidence: resolved.confidence,
    source,
    signalQuality,
    coletadoEm: t.coletado_em,
    primeiraColetaEm: t.first_seen_at ?? t.created_at ?? t.coletado_em,
    ultimaColetaEm: t.last_seen_at ?? t.coletado_em,
  };
}
